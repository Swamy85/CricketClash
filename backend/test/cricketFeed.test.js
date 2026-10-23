import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProviderMatch } from "../src/services/cricketFeedService.js";

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
