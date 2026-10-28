import test from "node:test";
import assert from "node:assert/strict";
import { synchronizeProviderMatches } from "../src/services/cricketFeedService.js";
import { processProviderContestOutcomes } from "../src/modules/contests/contestOutcomeService.js";
import { settleProviderContestOutcomes } from "../src/modules/contests/providerContestSettlementService.js";

test("mocked CricAPI result flows from provider ID sync through outcome determination to idempotent settlement", async () => {
  const match = {
    _id: "mongo-id-1", providerId: "cricapi-id-9", providerSource: "CRICAPI", published: true,
    providerAdminOverride: true, teamA: "Alpha", teamB: "Beta", status: "live", result: null,
    resultRevision: 0, startTime: new Date("2030-01-02T12:00:00Z"),
  };
  const contest = {
    _id: "contest-1", match: match._id, status: "LOCKED", entryClosedAt: new Date("2030-01-02T12:20:00Z"),
    settlementStatus: "PENDING", providerSettlementStatus: "PENDING", providerOutcomeStatus: "PENDING",
    providerOutcome: null, winnerId: null, prizePool: 100, platformFeePercentage: 10, platformFee: 10,
    winnerPayout: 90, tier: "BRONZE",
    players: [
      { user: "user-a", selectedTeam: "A", entryPaymentStatus: "PAID" },
      { user: "user-b", selectedTeam: "B", entryPaymentStatus: "PAID" },
    ],
  };
  const MatchModel = {
    findOne: () => ({ select() { return this; }, lean: async () => ({ ...match }) }),
    async updateOne(_filter, update) { Object.assign(match, update.$set); return { modifiedCount: 1 }; },
    find(query) {
      const eligible = query.providerSource === "CRICAPI"
        ? match.published && match.providerSource === query.providerSource && match.providerState === query.providerState
        : match.published && match.providerSource === "CRICAPI" && match.providerState === "result" && match.result === null;
      return { select() { return this; }, lean: async () => eligible ? [{ ...match }] : [] };
    },
  };
  const ContestModel = {
    find(query) {
      const settlementScan = query.providerOutcomeStatus === "DETERMINED";
      const eligible = String(query.match) === String(match._id)
        && (contest.entryClosedAt || contest.status === "LOCKED")
        && (settlementScan ? contest.providerOutcomeStatus === "DETERMINED" : [undefined, null, "PENDING", "AMBIGUOUS"].includes(contest.providerOutcomeStatus))
        && (settlementScan ? contest.providerOutcome?.type === "WINNER" : true)
        && !["SETTLED", "REFUNDED"].includes(contest.settlementStatus);
      return { select() { return this; }, lean: async () => eligible ? [{ ...contest, players: contest.players.map((player) => ({ ...player })) }] : [] };
    },
    async updateOne(filter, update) {
      if (filter.providerOutcomeStatus?.$in
        && !filter.providerOutcomeStatus.$in.includes(contest.providerOutcomeStatus)) return { modifiedCount: 0 };
      if (filter.providerSettlementStatus?.$in
        && !filter.providerSettlementStatus.$in.includes(contest.providerSettlementStatus)) return { modifiedCount: 0 };
      if (filter.providerSettlementStatus === "PROCESSING" && contest.providerSettlementStatus !== "PROCESSING") return { modifiedCount: 0 };
      const signatureFilter = filter["providerOutcome.signature"];
      if (signatureFilter && typeof signatureFilter === "string"
        && signatureFilter !== contest.providerOutcome?.signature) return { modifiedCount: 0 };
      if (signatureFilter?.$ne && signatureFilter.$ne === contest.providerOutcome?.signature) return { modifiedCount: 0 };
      Object.assign(contest, update.$set);
      if (update.$unset?.activeQueueKey) delete contest.activeQueueKey;
      return { modifiedCount: 1 };
    },
    findOne: () => ({ select() { return this; }, lean: async () => null }),
  };
  const wallets = new Map([["user-a", { _id: "wallet-a", user: "user-a", balance: 0 }]]);
  const transactions = [];
  const fees = [];
  const WalletModel = {
    async findOneAndUpdate({ user }) { return wallets.get(user); },
    async updateOne({ _id, balance }, update) {
      const wallet = [...wallets.values()].find((item) => item._id === _id);
      if (!wallet || wallet.balance !== balance) return { modifiedCount: 0 };
      wallet.balance += update.$inc.balance;
      return { modifiedCount: 1 };
    },
  };
  const WalletTransactionModel = { async create(rows) { transactions.push(...rows); } };
  const PlatformLedgerModel = { async create(rows) { fees.push(...rows); } };
  const startSession = async () => ({ withTransaction: async (callback) => callback(), endSession: async () => {} });

  const sync = await synchronizeProviderMatches([{
    externalId: "cricapi-id-9", teamA: "Alpha", teamB: "Beta", providerState: "result",
    status: "Alpha won by 4 wickets", category: "completed", scoreA: "121/6", scoreB: "120/8",
  }], { MatchModel, now: new Date("2030-01-02T15:00:00Z"), enqueueNotification: async () => {} });
  assert.deepEqual(sync, { inserted: 0, updated: 1 });
  assert.equal(match.providerId, "cricapi-id-9");
  assert.equal(match.providerState, "result");
  assert.equal(match.providerScoreA, "121/6");
  assert.equal(match.status, "completed");

  const determined = await processProviderContestOutcomes({ MatchModel, ContestModel });
  assert.deepEqual(determined, { matches: 1, considered: 1, processed: 1 });
  assert.equal(contest.providerOutcomeStatus, "DETERMINED");
  assert.equal(contest.providerOutcome.determinedWinnerId, "user-a");
  assert.equal(contest.settlementStatus, "PENDING");

  const settlementOptions = { MatchModel, ContestModel, WalletModel, WalletTransactionModel, PlatformLedgerModel, startSession };
  assert.deepEqual(await settleProviderContestOutcomes(settlementOptions), { matches: 1, considered: 1, settled: 1, failed: 0 });
  assert.equal(wallets.get("user-a").balance, 90);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, 90);
  assert.equal(fees.length, 1);
  assert.equal(fees[0].amount, 10);
  assert.equal(contest.settlementStatus, "SETTLED");
  assert.equal(contest.winnerId, "user-a");
  assert.deepEqual(await settleProviderContestOutcomes(settlementOptions), { matches: 1, considered: 0, settled: 0, failed: 0 });
  assert.equal(wallets.get("user-a").balance, 90);
  assert.equal(transactions.length, 1);
  assert.equal(fees.length, 1);
});
