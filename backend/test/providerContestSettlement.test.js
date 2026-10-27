import test from "node:test";
import assert from "node:assert/strict";
import { settleProviderContestOutcomes } from "../src/modules/contests/providerContestSettlementService.js";

function fixture({ contest: overrides = {}, failAt = null } = {}) {
  const state = { failAt };
  const match = { _id: "match-1", providerId: "cricapi-1", providerSource: "CRICAPI", providerState: "result", published: true, result: null, resultRevision: 0 };
  const contest = {
    _id: "contest-1", match: match._id, status: "LOCKED", entryClosedAt: new Date(),
    settlementStatus: "PENDING", providerSettlementStatus: "PENDING", providerOutcomeStatus: "DETERMINED",
    providerOutcome: { type: "WINNER", winningMatchSide: "B", determinedWinnerId: "player-b", providerMatchId: "cricapi-1", signature: "sig-1" },
    tier: "BRONZE", prizePool: 100, platformFeePercentage: 10, platformFee: 10, winnerPayout: 90,
    players: [
      { user: "player-a", selectedTeam: "A", entryPaymentStatus: "PAID" },
      { user: "player-b", selectedTeam: "B", entryPaymentStatus: "PAID" },
    ],
    ...overrides,
  };
  const wallets = new Map([[
    "player-b", { _id: "wallet-b", user: "player-b", balance: 20, reservedBalance: 0 },
  ]]);
  const transactions = [];
  const fees = [];
  const clone = (value) => structuredClone(value);
  const MatchModel = { find: () => ({ select() { return this; }, lean: async () => match.published !== false && match.providerSource === "CRICAPI" && match.providerState === "result" && match.result === null ? [match] : [] }) };
  const ContestModel = {
    find: () => ({ select() { return this; }, lean: async () => [contest].filter((row) => String(row.match) === String(match._id) && (row.entryClosedAt || row.status === "LOCKED") && ["FULL", "LOCKED"].includes(row.status) && !["SETTLED", "REFUNDED"].includes(row.settlementStatus) && row.providerOutcomeStatus === "DETERMINED" && row.providerOutcome?.type === "WINNER" && row.providerSettlementStatus !== "SETTLED") }),
    async updateOne(filter, update) {
      if (filter.providerSettlementStatus && (typeof filter.providerSettlementStatus === "string"
        ? filter.providerSettlementStatus !== contest.providerSettlementStatus
        : !filter.providerSettlementStatus.$in.includes(contest.providerSettlementStatus))) return { modifiedCount: 0 };
      if (filter["providerOutcome.signature"] && filter["providerOutcome.signature"] !== contest.providerOutcome.signature) return { modifiedCount: 0 };
      if (filter["providerOutcome.determinedWinnerId"] && filter["providerOutcome.determinedWinnerId"] !== contest.providerOutcome.determinedWinnerId) return { modifiedCount: 0 };
      if (update.$set.providerSettlementStatus === "PROCESSING") contest.providerSettlementStatus = "PROCESSING";
      else Object.assign(contest, update.$set);
      return { modifiedCount: 1 };
    },
    findOne: () => ({ select() { return this; }, lean: async () => null }),
  };
  const WalletModel = {
    async findOneAndUpdate({ user }) {
      if (!wallets.has(user)) wallets.set(user, { _id: `wallet-${user}`, user, balance: 0, reservedBalance: 0 });
      return wallets.get(user);
    },
    async updateOne({ _id, balance }, update) {
      if (state.failAt === "wallet") throw new Error("wallet database failure");
      const wallet = [...wallets.values()].find((row) => row._id === _id);
      if (!wallet || wallet.balance !== balance) return { modifiedCount: 0 };
      wallet.balance += update.$inc.balance;
      return { modifiedCount: 1 };
    },
  };
  const WalletTransactionModel = { async create(rows) { if (state.failAt === "transaction") throw new Error("transaction database failure"); transactions.push(...rows); } };
  const PlatformLedgerModel = { async create(rows) { if (state.failAt === "fee") throw new Error("fee database failure"); fees.push(...rows); } };
  const startSession = async () => ({
    async withTransaction(callback) {
      const snapshot = { contest: clone(contest), wallets: clone([...wallets]), transactions: clone(transactions), fees: clone(fees) };
      try { await callback(); }
      catch (error) {
        Object.assign(contest, snapshot.contest);
        wallets.clear(); snapshot.wallets.forEach(([key, value]) => wallets.set(key, value));
        transactions.splice(0, transactions.length, ...snapshot.transactions);
        fees.splice(0, fees.length, ...snapshot.fees);
        throw error;
      }
    },
    async endSession() {},
  });
  return { match, contest, wallets, transactions, fees, MatchModel, ContestModel, WalletModel, WalletTransactionModel, PlatformLedgerModel, startSession, state };
}

function settle(f) {
  return settleProviderContestOutcomes({ ...f, now: new Date("2026-10-27T12:00:00Z") });
}

test("settles confirmed outcome with expected payout, fee ledger, transaction snapshots and contest fields", async () => {
  const f = fixture();
  assert.deepEqual(await settle(f), { matches: 1, considered: 1, settled: 1, failed: 0 });
  assert.equal(f.wallets.get("player-b").balance, 110);
  assert.equal(f.transactions.length, 1);
  assert.equal(f.transactions[0].type, "CONTEST_WINNING");
  assert.equal(f.transactions[0].amount, 90);
  assert.equal(f.transactions[0].balanceBefore, 20);
  assert.equal(f.transactions[0].balanceAfter, 110);
  assert.equal(f.fees.length, 1);
  assert.equal(f.fees[0].amount, 10);
  assert.equal(f.contest.winnerId, "player-b");
  assert.equal(f.contest.settlementStatus, "SETTLED");
  assert.equal(f.contest.providerSettlementStatus, "SETTLED");
});

test("repeated and concurrent worker runs never credit or record fees twice", async () => {
  const f = fixture();
  await Promise.all([settle(f), settle(f)]);
  await settle(f);
  assert.equal(f.wallets.get("player-b").balance, 110);
  assert.equal(f.transactions.length, 1);
  assert.equal(f.fees.length, 1);
});

test("database failures at wallet, transaction, or fee stages roll back and retry after restart", async (t) => {
  for (const failAt of ["wallet", "transaction", "fee"]) await t.test(failAt, async () => {
    const f = fixture({ failAt });
    const failed = await settle(f);
    assert.equal(failed.failed, 1);
    assert.equal(f.wallets.get("player-b").balance, 20);
    assert.equal(f.transactions.length, 0);
    assert.equal(f.fees.length, 0);
    assert.equal(f.contest.settlementStatus, "PENDING");
    assert.equal(f.contest.providerSettlementStatus, "PENDING");
    f.state.failAt = null;
    const recovered = await settle(f);
    assert.equal(recovered.settled, 1);
    assert.equal(f.wallets.get("player-b").balance, 110);
    assert.equal(f.transactions.length, 1);
    assert.equal(f.fees.length, 1);
  });
});

test("ineligible, ambiguous, tied, abandoned, unpublished and already settled contests are skipped", async (t) => {
  const cases = [
    ["unpublished", { match: "other-match" }, { published: false }],
    ["ambiguous", { providerOutcomeStatus: "AMBIGUOUS" }],
    ["tie", { providerOutcome: { type: "TIE", winningMatchSide: null, determinedWinnerId: null, providerMatchId: "cricapi-1", signature: "sig-1" } }],
    ["abandoned", { providerOutcome: { type: "ABANDONED", winningMatchSide: null, determinedWinnerId: null, providerMatchId: "cricapi-1", signature: "sig-1" } }],
    ["unclosed", { entryClosedAt: null, status: "FULL" }],
    ["bad financial data", { platformFee: 9 }],
  ];
  for (const [name, contestOverrides, matchOverrides] of cases) await t.test(name, async () => {
    const f = fixture({ contest: contestOverrides });
    Object.assign(f.match, matchOverrides || {});
    const result = await settle(f);
    assert.equal(result.settled, 0);
    assert.equal(f.transactions.length, 0);
    assert.equal(f.fees.length, 0);
  });
});

test("zero-fee free contest settles without invalid zero-value ledger rows", async () => {
  const f = fixture({ contest: { prizePool: 0, platformFee: 0, winnerPayout: 0, tier: "FREE" } });
  assert.equal((await settle(f)).settled, 1);
  assert.equal(f.transactions.length, 0);
  assert.equal(f.fees.length, 0);
  assert.equal(f.contest.winnerId, "player-b");
});
