import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";

const ACTIVE_CONTEST_STATUSES = ["OPEN", "WAITING", "FULL"];
const POSTPONED_TEXT = /\b(postponed|rescheduled|delayed|delay)\b/i;
const CONFIRMED_ABANDONED_TEXT = /\b(abandoned|cancelled|canceled|no result|no-result)\b/i;

function validTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function getClosureTime(match, contest, now) {
  const providerStatus = String(match.providerStatus || "");
  const providerState = String(match.providerState || "").toLowerCase();
  const adminConfirmedStarted = match.status && match.status !== "upcoming";

  // A postponed fixture keeps its entries open until an admin updates the schedule.
  if (!adminConfirmedStarted && POSTPONED_TEXT.test(providerStatus) && providerState !== "live") return null;

  if (adminConfirmedStarted) return now;
  if (providerState === "live" || providerState === "result" || CONFIRMED_ABANDONED_TEXT.test(providerStatus)) {
    return new Date(validTime(match.providerLastSyncedAt) || now.getTime());
  }

  const scheduledStart = validTime(match.startTime);
  const configuredCutoff = validTime(contest.expiresAt);
  if (scheduledStart === null || configuredCutoff === null) return null;
  const cutoff = Math.min(scheduledStart, configuredCutoff);
  return cutoff <= now.getTime() ? new Date(cutoff) : null;
}

/**
 * Closes entry slots only. It does not change contest status, participants,
 * balances, transactions, or settlement fields.
 */
export async function closeDueContestEntries({ MatchModel = Match, ContestModel = Contest, now = new Date() } = {}) {
  const [dueContests, confirmedMatches] = await Promise.all([
    ContestModel.find({ status: { $in: ACTIVE_CONTEST_STATUSES }, entryClosedAt: null, expiresAt: { $lte: now } })
      .select("_id match status expiresAt")
      .lean(),
    MatchModel.find({
      published: { $ne: false },
      $or: [
        { status: { $in: ["live", "completed", "cancelled", "abandoned"] } },
        { providerState: { $in: ["live", "result"] } },
        { providerStatus: /\b(abandoned|cancelled|canceled|no result|no-result)\b/i },
      ],
    }).select("_id status startTime providerState providerStatus providerLastSyncedAt").lean(),
  ]);

  const matchIds = new Set([
    ...dueContests.map((contest) => String(contest.match)),
    ...confirmedMatches.map((match) => String(match._id)),
  ]);
  if (!matchIds.size) return { checked: 0, closed: 0 };

  const matches = await MatchModel.find({ _id: { $in: [...matchIds] }, published: { $ne: false } })
    .select("_id status startTime providerState providerStatus providerLastSyncedAt")
    .lean();
  const matchesById = new Map(matches.map((match) => [String(match._id), match]));
  const contests = await ContestModel.find({
    match: { $in: matches.map((match) => match._id) },
    status: { $in: ACTIVE_CONTEST_STATUSES },
    entryClosedAt: null,
  }).select("_id match status expiresAt").lean();

  let closed = 0;
  for (const contest of contests) {
    const match = matchesById.get(String(contest.match));
    if (!match) continue;
    const closedAt = getClosureTime(match, contest, now);
    if (!closedAt) continue;

    const result = await ContestModel.updateOne({
      _id: contest._id,
      match: match._id,
      status: { $in: ACTIVE_CONTEST_STATUSES },
      entryClosedAt: null,
      expiresAt: contest.expiresAt,
    }, {
      $set: { entryClosedAt: closedAt },
      $unset: { activeQueueKey: "" },
    });
    if (result.modifiedCount === 1) {
      closed += 1;
      console.info("Contest entries closed.", {
        contestId: String(contest._id),
        matchId: String(match._id),
        closedAt: closedAt.toISOString(),
        reason: match.status !== "upcoming" ? "match-status" : match.providerState === "live" ? "provider-live" : match.providerState === "result" ? "provider-result" : "entry-cutoff",
      });
    }
  }
  console.info("Contest entry closure check finished.", { matches: matches.length, contests: contests.length, closed });
  return { checked: contests.length, closed };
}

