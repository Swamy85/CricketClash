import test from "node:test";
import assert from "node:assert/strict";
import { listMatches } from "../src/modules/matches/matchService.js";
import { getMatchById } from "../src/modules/matches/matchService.js";
import Match from "../src/models/Match.js";
import { publishMatchAndEnsureContestQueues } from "../src/modules/contests/contestService.js";
import { selectVisibleOpenContests } from "../src/modules/contests/contestVisibility.js";
import { CONTEST_TIERS } from "../src/modules/contests/contestValidation.js";

test("public match directory query includes only explicitly published matches", async () => {
  let filter;
  const query = {
    select() { return this; }, sort() { return this; }, limit() { return this; },
    lean: async () => [],
  };
  const original = Match.find;
  Match.find = (criteria) => { filter = criteria; return query; };
  try {
    await listMatches();
    assert.deepEqual(filter, { published: true });
  } finally {
    Match.find = original;
  }
});

test("public match detail lookup also requires explicit publication", async () => {
  let filter;
  const original = Match.findOne;
  const query = { select() { return this; }, lean: async () => null };
  Match.findOne = (criteria) => { filter = criteria; return query; };
  try {
    await assert.rejects(getMatchById("507f1f77bcf86cd799439011"), { status: 404 });
    assert.deepEqual(filter, { _id: "507f1f77bcf86cd799439011", published: true });
  } finally {
    Match.findOne = original;
  }
});

test("admin publication enables the default tier templates and seeds all queues", async () => {
  const match = { _id: "match-id", createdBy: "creator", published: false, automaticContestGeneration: false, automaticContestTiers: [] };
  const updates = [];
  let ensured;
  const result = await publishMatchAndEnsureContestQueues({
    match,
    createdBy: "admin-id",
    MatchModel: { updateOne: async (...args) => { updates.push(args); } },
    ensureQueues: async (...args) => { ensured = args; },
  });
  assert.deepEqual(updates[0][1].$set, {
    providerAdminOverride: true,
    automaticContestGeneration: true,
    automaticContestTiers: Object.keys(CONTEST_TIERS),
  });
  assert.deepEqual(ensured, ["match-id", "admin-id", undefined, { allowUnpublished: true }]);
  assert.deepEqual(updates[1][1].$set, { published: true });
  assert.deepEqual(result, { newlyPublished: true, tiers: Object.keys(CONTEST_TIERS) });
});

test("contest queues are ensured again for a published auto-generation match after an interrupted attempt", async () => {
  let calls = 0;
  await publishMatchAndEnsureContestQueues({
    match: { _id: "match-id", published: true, automaticContestGeneration: true },
    createdBy: "admin-id",
    MatchModel: { updateOne: async () => {} },
    ensureQueues: async () => { calls += 1; },
  });
  assert.equal(calls, 1);
});

test("user-facing open contest selection requires published true", () => {
  const match = { _id: "m", status: "upcoming", startTime: new Date(Date.now() + 60_000) };
  const contests = [{ _id: "c", match, status: "OPEN", tier: "FREE", players: [], expiresAt: match.startTime }];
  assert.deepEqual(selectVisibleOpenContests(contests), []);
  assert.equal(selectVisibleOpenContests([{ ...contests[0], match: { ...match, published: true } }]).length, 1);
});
