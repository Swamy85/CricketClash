import test from "node:test";
import assert from "node:assert/strict";
import { closeDueContestEntries } from "../src/modules/contests/contestEntryClosureService.js";
import { buildCompatibleContestQuery, buildEmptyContestQuery } from "../src/modules/contests/contestAllocation.js";

function makeModels({ matches, contests }) {
  const MatchModel = {
    find() { return { select() { return this; }, lean: async () => matches.filter((row) => row.published !== false) }; },
  };
  const ContestModel = {
    find(query) {
      const ids = query.match?.$in ? new Set(query.match.$in.map(String)) : null;
      return { select() { return this; }, lean: async () => contests.filter((row) => (!ids || ids.has(String(row.match))) && !row.entryClosedAt && ["OPEN", "WAITING", "FULL"].includes(row.status) && (!query.expiresAt || new Date(row.expiresAt) <= query.expiresAt.$lte)) };
    },
    async updateOne(filter, update) {
      const row = contests.find((item) => String(item._id) === String(filter._id));
      if (!row || row.entryClosedAt || !filter.status.$in.includes(row.status)) return { modifiedCount: 0 };
      if (new Date(row.expiresAt).getTime() !== new Date(filter.expiresAt).getTime()) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
  };
  return { MatchModel, ContestModel };
}

const now = new Date("2026-10-27T12:00:00.000Z");

test("scheduled cutoff closes only published eligible contests without changing participants or settlement", async () => {
  const matches = [
    { _id: "scheduled", published: true, status: "upcoming", startTime: new Date("2026-10-27T11:00:00Z") },
    { _id: "private", published: false, status: "upcoming", startTime: new Date("2026-10-27T10:00:00Z") },
  ];
  const player = { user: "player-a", entryPaymentStatus: "PAID", selectedTeam: "A" };
  const contests = [
    { _id: "due", match: "scheduled", status: "WAITING", expiresAt: new Date("2026-10-27T11:30:00Z"), players: [player], settlementStatus: "NOT_READY", winnerId: null },
    { _id: "private-contest", match: "private", status: "OPEN", expiresAt: new Date("2026-10-27T10:00:00Z"), players: [], settlementStatus: "NOT_READY", winnerId: null },
    { _id: "future", match: "scheduled", status: "OPEN", expiresAt: new Date("2026-10-27T13:00:00Z"), players: [], settlementStatus: "NOT_READY", winnerId: null },
  ];
  const { MatchModel, ContestModel } = makeModels({ matches, contests });
  assert.deepEqual(await closeDueContestEntries({ MatchModel, ContestModel, now }), { checked: 2, closed: 2 });
  assert.equal(contests[0].entryClosedAt.toISOString(), "2026-10-27T11:00:00.000Z");
  assert.deepEqual(contests[0].players, [player]);
  assert.equal(contests[0].settlementStatus, "NOT_READY");
  assert.equal(contests[0].winnerId, null);
  assert.equal(contests[1].entryClosedAt, undefined);
  assert.equal(contests[2].entryClosedAt.toISOString(), "2026-10-27T11:00:00.000Z");
});

test("confirmed provider live closes entries before schedule; postponed and missing schedules remain safe", async () => {
  const matches = [
    { _id: "live", published: true, status: "upcoming", providerState: "live", providerLastSyncedAt: new Date("2026-10-27T11:55:00Z"), startTime: new Date("2026-10-27T15:00:00Z") },
    { _id: "postponed", published: true, status: "upcoming", providerState: "fixture", providerStatus: "Match postponed", startTime: new Date("2026-10-27T10:00:00Z") },
    { _id: "missing", published: true, status: "upcoming", startTime: null },
  ];
  const contests = matches.map((match) => ({ _id: `c-${match._id}`, match: match._id, status: "OPEN", expiresAt: new Date("2026-10-27T10:00:00Z"), players: [], settlementStatus: "NOT_READY", winnerId: null }));
  const { MatchModel, ContestModel } = makeModels({ matches, contests });
  assert.deepEqual(await closeDueContestEntries({ MatchModel, ContestModel, now }), { checked: 3, closed: 1 });
  assert.equal(contests[0].entryClosedAt.toISOString(), "2026-10-27T11:55:00.000Z");
  assert.equal(contests[1].entryClosedAt, undefined);
  assert.equal(contests[2].entryClosedAt, undefined);
});

test("repeat and concurrent closure checks close each contest once", async () => {
  const match = { _id: "m", published: true, status: "upcoming", startTime: new Date("2026-10-27T11:00:00Z") };
  const contests = [{ _id: "c", match: "m", status: "OPEN", expiresAt: match.startTime, players: [], settlementStatus: "NOT_READY" }];
  const models = makeModels({ matches: [match], contests });
  const [first, second] = await Promise.all([
    closeDueContestEntries({ ...models, now }),
    closeDueContestEntries({ ...models, now }),
  ]);
  assert.equal(first.closed + second.closed, 1);
  assert.equal((await closeDueContestEntries({ ...models, now })).closed, 0);
});

test("late and concurrent joins cannot reserve a contest after atomic closure", () => {
  const shared = { matchId: "m", tier: "BRONZE", entryFee: 50, prizePool: 90, userId: "u", selectedTeam: "A", now };
  const compatibleQuery = buildCompatibleContestQuery(shared);
  const emptyQuery = buildEmptyContestQuery(shared);
  assert.equal(compatibleQuery.entryClosedAt, null);
  assert.equal(emptyQuery.entryClosedAt, null);
  const contestClosedBetweenReadAndReservation = { entryClosedAt: new Date("2026-10-27T11:59:59Z") };
  assert.notEqual(contestClosedBetweenReadAndReservation.entryClosedAt, compatibleQuery.entryClosedAt);
  assert.notEqual(contestClosedBetweenReadAndReservation.entryClosedAt, emptyQuery.entryClosedAt);
});
