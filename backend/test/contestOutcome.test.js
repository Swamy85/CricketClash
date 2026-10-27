import test from "node:test";
import assert from "node:assert/strict";
import { deriveProviderMatchOutcome, processProviderContestOutcomes } from "../src/modules/contests/contestOutcomeService.js";

const now = new Date("2026-10-27T12:00:00.000Z");

function makeModels({ matches, contests }) {
  const MatchModel = {
    find(query) {
      const eligible = matches.filter((match) => match.published !== false
        && match.providerSource === query.providerSource
        && match.providerState === query.providerState);
      return { select() { return this; }, lean: async () => eligible };
    },
  };
  const ContestModel = {
    find(query) {
      const eligible = contests.filter((contest) => String(contest.match) === String(query.match)
        && (contest.entryClosedAt || contest.status === "LOCKED")
        && query.status.$in.includes(contest.status)
        && !["SETTLED", "REFUNDED"].includes(contest.settlementStatus)
        && [undefined, null, "PENDING", "AMBIGUOUS"].includes(contest.providerOutcomeStatus));
      return { select() { return this; }, lean: async () => eligible.map((row) => ({ ...row, players: row.players.map((player) => ({ ...player })) })) };
    },
    async updateOne(filter, update) {
      const row = contests.find((contest) => String(contest._id) === String(filter._id));
      if (!row || !["PENDING", "AMBIGUOUS", undefined, null].includes(row.providerOutcomeStatus)) return { modifiedCount: 0 };
      if (row.providerOutcome?.signature === update.$set.providerOutcome.signature) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
  };
  return { MatchModel, ContestModel };
}

function makeMatch(overrides = {}) {
  return {
    _id: "match-1", providerId: "cricapi-1", providerSource: "CRICAPI", providerState: "result",
    providerStatus: "Alpha won by 4 wickets", providerTeamA: "Alpha", providerTeamB: "Beta",
    providerScoreA: "120/8", providerScoreB: "121/6", teamA: "Alpha", teamB: "Beta", published: true,
    ...overrides,
  };
}

function makeContest(overrides = {}) {
  return {
    _id: "contest-1", match: "match-1", status: "FULL", entryClosedAt: new Date("2026-10-27T11:00:00Z"),
    settlementStatus: "NOT_READY", winnerId: null, settlementRevision: 0,
    players: [
      { user: "player-a", selectedTeam: "A", entryPaymentStatus: "PAID" },
      { user: "player-b", selectedTeam: "B", entryPaymentStatus: "NOT_REQUIRED" },
    ],
    ...overrides,
  };
}

test("confirmed CricAPI winner maps provider team names to match sides and participant selection", async () => {
  const match = makeMatch({ teamA: "Beta", teamB: "Alpha" });
  const contest = makeContest();
  const { MatchModel, ContestModel } = makeModels({ matches: [match], contests: [contest] });
  assert.deepEqual(deriveProviderMatchOutcome(match), { type: "WINNER", winningMatchSide: "B" });
  assert.deepEqual(await processProviderContestOutcomes({ MatchModel, ContestModel, now }), { matches: 1, considered: 1, processed: 1 });
  assert.equal(contest.providerOutcomeStatus, "DETERMINED");
  assert.equal(contest.providerOutcome.winningMatchSide, "B");
  assert.equal(contest.providerOutcome.determinedWinnerId, "player-b");
  assert.equal(contest.providerOutcome.providerScoreA, "120/8");
  assert.equal(contest.winnerId, null);
  assert.equal(contest.settlementStatus, "NOT_READY");
  assert.equal(contest.settlementRevision, 0);
});

test("determined results are idempotent on repeated worker checks", async () => {
  const match = makeMatch();
  const contest = makeContest();
  const models = makeModels({ matches: [match], contests: [contest] });
  assert.equal((await processProviderContestOutcomes({ ...models, now })).processed, 1);
  assert.equal((await processProviderContestOutcomes({ ...models, now: new Date(now.getTime() + 60_000) })).processed, 0);
});

test("ambiguous provider result is persisted without guessing and can be reconsidered after an update", async () => {
  const match = makeMatch({ providerStatus: "Match completed" });
  const contest = makeContest();
  const models = makeModels({ matches: [match], contests: [contest] });
  assert.equal((await processProviderContestOutcomes({ ...models, now })).processed, 1);
  assert.equal(contest.providerOutcomeStatus, "AMBIGUOUS");
  assert.equal(contest.providerOutcome.determinedWinnerId, null);
  assert.equal((await processProviderContestOutcomes({ ...models, now })).processed, 0);
  match.providerStatus = "Beta won by 2 runs";
  assert.equal((await processProviderContestOutcomes({ ...models, now: new Date(now.getTime() + 60_000) })).processed, 1);
  assert.equal(contest.providerOutcomeStatus, "DETERMINED");
  assert.equal(contest.providerOutcome.determinedWinnerId, "player-b");
});

test("ties, no-results, and abandoned results persist without assigning a winner", async (t) => {
  for (const [status, outcomeStatus] of [["Match tied", "TIE"], ["No result due to rain", "NO_RESULT"], ["Match abandoned", "ABANDONED"]]) {
    await t.test(status, async () => {
      const contest = makeContest();
      const models = makeModels({ matches: [makeMatch({ providerStatus: status })], contests: [contest] });
      assert.equal((await processProviderContestOutcomes({ ...models, now })).processed, 1);
      assert.equal(contest.providerOutcomeStatus, outcomeStatus);
      assert.equal(contest.providerOutcome.determinedWinnerId, null);
    });
  }
});

test("Test-match stumps are not considered final even when ms says result", async () => {
  const match = makeMatch({ providerStatus: "Stumps - Day 3", format: "TEST" });
  const contest = makeContest();
  const models = makeModels({ matches: [match], contests: [contest] });
  assert.equal(deriveProviderMatchOutcome(match), null);
  assert.deepEqual(await processProviderContestOutcomes({ ...models, now }), { matches: 1, considered: 0, processed: 0 });
});

test("intermediate scores never determine a contest winner", () => {
  assert.equal(deriveProviderMatchOutcome(makeMatch({ providerState: "live", providerStatus: "Alpha leads", providerScoreA: "200/3", providerScoreB: "50/8" })), null);
});

test("unpublished matches and contests without two eligible opposing participants are ignored", async () => {
  const match = makeMatch();
  const contest = makeContest({ players: [{ user: "player-a", selectedTeam: "A", entryPaymentStatus: "PAID" }] });
  const models = makeModels({ matches: [match, makeMatch({ _id: "private", published: false })], contests: [contest] });
  assert.equal((await processProviderContestOutcomes({ ...models, now })).processed, 0);
  assert.equal(contest.providerOutcomeStatus, undefined);
});

