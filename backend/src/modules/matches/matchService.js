
import mongoose from "mongoose";
import Match from "../../models/Match.js";
import Contest from "../../models/Contest.js";
import Team from "../../models/Team.js";
import { settleMatchContests } from "../contests/contestSettlementService.js";
import { ensureMatchContestQueues } from "../contests/contestService.js";

async function validateCompetitionTeams({ competition, teamA, teamB, format }) {
  const teams = await Team.find({
    competition,
    name: { $in: [teamA.trim(), teamB.trim()] },
    active: true,
  })
    .select("name formats")
    .lean();
  const teamAEntries = teams.filter((team) => team.name === teamA.trim());
  const teamBEntries = teams.filter((team) => team.name === teamB.trim());

  if (!teamAEntries.length || !teamBEntries.length) {
    const error = new Error("Both teams must belong to the selected competition.");
    error.status = 400;
    throw error;
  }
  if (
    !teamAEntries.some((team) => (team.formats || []).includes(format))
    || !teamBEntries.some((team) => (team.formats || []).includes(format))
  ) {
    const error = new Error("The selected match format is not supported by both teams.");
    error.status = 400;
    throw error;
  }
}

export async function listMatches() {
  return Match.find()
    .select("-createdBy -pendingResultCorrection")
    .sort({ startTime: 1 })
    .limit(100)
    .lean();
}

export async function listAdminMatches({ recent = false, limit = 100 } = {}) {
  return Match.find()
    .sort(recent ? { createdAt: -1, _id: -1 } : { startTime: 1 })
    .limit(limit)
    .lean();
}

export async function getMatchById(id) {
  if (!mongoose.isValidObjectId(id)) {
    const error = new Error("Invalid match ID.");
    error.status = 400;
    throw error;
  }

  const match = await Match.findById(id)
    .select("-createdBy -pendingResultCorrection")
    .lean();

  if (!match) {
    const error = new Error("Match not found.");
    error.status = 404;
    throw error;
  }

  return match;
}

export async function createMatch(payload, createdBy) {
  if (
    payload.status === "completed" &&
    !["teamA", "teamB", "tie", "no_result"].includes(payload.result)
  ) {
    const error = new Error("Select an official result before creating a completed match.");
    error.status = 400;
    throw error;
  }

  await validateCompetitionTeams({
    competition: payload.competition,
    teamA: payload.teamA,
    teamB: payload.teamB,
    format: payload.format || "T20",
  });

  const session = await mongoose.startSession();
  let match;

  try {
    await session.withTransaction(async () => {
      [match] = await Match.create(
        [{
          competition: payload.competition.trim(),
          teamA: payload.teamA.trim(),
          teamB: payload.teamB.trim(),
          format: payload.format || "T20",
          status: payload.status || "upcoming",
          result:
            payload.status === "cancelled"
              ? "cancelled"
              : payload.status === "abandoned"
                ? "abandoned"
                : payload.result || null,
          startTime: new Date(payload.startTime),
          createdBy,
        }],
        { session }
      );

      if (
        match.status === "upcoming" &&
        new Date(match.startTime).getTime() > Date.now()
      ) {
        await ensureMatchContestQueues(String(match._id), createdBy, session);
      }
    });
  } finally {
    await session.endSession();
  }

  return match;
}

export async function updateMatch(id, payload) {
  if (!mongoose.isValidObjectId(id)) {
    const error = new Error("Invalid match ID.");
    error.status = 400;
    throw error;
  }

  const existing = await Match.findById(id);

  if (!existing) {
    const error = new Error("Match not found.");
    error.status = 404;
    throw error;
  }

  const isFinalized = ["completed", "cancelled", "abandoned"].includes(
    existing.status
  );
  const changesFinalizedMatch = [
    "competition",
    "teamA",
    "teamB",
    "format",
    "startTime",
  ].some((field) => {
    if (payload[field] === undefined) return false;
    if (field === "startTime") {
      return new Date(payload[field]).getTime() !== new Date(existing[field]).getTime();
    }
    return payload[field] !== existing[field];
  });

  if (
    isFinalized &&
    (
      changesFinalizedMatch ||
      (payload.status !== undefined && payload.status !== existing.status) ||
      (existing.result &&
        payload.result !== undefined &&
        payload.result !== existing.result)
    )
  ) {
    const error = new Error("A finalized match result cannot be changed.");
    error.status = 409;
    throw error;
  }

  const updates = {};

  if (payload.competition !== undefined) {
    updates.competition = payload.competition.trim();
  }

  for (const field of ["teamA", "teamB"]) {
    if (payload[field] !== undefined) {
      updates[field] = payload[field].trim();
    }
  }

  for (const field of ["format", "status", "result"]) {
    if (payload[field] !== undefined) {
      updates[field] = payload[field];
    }
  }

  const nextStatus = updates.status || existing.status;
  const nextCompetition = updates.competition || existing.competition;
  const nextTeamA = updates.teamA || existing.teamA;
  const nextTeamB = updates.teamB || existing.teamB;
  const nextFormat = updates.format || existing.format || "T20";

  if (
    payload.competition !== undefined
    || payload.teamA !== undefined
    || payload.teamB !== undefined
    || payload.format !== undefined
  ) {
    if (!nextCompetition) {
      const error = new Error("Choose a competition for the selected teams.");
      error.status = 400;
      throw error;
    }
    await validateCompetitionTeams({
      competition: nextCompetition,
      teamA: nextTeamA,
      teamB: nextTeamB,
      format: nextFormat,
    });
  }

  if (nextStatus === "completed" && !(updates.result || existing.result)) {
    const error = new Error("Select an official result before completing the match.");
    error.status = 400;
    throw error;
  }

  if (nextStatus === "completed" && updates.result === null) {
    const error = new Error("A completed match must have an official result.");
    error.status = 400;
    throw error;
  }

  if (nextStatus === "cancelled") {
    updates.result = "cancelled";
  } else if (nextStatus === "abandoned") {
    updates.result = "abandoned";
  } else if (updates.status && !["completed"].includes(nextStatus)) {
    updates.result = null;
  }

  if (payload.startTime !== undefined) {
    updates.startTime = new Date(payload.startTime);
  }

  const startTimeChanged =
    payload.startTime !== undefined &&
    new Date(payload.startTime).getTime() !== new Date(existing.startTime).getTime();

  if (startTimeChanged) {
    const settledContest = await Contest.exists({
      match: id,
      $or: [
        { status: { $in: ["COMPLETED", "REFUNDED"] } },
        { settlementStatus: { $in: ["SETTLED", "REFUNDED"] } },
      ],
    });

    if (settledContest) {
      const error = new Error(
        "The match schedule cannot be changed after any contest has been settled or refunded."
      );
      error.status = 409;
      throw error;
    }
  }

  const match = await Match.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  });

  if (!match) {
    const error = new Error("Match not found.");
    error.status = 404;
    throw error;
  }

  if (["completed", "cancelled", "abandoned"].includes(match.status)) {
    await settleMatchContests(match);
  }

  if (startTimeChanged && match.status === "upcoming") {
    await Contest.updateMany(
      {
        match: match._id,
        status: { $in: ["OPEN", "WAITING", "FULL"] },
      },
      { $set: { expiresAt: match.startTime } }
    );

    await Contest.updateMany(
      {
        match: match._id,
        status: "LOCKED",
        "players.1": { $exists: true },
      },
      {
        $set: {
          status: "FULL",
          expiresAt: match.startTime,
          settlementStatus: "NOT_READY",
          cancellationReason: null,
          lockedAt: null,
        },
      }
    );

    if (new Date(match.startTime).getTime() > Date.now()) {
      await ensureMatchContestQueues(String(match._id), match.createdBy);
    }
  }

  if (match.status === "live" && existing.status !== "live") {
    await Contest.updateMany(
      { match: match._id, status: "FULL" },
      {
        $set: {
          status: "LOCKED",
          lockedAt: new Date(),
          settlementStatus: "PENDING",
          cancellationReason: "MATCH_STARTED",
        },
        $unset: { activeQueueKey: "" },
      }
    );

    const unfilled = await Contest.find({
      match: match._id,
      status: { $in: ["OPEN", "WAITING"] },
    })
      .select("_id players")
      .lean();

    for (const contest of unfilled) {
      await Contest.updateOne(
        { _id: contest._id, status: { $in: ["OPEN", "WAITING"] } },
        {
          $set: {
            status: contest.players.length ? "REFUNDED" : "CANCELLED",
            cancellationReason: "NO_OPPONENT",
            settlementStatus: contest.players.length
              ? "REFUND_REQUIRED"
              : "NOT_READY",
          },
          $unset: { activeQueueKey: "" },
        }
      );
    }
  }

  return match;
}

export async function deleteMatch(id) {
  if (!mongoose.isValidObjectId(id)) {
    const error = new Error("Invalid match ID.");
    error.status = 400;
    throw error;
  }

  if (await Contest.exists({ match: id })) {
    const error = new Error("Matches with contests cannot be deleted. Cancel or complete the match so entries can be settled.");
    error.status = 409;
    throw error;
  }

  const match = await Match.findByIdAndDelete(id);

  if (!match) {
    const error = new Error("Match not found.");
    error.status = 404;
    throw error;
  }
}
