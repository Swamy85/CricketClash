import test from "node:test";
import assert from "node:assert/strict";
import { getProviderNotificationEvents, normalizeProviderMatch, synchronizeProviderMatches } from "../src/services/cricketFeedService.js";

test("provider synchronization upserts by stable ID and preserves admin-owned match fields", async () => {
  const rows = new Map();
  const model = {
    findOne({ providerId }) {
      return { select: () => ({ lean: async () => rows.get(providerId) || null }) };
    },
    async updateOne(filter, update, options = {}) {
      const id = filter.providerId || [...rows].find(([, value]) => String(value._id) === String(filter._id))?.[0];
      const current = rows.get(id);
      if (!current && options.upsert) {
        rows.set(id, { _id: id, ...update.$setOnInsert, ...update.$set });
        return { upsertedCount: 1 };
      }
      if (current) {
        Object.assign(current, update.$set || {});
        return { upsertedCount: 0 };
      }
      return { upsertedCount: 0 };
    },
  };
  const provider = { externalId: "stable-1", teamA: "Alpha", teamB: "Beta", series: "Series", format: "T20", startTime: "2030-01-02T12:30:00.000Z", status: "Scheduled", scoreA: null, scoreB: null, scoreSummary: null, venue: "Ground" };
  assert.deepEqual(await synchronizeProviderMatches([provider], { MatchModel: model }), { inserted: 1, updated: 0 });
  const inserted = rows.get("stable-1");
  assert.equal(inserted.published, false);
  assert.equal(inserted.status, "upcoming");
  assert.equal(inserted.automaticContestGeneration, false);

  inserted.providerAdminOverride = true;
  inserted.teamA = "Admin edited team";
  inserted.automaticContestTiers = ["GOLD"];
  inserted.resultRevision = 9;
  const changedProvider = { ...provider, teamA: "Provider renamed team", status: "Live", scoreA: "12/0 (1.0)" };
  assert.deepEqual(await synchronizeProviderMatches([changedProvider], { MatchModel: model }), { inserted: 0, updated: 1 });
  assert.equal(inserted.teamA, "Admin edited team");
  assert.deepEqual(inserted.automaticContestTiers, ["GOLD"]);
  assert.equal(inserted.resultRevision, 9);
  assert.equal(inserted.providerStatus, "Live");
  assert.equal(inserted.providerTeamA, "Provider renamed team");
  assert.equal(inserted.providerScoreA, "12/0 (1.0)");
  assert.equal(rows.size, 1);
});

test("provider fixtures normalize scores, teams, logos, and GMT time safely", () => {
  const match = normalizeProviderMatch({
    id: "fixture-1",
    dateTimeGMT: "2030-01-02T12:30:00Z",
    matchType: "t20",
    status: "Match starts at 12:30 GMT",
    ms: "fixture",
    t1: "Alpha",
    t2: "Beta",
    t1s: "120/4 (16.2)",
    t2s: null,
    t1img: "https://g.cricapi.com/iapi/alpha.png",
    series: "Sample Series",
  });

  assert.equal(match.category, "upcoming");
  assert.equal(match.scoreA, "120/4 (16.2)");
  assert.equal(match.scoreB, null);
  assert.equal(match.teamALogo, "https://g.cricapi.com/iapi/alpha.png");
  assert.equal(match.startTime, "2030-01-02T12:30:00.000Z");
});

test("provider live status is not trusted when its description contradicts it", () => {
  const match = normalizeProviderMatch({
    id: "ambiguous-live",
    dateTimeGMT: "2030-01-02T12:30:00Z",
    ms: "live",
    status: "Match not started",
    t1: "Alpha",
    t2: "Beta",
  });
  assert.equal(match.category, "uncertain");
});

test("provider event detection distinguishes live, final, status updates, and Test stumps", () => {
  assert.deepEqual(getProviderNotificationEvents({ ms: "live", status: "Stumps - Day 1", category: "live" }, "m1").map((event) => event.name), ["MATCH_STARTED", "PROVIDER_MATCH_STATUS"]);
  assert.deepEqual(getProviderNotificationEvents({ ms: "result", status: "Stumps - Day 1", category: "uncertain" }, "m1").map((event) => event.name), ["PROVIDER_MATCH_STATUS"]);
  assert.deepEqual(getProviderNotificationEvents({ ms: "result", status: "India won by 5 wickets", category: "completed" }, "m1").map((event) => event.name), ["PROVIDER_FINAL_RESULT"]);
  assert.deepEqual(getProviderNotificationEvents({ ms: "result", status: "Match abandoned", category: "completed" }, "m1").map((event) => event.name), ["PROVIDER_MATCH_STATUS"]);
});

test("CricAPI events are queued only for published matches and use stable event keys", async () => {
  const rows = new Map([[
    "provider-1",
    { _id: "published-1", published: true, providerAdminOverride: true, providerStartTime: new Date("2030-01-02T12:30:00Z"), teamA: "Alpha", teamB: "Beta", competition: "Series", format: "T20", startTime: new Date("2030-01-02T12:30:00Z") },
  ]]);
  const model = {
    findOne({ providerId }) { return { select: () => ({ lean: async () => rows.get(providerId) || null }) }; },
    async updateOne() { return { modifiedCount: 1 }; },
  };
  const sent = [];
  const provider = {
    externalId: "provider-1", teamA: "Alpha", teamB: "Beta", series: "Series", format: "T20",
    startTime: "2030-01-02T12:30:00.000Z", status: "Live", providerState: "live", category: "live",
    scoreA: "8/0 (1.1)", scoreB: null,
  };
  await synchronizeProviderMatches([provider], { MatchModel: model, enqueueNotification: async (event) => sent.push(event) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, "match:published-1:started");
  assert.match(sent[0].text, /CRICKETCLASH \| MATCH UPDATE/);
  assert.match(sent[0].text, /Alpha vs Beta/);
  assert.match(sent[0].text, /Tournament \/ Series: Series/);
  assert.match(sent[0].text, /IST/);
  assert.match(sent[0].text, /Official Match Updates/);
});

test("provider schedule timestamps remain UTC instants", () => {
  const match = normalizeProviderMatch({ id: "utc-time", dateTimeGMT: "2030-01-02T12:30:00", ms: "fixture", t1: "Alpha", t2: "Beta" });
  assert.equal(match.startTime, "2030-01-02T12:30:00.000Z");
  assert.equal(match.providerState, "fixture");
});

test("provider events are not announced for imported matches awaiting admin publication", async () => {
  const row = { _id: "private-1", published: false, providerAdminOverride: false, providerStartTime: new Date("2030-01-02T12:30:00Z"), teamA: "Alpha", teamB: "Beta" };
  const model = {
    findOne() { return { select: () => ({ lean: async () => row }) }; },
    async updateOne() { return { modifiedCount: 1 }; },
  };
  let notifications = 0;
  await synchronizeProviderMatches([{
    externalId: "provider-private", teamA: "Alpha", teamB: "Beta", startTime: "2030-01-02T12:30:00.000Z",
    status: "Live", providerState: "live", category: "live",
  }], { MatchModel: model, enqueueNotification: async () => { notifications += 1; } });
  assert.equal(notifications, 0);
});

test("embedded innings scorecard maps only fields actually supplied", () => {
  const match = normalizeProviderMatch({
    id: "scorecard-1",
    ms: "result",
    status: "Alpha won by 5 wickets",
    t1: "Alpha",
    t2: "Beta",
    scorecard: [{
      inning: "Beta Inning 1",
      totals: { R: 150, O: 20, W: 7 },
      extras: { r: 8, w: 5, nb: 1 },
      batting: [{ batsman: { name: "Batter One" }, r: 40, b: 32, "4s": 4, "6s": 1, sr: 125, "dismissal-text": "c Fielder b Bowler" }],
      bowling: [{ bowler: { name: "Bowler One" }, o: 4, m: 0, r: 25, w: 2, eco: 6.25 }],
    }],
  });
  assert.equal(match.category, "completed");
  assert.equal(match.innings[0].runs, 150);
  assert.equal(match.innings[0].overs, 20);
  assert.equal(match.innings[0].batting[0].name, "Batter One");
  assert.equal(match.innings[0].bowling[0].wickets, 2);
  assert.equal(match.innings[0].extras.w, 5);
});
