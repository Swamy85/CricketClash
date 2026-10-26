import test from "node:test";
import assert from "node:assert/strict";
import { createAdminReportsService } from "../src/services/adminReportsService.js";

function createModels() {
  const aggregateCalls = [];
  const models = {
    User: {
      countDocuments: async (filter) => filter.role === "user" ? 12 : 0,
      aggregate: async (pipeline) => { aggregateCalls.push(["user", pipeline]); return [{ _id: new Date("2026-10-01T00:00:00Z"), count: 2 }]; },
    },
    Match: { countDocuments: async () => 3 },
    Contest: {
      countDocuments: async () => 4,
      aggregate: async () => [{ _id: "COMPLETED", count: 2 }, { _id: "OPEN", count: 2 }],
    },
    WalletTransaction: {
      aggregate: async (pipeline) => {
        aggregateCalls.push(["wallet", pipeline]);
        if (pipeline[1]?.$group?._id === "$type") return [
          { _id: "CONTEST_ENTRY", amount: 200 },
          { _id: "CONTEST_WINNING", amount: 170 },
          { _id: "CONTEST_REFUND", amount: 30 },
        ];
        return [{ _id: { bucket: new Date("2026-10-01T00:00:00Z"), type: "CONTEST_ENTRY" }, amount: 200 }];
      },
    },
    PlatformLedgerEntry: {
      aggregate: async (pipeline) => {
        aggregateCalls.push(["platform", pipeline]);
        if (pipeline[1]?.$group?._id === null) return [{ _id: null, revenue: 20 }];
        return [{ _id: { bucket: new Date("2026-10-01T00:00:00Z"), direction: "CREDIT" }, amount: 20 }];
      },
    },
  };
  return { models, aggregateCalls };
}

test("reports overview uses completed wallet transactions and net platform ledger totals", async () => {
  const { models } = createModels();
  const service = createAdminReportsService(models);
  const result = await service.overview({ from: "2026-10-01", to: "2026-10-03", group: "daily" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.kpis, {
    totalUsers: 12, totalMatches: 3, totalContests: 4,
    entryFeesCollected: 200, platformRevenue: 20, prizesPaid: 170, refunds: 30,
  });
  assert.equal(result.data.trend.length, 3);
  assert.equal(result.data.trend[0].entryFees, 200);
  assert.equal(result.data.trend[0].newUsers, 2);
  assert.equal(result.data.trend[2].platformRevenue, 0);
  assert.equal(result.data.contestStatuses.reduce((sum, row) => sum + row.count, 0), 4);
});

test("reports reject invalid dates and grouping before querying data", async () => {
  const { models, aggregateCalls } = createModels();
  const service = createAdminReportsService(models);
  assert.equal((await service.overview({ from: "2026-02-30", to: "2026-03-01" })).status, 400);
  assert.equal((await service.overview({ from: "2026-03-02", to: "2026-03-01" })).status, 400);
  assert.equal((await service.overview({ from: "2026-10-01", to: "2026-10-02", group: "yearly" })).status, 400);
  assert.equal(aggregateCalls.length, 0);
});
