
import mongoose from "mongoose";
import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";
import User from "../../models/User.js";
import { notifyUser, notifyUsers } from "../../services/notificationService.js";
import { debitWallet } from "../wallet/walletService.js";
import { selectVisibleOpenContests } from "./contestVisibility.js";
import { buildCompatibleContestQuery, buildEmptyContestQuery } from "./contestAllocation.js";
import {
  CONTEST_TIERS,
  PLATFORM_FEE_PERCENTAGE,
} from "./contestValidation.js";

function makeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isValidId(id) {
  return mongoose.isValidObjectId(id);
}

function getFinancials(prizePool) {
  const platformFee = Math.round(
    (prizePool * PLATFORM_FEE_PERCENTAGE) / 100
  );

  return {
    platformFee,
    winnerPayout: prizePool - platformFee,
  };
}

function isPaidOrFree(player) {
  return (
    player.entryPaymentStatus === "PAID" ||
    player.entryPaymentStatus === "NOT_REQUIRED"
  );
}

function resolveJoinRequest(contest, { matchId, tier, userId, selectedTeam, idempotencyKey }) {
  const player = contest?.players?.find((entry) => entry.joinRequestId === idempotencyKey);
  if (!player) return null;
  if (
    String(contest.match) !== String(matchId)
    || contest.tier !== tier
    || String(player.user) !== String(userId)
    || player.selectedTeam !== selectedTeam
  ) {
    throw makeError("This idempotency key was already used for a different contest entry.", 409);
  }
  const terminal = ["COMPLETED", "CANCELLED", "REFUNDED", "LOCKED"].includes(contest.status);
  return { contest, alreadyJoined: player.entryPaymentStatus !== "PENDING" || terminal };
}

// Validate that a match is eligible for contest creation or joining.
async function getJoinableMatch(matchId, session) {
  if (!isValidId(matchId)) {
    throw makeError("Invalid match ID.");
  }

  let query = Match.findById(matchId);
  if (session) query = query.session(session);
  const match = await query.lean();

  if (!match) {
    throw makeError("Match not found.", 404);
  }

  if (match.status !== "upcoming") {
    throw makeError(
      `This match has status "${match.status}" and is not accepting contest entries.`,
      409
    );
  }

  const startTime = new Date(match.startTime).getTime();

  if (!Number.isFinite(startTime)) {
    throw makeError(
      "This match has an invalid start time. Update the match start time before creating a contest.",
      409
    );
  }

  if (startTime <= Date.now()) {
    throw makeError(
      "This match's start time has passed. Update it to a valid future time or select another upcoming match.",
      409
    );
  }

  return match;
}

function publicContestQuery(now = new Date()) {
  return {
    status: { $in: ["OPEN", "WAITING"] },
    settlementStatus: { $nin: ["SETTLED", "REFUNDED"] },
    expiresAt: { $gt: now },
  };
}

// --------------------------------------------------
// Contest listing
// --------------------------------------------------

export async function listOpenContests(now = new Date()) {
  const contests = await Contest.find(publicContestQuery(now))
    .select("-players.joinRequestId")
    .populate("match", "competition teamA teamB format status startTime")
    .populate("players.user", "userId")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return selectVisibleOpenContests(contests, now);
}

export async function listMyContests(userId) {
  if (!isValidId(userId)) {
    throw makeError("Invalid player ID.");
  }

  return Contest.find({ "players.user": userId })
    .select("-players.joinRequestId")
    .populate("match", "teamA teamB format status result startTime")
    .populate("players.user", "userId")
    .populate("winnerId", "userId")
    .sort({ createdAt: -1 })
    .lean();
}

export async function listAllContests() {
  return Contest.find()
    .select("-players.joinRequestId")
    .populate("match", "competition teamA teamB format status startTime")
    .populate("players.user", "userId")
    .populate("createdBy", "userId username")
    .populate("replacementContestId")
    .sort({ createdAt: -1 })
    .lean();
}

export async function listLeaderboard(limit) {
  const pipeline = [
    {
      $match: {
        status: "COMPLETED",
        settlementStatus: "SETTLED",
      },
    },
    { $unwind: "$players" },
    {
      $group: {
        _id: "$players.user",
        contestsPlayed: { $sum: 1 },
        wins: {
          $sum: {
            $cond: [{ $eq: ["$winnerId", "$players.user"] }, 1, 0],
          },
        },
        winnings: {
          $sum: {
            $cond: [
              { $eq: ["$winnerId", "$players.user"] },
              "$winnerPayout",
              0,
            ],
          },
        },
      },
    },
    { $sort: { winnings: -1, wins: -1, contestsPlayed: -1, _id: 1 } },
  ];
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    pipeline.push({ $limit: Math.min(Math.floor(Number(limit)), 1000) });
  }
  pipeline.push(
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "player",
      },
    },
    { $unwind: "$player" },
    {
      $project: {
        _id: 0,
        playerId: "$player.userId",
        contestsPlayed: 1,
        wins: 1,
        winnings: 1,
      },
    }
  );
  return Contest.aggregate(pipeline);
}

// --------------------------------------------------
// Contest creation
// --------------------------------------------------

export async function createContest({ matchId, tier, createdBy, session }) {
  const match = await getJoinableMatch(matchId, session);

  if (!Object.hasOwn(CONTEST_TIERS, tier)) {
    throw makeError("Invalid contest tier.");
  }

  if (!isValidId(createdBy)) {
    throw makeError("A valid creator ID is required.");
  }

  const config = CONTEST_TIERS[tier];
  const now = new Date();

  let activeContestQuery = Contest.findOne({
    match: match._id,
    tier,
    entryFee: config.entryFee,
    prizePool: config.prizePool,
    status: "OPEN",
    expiresAt: { $gt: now },
    "players.0": { $exists: false },
  });
  if (session) activeContestQuery = activeContestQuery.session(session);
  const activeContest = await activeContestQuery.lean();

  if (activeContest) {
    return activeContest;
  }

  const { platformFee, winnerPayout } = getFinancials(
    config.prizePool
  );

  try {
    const contestData = {
      match: match._id,
      tier,
      entryFee: config.entryFee,
      prizePool: config.prizePool,
      platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
      platformFee,
      winnerPayout,
      players: [],
      status: "OPEN",
      expiresAt: match.startTime,
      createdBy,
      replacementContestId: null,
      activeQueueKey: `${match._id}:${tier}`,
    };
    if (session) {
      const [contest] = await Contest.create([contestData], { session });
      return contest;
    }
    return await Contest.create(contestData);
  } catch (error) {
    if (session) throw error;
    if (error.code !== 11000) throw error;

    const concurrentContest = await Contest.findOne({
      match: match._id,
      tier,
      entryFee: config.entryFee,
      prizePool: config.prizePool,
      status: "OPEN",
      expiresAt: { $gt: new Date() },
      "players.0": { $exists: false },
    }).lean();

    if (concurrentContest) return concurrentContest;
    throw error;
  }
}

// Keep one empty contest available for every upcoming match and tier. A
// waiting contest is a player's existing entry; it must not consume the next
// entry opportunity for that tier.
async function ensureOpenContestQueue(match, tier, createdBy, session) {
  const now = new Date();
  const config = CONTEST_TIERS[tier];
  const query = {
    match: match._id,
    tier,
    entryFee: config.entryFee,
    prizePool: config.prizePool,
    status: "OPEN",
    expiresAt: { $gt: now },
    "players.0": { $exists: false },
  };
  let existingQuery = Contest.findOne(query).sort({ createdAt: -1 });
  if (session) existingQuery = existingQuery.session(session);
  const existing = await existingQuery.lean();
  if (existing) return existing;

  const { platformFee, winnerPayout } = getFinancials(config.prizePool);
  try {
    const contestData = {
      match: match._id,
      tier,
      entryFee: config.entryFee,
      prizePool: config.prizePool,
      platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
      platformFee,
      winnerPayout,
      players: [],
      status: "OPEN",
      expiresAt: match.startTime,
      createdBy,
      replacementContestId: null,
      activeQueueKey: `${match._id}:${tier}`,
    };
    if (session) {
      const [contest] = await Contest.create([contestData], { session });
      return contest;
    }
    return await Contest.create(contestData);
  } catch (error) {
    if (error.code !== 11000 || session) throw error;
    const concurrentQueue = await Contest.findOne(query).sort({ createdAt: -1 }).lean();
    if (concurrentQueue) return concurrentQueue;
    throw error;
  }
}

export async function ensureMatchContestQueues(matchId, createdBy, session) {
  const match = await getJoinableMatch(matchId, session);
  let creatorId = createdBy || match.createdBy;

  if (!isValidId(creatorId)) {
    let fallbackQuery = User.findOne({ role: "admin" }).select("_id");
    if (session) fallbackQuery = fallbackQuery.session(session);
    const fallbackAdmin = await fallbackQuery.lean();
    creatorId = fallbackAdmin?._id;
  }

  if (!isValidId(creatorId)) {
    throw makeError("A valid contest queue creator is required.", 500);
  }

  for (const tier of Object.keys(CONTEST_TIERS)) {
    await ensureOpenContestQueue(match, tier, creatorId, session);
  }
}

export async function ensureUpcomingMatchQueues() {
  const matches = await Match.find({
    status: "upcoming",
    startTime: { $gt: new Date() },
  })
    .select("_id createdBy")
    .lean();

  const fallbackAdmin = await User.findOne({ role: "admin" }).select("_id").lean();
  for (const match of matches) {
    const creatorId = match.createdBy || fallbackAdmin?._id;
    if (!creatorId) {
      console.error(
        `Cannot initialize contest queues for match ${match._id}: no admin account is available.`
      );
      continue;
    }

    try {
      for (const tier of Object.keys(CONTEST_TIERS)) {
        await ensureOpenContestQueue(match, tier, creatorId);
      }
    } catch (error) {
      console.error(
        `Unable to initialize contest queues for match ${match._id}:`,
        error
      );
    }
  }
}

// --------------------------------------------------
// Player slot reservation
// --------------------------------------------------

async function reserveContestSlot({
  matchId,
  tier,
  idempotencyKey,
  userId,
  selectedTeam,
  retryCount = 0,
}) {
  if (!isValidId(matchId) || !Object.hasOwn(CONTEST_TIERS, tier)) {
    throw makeError("A valid match and entry tier are required.");
  }

  if (!isValidId(userId)) {
    throw makeError("Invalid player ID.");
  }

  if (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) {
    throw makeError("A valid idempotency key is required.");
  }

  if (!["A", "B"].includes(selectedTeam)) {
    throw makeError('selectedTeam must be "A" or "B".');
  }

  const priorRequest = await Contest.findOne({ "players.joinRequestId": idempotencyKey }).lean();
  if (priorRequest) {
    return resolveJoinRequest(priorRequest, { matchId, tier, userId, selectedTeam, idempotencyKey });
  }

  const match = await getJoinableMatch(matchId);

  const now = new Date();
  let contest = await Contest.findOne({ match: match._id, tier, status: { $in: ["OPEN", "WAITING"] }, expiresAt: { $gt: now } }).sort({ createdAt: 1, _id: 1 }).lean();
  if (!contest) {
    await ensureMatchContestQueues(match._id);
    contest = await Contest.findOne({ match: match._id, tier, status: { $in: ["OPEN", "WAITING"] }, expiresAt: { $gt: new Date() } }).sort({ createdAt: 1, _id: 1 }).lean();
  }
  if (!contest) throw makeError("No contest queue is available for this match and tier.", 409);

  if (new Date(match.startTime) <= new Date()) {
    throw makeError("The match has already started.", 409);
  }

  const config = CONTEST_TIERS[tier];
  const reservationPlayer = {
    user: userId,
    joinRequestId: idempotencyKey,
    selectedTeam,
    joinedAt: now,
    entryPaymentStatus: config.entryFee === 0 ? "NOT_REQUIRED" : "PENDING",
    refundStatus: "NOT_REQUIRED",
  };

  // Pair directly into the oldest compatible half-filled contest. The
  // match/tier/team/payment/slot checks and player insertion are one atomic
  // MongoDB operation, so concurrent users cannot claim the same last slot.
  let reserved;
  try { reserved = await Contest.findOneAndUpdate(
    buildCompatibleContestQuery({ matchId: contest.match, tier: contest.tier, entryFee: config.entryFee, prizePool: config.prizePool, userId, selectedTeam, now }),
    {
      $push: { players: reservationPlayer },
      $set: { status: "FULL" },
      $unset: { activeQueueKey: "" },
    },
    { new: true, runValidators: true, sort: { createdAt: 1, _id: 1 } }
  ); } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicateRequest = await Contest.findOne({ "players.joinRequestId": idempotencyKey }).lean();
    if (duplicateRequest) return resolveJoinRequest(duplicateRequest, { matchId, tier, userId, selectedTeam, idempotencyKey });
    throw error;
  }

  if (!reserved) {
    // Keep the one shared empty queue replenished even if the lobby was
    // opened before the scheduler's next pass.
    await ensureOpenContestQueue(match, contest.tier, contest.createdBy);
    try { reserved = await Contest.findOneAndUpdate(
      buildEmptyContestQuery({ matchId: contest.match, tier: contest.tier, entryFee: config.entryFee, prizePool: config.prizePool, userId, now }),
      {
        $push: { players: reservationPlayer },
        $set: { status: "WAITING" },
        $unset: { activeQueueKey: "" },
      },
      { new: true, runValidators: true, sort: { createdAt: 1, _id: 1 } }
    ); } catch (error) {
      if (error.code !== 11000) throw error;
      const duplicateRequest = await Contest.findOne({ "players.joinRequestId": idempotencyKey }).lean();
      if (duplicateRequest) return resolveJoinRequest(duplicateRequest, { matchId, tier, userId, selectedTeam, idempotencyKey });
      throw error;
    }
  }

  if (!reserved) {
    if (retryCount < 3) {
      return reserveContestSlot({
        matchId,
        tier,
        idempotencyKey,
        userId,
        selectedTeam,
        retryCount: retryCount + 1,
      });
    }
    throw makeError(
      "This contest is no longer available. It may have filled while you were joining. Refresh the lobby and choose another contest.",
      409
    );
  }

  const latest = await Contest.findById(reserved._id).lean();

  return {
    contest: latest || reserved,
    alreadyJoined: false,
  };
}

// --------------------------------------------------
// Failed reservation recovery
// --------------------------------------------------

async function removeUnchargedReservation(contestId, userId) {
  // Only release the reservation after insufficient funds is confirmed.
  const updated = await Contest.findOneAndUpdate(
    {
      _id: contestId,
      players: {
        $elemMatch: {
          user: userId,
          entryPaymentStatus: "PENDING",
        },
      },
    },
    {
      $pull: {
        players: {
          user: userId,
          entryPaymentStatus: "PENDING",
        },
      },
    },
    { new: true }
  );

  if (!updated) return;

  const status =
    updated.players.length === 0
      ? "OPEN"
      : updated.players.length === 1
        ? "WAITING"
        : "FULL";

  await Contest.updateOne(
    { _id: contestId },
    {
      $set: { status },
      $unset: { activeQueueKey: "" },
    }
  );
}

// --------------------------------------------------
// Payment-state update
// --------------------------------------------------

async function markEntryPaid(contestId, userId, entryFee) {
  const expectedStatus =
    entryFee === 0 ? "NOT_REQUIRED" : "PENDING";

  const nextStatus =
    entryFee === 0 ? "NOT_REQUIRED" : "PAID";

  const updated = await Contest.findOneAndUpdate(
    {
      _id: contestId,
      players: {
        $elemMatch: {
          user: userId,
          entryPaymentStatus: expectedStatus,
        },
      },
    },
    {
      $set: {
        "players.$.entryPaymentStatus": nextStatus,
        "players.$.refundStatus": "NOT_REQUIRED",
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (updated) return updated;

  // Handle a request whose payment state was already updated.
  const current = await Contest.findById(contestId).lean();

  const player = current?.players.find(
    (item) => String(item.user) === String(userId)
  );

  if (player && isPaidOrFree(player)) {
    return current;
  }

  throw makeError(
    "The entry payment state could not be confirmed. Do not retry with a new transaction reference; contact support if this persists.",
    503
  );
}

// --------------------------------------------------
// Replacement contest creation
// --------------------------------------------------

async function ensureReplacementContest(contestId) {
  // Requires MongoDB transaction support (replica set or sharded cluster).
  const session = await mongoose.startSession();

  try {
    let replacement = null;

    await session.withTransaction(async () => {
      const original = await Contest.findOne({
        _id: contestId,
        status: "FULL",
        replacementContestId: null,
        "players.1": { $exists: true },
      }).session(session);

      if (!original) {
        // Another request may already have linked a replacement.
        const current = await Contest.findById(contestId)
          .session(session)
          .lean();

        replacement = current?.replacementContestId || null;
        return;
      }

      const match = await Match.findById(original.match)
        .session(session)
        .lean();

      if (
        !match ||
        match.status !== "upcoming" ||
        new Date(match.startTime) <= new Date()
      ) {
        return;
      }

      // Both players must have completed entry payment or be in a free contest.
      if (!original.players.every(isPaidOrFree)) {
        return;
      }

      const activeReplacement = await Contest.findOne({
        match: original.match,
        tier: original.tier,
        status: "OPEN",
        "players.0": { $exists: false },
      })
        .session(session)
        .lean();

      if (activeReplacement) {
        const linked = await Contest.updateOne(
          {
            _id: original._id,
            status: "FULL",
            replacementContestId: null,
          },
          { $set: { replacementContestId: activeReplacement._id } },
          { session }
        );

        if (linked.modifiedCount === 1) {
          replacement = activeReplacement;
        }
        return;
      }

      const config = CONTEST_TIERS[original.tier];

      if (!config) {
        throw makeError(
          "Contest tier configuration is missing.",
          500
        );
      }

      const [created] = await Contest.create(
        [
          {
            match: original.match,
            tier: original.tier,
            entryFee: original.entryFee,
            prizePool: original.prizePool,
            platformFeePercentage: original.platformFeePercentage,
            platformFee: original.platformFee,
            winnerPayout: original.winnerPayout,
            players: [],
            status: "OPEN",
            expiresAt: match.startTime,
            createdBy: original.createdBy,
            replacementContestId: null,
            activeQueueKey: `${original.match}:${original.tier}`,
          },
        ],
        { session }
      );

      const linked = await Contest.updateOne(
        {
          _id: original._id,
          status: "FULL",
          replacementContestId: null,
        },
        {
          $set: {
            replacementContestId: created._id,
          },
        },
        { session }
      );

      if (linked.modifiedCount !== 1) {
        throw makeError(
          "Could not link the replacement contest. Please retry.",
          409
        );
      }

      replacement = created;
    });

    return replacement;
  } finally {
    await session.endSession();
  }
}

export async function ensureMissingReplacementContests() {
  const fullContests = await Contest.find({
    status: "FULL",
    replacementContestId: null,
    expiresAt: { $gt: new Date() },
    "players.1": { $exists: true },
    "players.0.entryPaymentStatus": { $in: ["PAID", "NOT_REQUIRED"] },
    "players.1.entryPaymentStatus": { $in: ["PAID", "NOT_REQUIRED"] },
  })
    .select("_id")
    .lean();

  for (const contest of fullContests) {
    try {
      await ensureReplacementContest(contest._id);
    } catch (error) {
      console.error(
        `Replacement contest creation failed for ${contest._id}:`,
        error
      );
    }
  }
}

// --------------------------------------------------
// Join contest
// --------------------------------------------------

export async function joinContest({
  matchId,
  tier,
  idempotencyKey,
  userId,
  selectedTeam,
}) {
  const reservation = await reserveContestSlot({
    matchId,
    tier,
    idempotencyKey,
    userId,
    selectedTeam,
  });

  const reserved = reservation.contest;

  const player = reserved.players.find((item) => item.joinRequestId === idempotencyKey);

  if (!player) {
    throw makeError(
      "Contest reservation could not be confirmed.",
      503
    );
  }

  // Never charge an already-confirmed entry again.
  if (reservation.alreadyJoined) {
    if (
      reserved.status === "FULL" &&
      reserved.players.length === 2 &&
      reserved.players.every(isPaidOrFree)
    ) {
      await ensureReplacementContest(reserved._id);
    }

    return {
      contest: reserved,
      walletDebited: false,
      entryFee: reserved.entryFee,
      alreadyJoined: true,
    };
  }

  // A retry may find its exact reservation while payment is still pending.
  // Reuse the same contest scoped wallet reference and confirm the payment.

  const entryFee = reserved.entryFee;

  try {
    if (entryFee > 0) {
      await debitWallet({
        userId,
        amount: entryFee,
        reference: `contest-entry:${reserved._id}`,
        type: "CONTEST_ENTRY",
        contestId: reserved._id,
        description: `Entry fee for ${reserved.tier} contest`,
      });
    }
  } catch (error) {
    if (error.message === "Insufficient available coins.") {
      await removeUnchargedReservation(reserved._id, userId);
      throw makeError(error.message, 400);
    }

    // Preserve the reservation on ambiguous errors. Retrying must use
    // the same idempotency reference to avoid a duplicate wallet debit.
    throw error;
  }

  const updated = await markEntryPaid(
    reserved._id,
    userId,
    entryFee
  );

  // A distinct empty contest keeps this tier joinable for this user and all
  // other users even while this entry waits for an opponent.
  try {
    const queueMatch = await Match.findById(updated.match)
      .select("_id startTime status")
      .lean();
    if (queueMatch?.status === "upcoming" && new Date(queueMatch.startTime) > new Date()) {
      await ensureOpenContestQueue(queueMatch, updated.tier, updated.createdBy);
    }
  } catch (error) {
    console.error(`Unable to replenish contest queue for ${updated._id}:`, error);
  }

  const match = await Match.findById(updated.match)
    .select("teamA teamB")
    .lean();
  const joinedTeam = player.selectedTeam === "A"
    ? match?.teamA || "Team A"
    : match?.teamB || "Team B";
  const bothEntriesPaid = updated.players.length === 2 && updated.players.every(isPaidOrFree);
  const opponent = bothEntriesPaid
    ? updated.players.find((entry) => String(entry.user) !== String(userId))
    : null;

  const notifications = [
    notifyUser({
      userId,
      type: "CONTEST_JOINED",
      title: "Contest joined",
      message: `You joined the ${updated.tier} contest and selected ${joinedTeam}.`,
      reference: `contest-joined:${updated._id}:${userId}`,
      contestId: updated._id,
      matchId: updated.match,
    }),
  ];

  if (opponent) {
    notifications.push(
      notifyUser({
        userId: opponent.user,
        type: "OPPONENT_JOINED",
        title: "An opponent joined your contest",
        message: `Your ${updated.tier} contest now has an opponent.`,
        reference: `opponent-joined:${updated._id}:${userId}`,
        contestId: updated._id,
        matchId: updated.match,
      })
    );
  }

  if (bothEntriesPaid) {
    for (const entry of updated.players) {
      notifications.push(
        notifyUser({
          userId: entry.user,
          type: "CONTEST_FULL",
          title: "Contest is full",
          message: `Both player slots in the ${updated.tier} contest are filled.`,
          reference: `contest-full:${updated._id}:${entry.user}`,
          contestId: updated._id,
          matchId: updated.match,
        })
      );
    }
  }

  try {
    await Promise.all(notifications);
  } catch (error) {
    console.error(`Join notification failed for contest ${updated._id}:`, error);
  }

  // Create a replacement only after both entries are confirmed.
  if (
    updated.status === "FULL" &&
    updated.players.length === 2 &&
    updated.players.every(isPaidOrFree)
  ) {
    await ensureReplacementContest(updated._id);
  }

  return {
    contest: updated,
    walletDebited: entryFee > 0,
    entryFee,
    alreadyJoined: false,
  };
}

// --------------------------------------------------
// Admin cancellation
// --------------------------------------------------

export async function cancelContest(contestId, reason) {
  if (!isValidId(contestId)) {
    throw makeError("Invalid contest ID.");
  }

  if (reason !== "ADMIN_CANCELLED") {
    throw makeError("Unsupported cancellation reason.");
  }

  const current = await Contest.findById(contestId).lean();
  if (!current) throw makeError("Contest not found.", 404);

  if (!["OPEN", "WAITING", "FULL", "LOCKED"].includes(current.status)) {
    throw makeError("This contest can no longer be cancelled.", 409);
  }

  const hasPaidPlayers = current.players.some(
    (player) => player.entryPaymentStatus === "PAID"
  );
  const hasPendingPlayers = current.players.some(
    (player) => player.entryPaymentStatus === "PENDING"
  );
  const nextStatus = hasPaidPlayers || hasPendingPlayers ? "REFUNDED" : "CANCELLED";

  const contest = await Contest.findOneAndUpdate(
    {
      _id: contestId,
      status: { $in: ["OPEN", "WAITING", "FULL", "LOCKED"] },
    },
    {
      $set: {
        status: nextStatus,
        cancellationReason: "ADMIN_CANCELLED",
        settlementStatus:
          nextStatus === "REFUNDED" ? "REFUND_REQUIRED" : "NOT_READY",
      },
      $unset: { activeQueueKey: "" },
    },
    { new: true, runValidators: true }
  );

  if (!contest) {
    throw makeError("Contest status changed while it was being cancelled.", 409);
  }

  if (nextStatus === "REFUNDED") {
    await notifyUsers({
      userIds: current.players.map((player) => player.user),
      type: "CONTEST_CANCELLED",
      title: "Contest cancelled",
      message: `The ${current.tier} contest was cancelled by an administrator. Eligible entry fees are being refunded.`,
      reference: `contest-cancelled:${current._id}`,
      contestId: current._id,
      matchId: current.match,
    });
  }

  return contest;
}
