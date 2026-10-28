import test from "node:test";
import assert from "node:assert/strict";
import { settleMatchContests } from "../src/modules/contests/contestSettlementService.js";

test("legacy settlement does not refund a provider final before provider outcome settlement", async () => {
  const providerMatch = {
    _id: "match-1", providerSource: "CRICAPI", providerState: "result",
    status: "completed", result: null,
  };
  let contestScans = 0;
  await settleMatchContests(providerMatch, {
    MatchModel: { findById: () => ({ lean: async () => providerMatch }) },
    ContestModel: { find: () => { contestScans += 1; throw new Error("legacy settlement must not scan provider contests"); } },
  });
  assert.equal(contestScans, 0);
});

test("legacy settlement remains available for manually confirmed results", async () => {
  const manualMatch = { _id: "manual-match", providerSource: "MANUAL", status: "completed", result: "teamA" };
  let contestScans = 0;
  const contestQuery = {
    sort() { return this; },
    lean: async () => [],
  };
  await settleMatchContests(manualMatch, {
    MatchModel: { findById: () => ({ lean: async () => manualMatch }) },
    ContestModel: { find: () => { contestScans += 1; return contestQuery; } },
  });
  assert.equal(contestScans, 1);
});
