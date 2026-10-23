import test from "node:test";
import assert from "node:assert/strict";
import { buildCompatibleContestQuery, buildEmptyContestQuery } from "../src/modules/contests/contestAllocation.js";

const args = {
  matchId: "match-id",
  tier: "BRONZE",
  entryFee: 50,
  prizePool: 100,
  userId: "joining-user",
  now: new Date("2026-10-23T12:00:00.000Z"),
};

test("joining team A atomically targets only the oldest eligible team B contest for the same match and tier", () => {
  const query = buildCompatibleContestQuery({ ...args, selectedTeam: "A" });
  assert.equal(query.match, args.matchId);
  assert.equal(query.tier, args.tier);
  assert.equal(query.entryFee, args.entryFee);
  assert.equal(query.prizePool, args.prizePool);
  assert.equal(query.status, "WAITING");
  assert.deepEqual(query["players.0.selectedTeam"], "B");
  assert.deepEqual(query["players.0.entryPaymentStatus"], { $in: ["PAID", "NOT_REQUIRED", "PENDING"] });
  assert.deepEqual(query["players.1"], { $exists: false });
  assert.deepEqual(query["players.user"], { $ne: args.userId });
});

test("joining team B atomically targets only an eligible team A contest", () => {
  assert.equal(buildCompatibleContestQuery({ ...args, selectedTeam: "B" })["players.0.selectedTeam"], "A");
});

test("same-team entries can never claim the same waiting contest", () => {
  assert.equal(buildCompatibleContestQuery({ ...args, selectedTeam: "A" })["players.0.selectedTeam"], "B");
  assert.notEqual(buildCompatibleContestQuery({ ...args, selectedTeam: "A" })["players.0.selectedTeam"], "A");
});

test("fallback allocation is restricted to an empty contest in the same match and tier", () => {
  const query = buildEmptyContestQuery(args);
  assert.equal(query.match, args.matchId);
  assert.equal(query.tier, args.tier);
  assert.equal(query.entryFee, args.entryFee);
  assert.equal(query.prizePool, args.prizePool);
  assert.equal(query.status, "OPEN");
  assert.deepEqual(query["players.0"], { $exists: false });
  assert.deepEqual(query["players.user"], { $ne: args.userId });
});
