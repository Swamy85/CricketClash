import crypto from "node:crypto";
import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";

const PROCESSABLE_CONTEST_STATUSES = ["OPEN", "WAITING", "FULL", "LOCKED"];
const NON_FINAL_TEXT = /\b(stumps|day\s*\d+|innings?\s*break|in progress|live|not started|upcoming|postponed|rescheduled|delayed)\b/i;
const ABANDONED_TEXT = /\b(abandoned|forfeited)\b/i;
const NO_RESULT_TEXT = /\b(no result|no-result|washed out|without a result|cancelled|canceled)\b/i;
const TIE_TEXT = /\b(tied|tie|drawn|draw)\b/i;
const WINNER_VERB = /\b(won|wins|beat|beats|defeated)\b/i;

function normalizedTeam(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function getWinnerSourceTeam(match, status) {
  if (!WINNER_VERB.test(status)) return null;
  const teams = [...new Set([match.providerTeamA, match.providerTeamB].map(normalizedTeam).filter(Boolean))];
  const winners = teams.filter((team) => {
    const escaped = team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)${escaped}\\s+(?:have\\s+)?(?:won|wins|beat|beats|defeated)(?:\\s|$)`, "i").test(normalizedTeam(status));
  });
  return winners.length === 1 ? winners[0] : null;
}

function getMatchSide(match, providerWinner) {
  const winner = normalizedTeam(providerWinner);
  const teamA = normalizedTeam(match.teamA);
  const teamB = normalizedTeam(match.teamB);
  if (!winner || !teamA || !teamB || teamA === teamB) return null;
  if (winner === teamA) return "A";
  if (winner === teamB) return "B";
  return null;
}

/** Uses only a confirmed provider result status; scores are retained as evidence, never compared. */
export function deriveProviderMatchOutcome(match) {
  if (String(match?.providerSource || "").toUpperCase() !== "CRICAPI") return null;
  if (String(match?.providerState || "").toLowerCase() !== "result") return null;

  const status = String(match.providerStatus || "").trim();
  if (!status || NON_FINAL_TEXT.test(status)) return null;

  if (ABANDONED_TEXT.test(status)) return { type: "ABANDONED", winningMatchSide: null };
  if (NO_RESULT_TEXT.test(status)) return { type: "NO_RESULT", winningMatchSide: null };
  if (TIE_TEXT.test(status)) return { type: "TIE", winningMatchSide: null };

  const providerWinner = getWinnerSourceTeam(match, status);
  const winningMatchSide = providerWinner ? getMatchSide(match, providerWinner) : null;
  if (!winningMatchSide) return { type: "AMBIGUOUS", winningMatchSide: null };
  return { type: "WINNER", winningMatchSide };
}

function hasEligibleHeadToHead(contest) {
  const players = Array.isArray(contest.players) ? contest.players : [];
  if (players.length !== 2) return null;
  if (!players.every((player) => ["A", "B"].includes(player.selectedTeam))) return false;
  if (players[0].selectedTeam === players[1].selectedTeam) return false;
  return players.every((player) => ["PAID", "NOT_REQUIRED"].includes(player.entryPaymentStatus));
}

function contestWinner(contest, winningMatchSide) {
  return contest.players.find((player) => player.selectedTeam === winningMatchSide)?.user || null;
}

function signatureFor(match, outcome) {
  return crypto.createHash("sha256").update(JSON.stringify([
    match.providerId || "",
    match.providerState || "",
    match.providerStatus || "",
    match.providerTeamA || "",
    match.providerTeamB || "",
    match.teamA || "",
    match.teamB || "",
    match.providerScoreA || "",
    match.providerScoreB || "",
    outcome.type,
    outcome.winningMatchSide || "",
  ])).digest("hex");
}

function mapOutcomeStatus(type) {
  return type === "WINNER" ? "DETERMINED" : type;
}

export async function processProviderContestOutcomes({ MatchModel = Match, ContestModel = Contest, now = new Date() } = {}) {
  const matches = await MatchModel.find({
    published: { $ne: false },
    providerSource: "CRICAPI",
    providerState: "result",
  }).select("_id providerId providerSource providerState providerStatus providerTeamA providerTeamB providerScoreA providerScoreB teamA teamB published").lean();

  let considered = 0;
  let processed = 0;
  for (const match of matches) {
    const outcome = deriveProviderMatchOutcome(match);
    if (!outcome) continue;
    const signature = signatureFor(match, outcome);
    const contests = await ContestModel.find({
      match: match._id,
      $or: [{ entryClosedAt: { $ne: null } }, { status: "LOCKED" }],
      status: { $in: PROCESSABLE_CONTEST_STATUSES },
      settlementStatus: { $nin: ["SETTLED", "REFUNDED"] },
      providerOutcomeStatus: { $in: ["PENDING", "AMBIGUOUS", null] },
    }).select("_id match status players providerOutcomeStatus providerOutcome").lean();

    // Publication belongs to Match; this field is not stored redundantly on a contest.
    const linkedContests = contests.filter((contest) => String(contest.match) === String(match._id));
    for (const contest of linkedContests) {
      considered += 1;
      if (!hasEligibleHeadToHead(contest)) {
        console.info("Provider contest outcome skipped: contest does not meet head-to-head eligibility.", {
          contestId: String(contest._id), matchId: String(match._id),
        });
        continue;
      }
      const winnerId = outcome.type === "WINNER" ? contestWinner(contest, outcome.winningMatchSide) : null;
      if (outcome.type === "WINNER" && !winnerId) {
        console.info("Provider contest outcome skipped: contest does not meet head-to-head eligibility.", {
          contestId: String(contest._id), matchId: String(match._id),
        });
        continue;
      }

      const status = mapOutcomeStatus(outcome.type);
      const persistedOutcome = {
        type: outcome.type,
        winningMatchSide: outcome.winningMatchSide,
        determinedWinnerId: winnerId,
        providerMatchId: String(match.providerId || ""),
        providerStatus: String(match.providerStatus || "").slice(0, 200),
        providerTeamA: String(match.providerTeamA || "").slice(0, 80),
        providerTeamB: String(match.providerTeamB || "").slice(0, 80),
        providerScoreA: String(match.providerScoreA || "").slice(0, 80),
        providerScoreB: String(match.providerScoreB || "").slice(0, 80),
        signature,
        determinedAt: now,
      };

      const result = await ContestModel.updateOne({
        _id: contest._id,
        match: match._id,
        $or: [{ entryClosedAt: { $ne: null } }, { status: "LOCKED" }],
        status: { $in: PROCESSABLE_CONTEST_STATUSES },
        settlementStatus: { $nin: ["SETTLED", "REFUNDED"] },
        providerOutcomeStatus: { $in: ["PENDING", "AMBIGUOUS", null] },
        "providerOutcome.signature": { $ne: signature },
      }, {
        $set: { providerOutcomeStatus: status, providerOutcome: persistedOutcome },
      });
      if (result.modifiedCount === 1) {
        processed += 1;
        console.info("Provider contest outcome persisted.", {
          contestId: String(contest._id), matchId: String(match._id), status,
          winningMatchSide: outcome.winningMatchSide || null,
          winnerId: winnerId ? String(winnerId) : null,
        });
      }
    }
  }
  console.info("Provider contest outcome check finished.", { matches: matches.length, considered, processed });
  return { matches: matches.length, considered, processed };
}

