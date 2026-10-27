import test from "node:test";
import assert from "node:assert/strict";
import Match from "../src/models/Match.js";
import Contest from "../src/models/Contest.js";
import {
  getAdminMatchCounts,
  listAdminMatches,
  listAdminMatchPublicationStatus,
  publishAdminMatch,
} from "../src/modules/matches/matchService.js";
import { postPublishAdminMatch } from "../src/modules/matches/matchController.js";
import { publishMatchAndEnsureContestQueues } from "../src/modules/contests/contestService.js";
import { CONTEST_TIERS } from "../src/modules/contests/contestValidation.js";

const id = "64b000000000000000000001";

test("admin match list and status counts include only published matches", async () => {
  const originalFind = Match.find;
  const originalCount = Match.countDocuments;
  const filters = [];
  const publishedMatch = { _id: id, published: true, status: "upcoming" };
  const query = { sort() { return this; }, limit() { return this; }, lean: async () => [publishedMatch] };
  Match.find = (filter) => { filters.push(filter); return query; };
  Match.countDocuments = async (filter) => { filters.push(filter); return 1; };
  try {
    const listed = await listAdminMatches({ recent: true, limit: 20 });
    assert.deepEqual(listed, [publishedMatch]);
    const counts = await getAdminMatchCounts();
    assert.deepEqual(filters, [
      { published: true },
      { published: true },
      { published: true, status: "upcoming" },
      { published: true, status: "live" },
      { published: true, status: "completed" },
    ]);
    assert.deepEqual(counts, { total: 1, upcoming: 1, live: 1, completed: 1 });
  } finally {
    Match.find = originalFind;
    Match.countDocuments = originalCount;
  }
});

test("admin live-center publication status endpoint query includes published and unpublished provider records", async () => {
  const originalFind = Match.find;
  const originalAggregate = Contest.aggregate;
  let queryFilter;
  let selected;
  const query = {
    select(fields) { selected = fields; return this; },
    sort() { return this; }, limit() { return this; }, lean: async () => [{ _id: id, providerId: "provider-1", published: false }],
  };
  Match.find = (filter) => { queryFilter = filter; return query; };
  Contest.aggregate = async (pipeline) => {
    assert.deepEqual(pipeline[0].$match.match.$in, [id]);
    return [];
  };
  try {
    const matches = await listAdminMatchPublicationStatus();
    assert.deepEqual(queryFilter, {});
    assert.equal(selected, "_id providerId published providerSource automaticContestGeneration automaticContestTiers teamA teamB startTime status");
    assert.equal(matches[0].published, false);
    assert.equal(matches[0].contestQueuesReady, false);
  } finally {
    Match.find = originalFind;
    Contest.aggregate = originalAggregate;
  }
});

test("publishing seeds and confirms all eight queues and is safe to repeat", async () => {
  const match = { _id: id, status: "upcoming", startTime: new Date(Date.now() + 60 * 60_000), published: false, automaticContestGeneration: false };
  const queueTiers = new Set();
  let queuesCreated = 0;
  const MatchModel = {
    findById: () => ({ lean: async () => ({ ...match, automaticContestTiers: [...queueTiers] }) }),
    updateOne: async (_filter, update) => {
      Object.assign(match, update.$set);
      return { matchedCount: 1 };
    },
  };
  const ContestModel = { distinct: async (_field, filter) => {
    assert.deepEqual(filter.tier.$in, Object.keys(CONTEST_TIERS));
    return [...queueTiers];
  } };
  const publishQueues = (args) => publishMatchAndEnsureContestQueues({
    ...args,
    ensureQueues: async () => {
      for (const tier of Object.keys(CONTEST_TIERS)) {
        if (!queueTiers.has(tier)) {
          queuesCreated += 1;
          queueTiers.add(tier);
        }
      }
    },
  });
  const first = await publishAdminMatch(id, "64b000000000000000000002", { MatchModel, ContestModel, publishQueues });
  const second = await publishAdminMatch(id, "64b000000000000000000002", { MatchModel, ContestModel, publishQueues });
  assert.equal(first.published, true);
  assert.equal(second.published, true);
  assert.deepEqual([...queueTiers].sort(), Object.keys(CONTEST_TIERS).sort());
  assert.equal(queuesCreated, 8);
});

test("a partial queue failure is reported and retry completes the same tiers", async () => {
  const match = { _id: id, status: "upcoming", startTime: new Date(Date.now() + 60 * 60_000), published: false, automaticContestGeneration: false };
  const queueTiers = new Set();
  let attempts = 0;
  const MatchModel = {
    findById: () => ({ lean: async () => ({ ...match }) }),
    updateOne: async (_filter, update) => { Object.assign(match, update.$set); return { matchedCount: 1 }; },
  };
  const ContestModel = { distinct: async () => [...queueTiers] };
  const publishQueues = (args) => publishMatchAndEnsureContestQueues({
    ...args,
    ensureQueues: async () => {
      for (const tier of Object.keys(CONTEST_TIERS)) {
        if (!queueTiers.has(tier)) {
          attempts += 1;
          if (attempts === 4) throw new Error("simulated queue write failure");
          queueTiers.add(tier);
        }
      }
    },
  });
  await assert.rejects(publishAdminMatch(id, "64b000000000000000000002", { MatchModel, ContestModel, publishQueues }), {
    status: 503,
    code: "MATCH_PUBLICATION_INCOMPLETE",
  });
  assert.equal(match.published, false, "incomplete tier setup must remain unavailable to users");
  await publishAdminMatch(id, "64b000000000000000000002", { MatchModel, ContestModel, publishQueues });
  assert.equal(match.published, true);
  assert.deepEqual([...queueTiers].sort(), Object.keys(CONTEST_TIERS).sort());
});

test("publish endpoint rejects non-admin users before running publication logic", async () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await postPublishAdminMatch({ user: { role: "player" }, params: { id }, body: {} }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});
