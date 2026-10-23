import test from "node:test";
import assert from "node:assert/strict";

import { createWalletOperations } from "../src/modules/wallet/walletService.js";
import { contestRefundReference } from "../src/modules/contests/contestSettlementService.js";
import { reconcilePendingContestEntries } from "../src/modules/contests/contestPaymentRecoveryService.js";
import Contest from "../src/models/Contest.js";
import Wallet from "../src/models/Wallet.js";
import WalletTransaction from "../src/models/WalletTransaction.js";

const USER = "64b000000000000000000001";
const CONTEST = "64b000000000000000000002";
const ID = "64b000000000000000000003";

function makeWalletHarness({ balance = 100, reservedBalance = 0, failLedgerCreate = false } = {}) {
  const state = {
    wallet: { _id: ID, user: USER, balance, reservedBalance },
    transactions: [],
  };
  let lock = Promise.resolve();
  let shouldFailLedgerCreate = failLedgerCreate;

  const matches = (transaction, filter) => {
    if (filter.$or) return filter.$or.some((part) => matches(transaction, part));
    return Object.entries(filter).every(([key, value]) => String(transaction[key]) === String(value));
  };

  const WalletTransactionModel = {
    findOne(filter) {
      const find = () => state.transactions.find((transaction) => matches(transaction, filter)) || null;
      return {
        session() { return Promise.resolve(find()); },
        then(resolve, reject) { return Promise.resolve(find()).then(resolve, reject); },
      };
    },
    async create(records) {
      if (shouldFailLedgerCreate) {
        shouldFailLedgerCreate = false;
        throw new Error("simulated ledger write failure");
      }
      const [record] = records;
      if (state.transactions.some((item) => item.user === record.user && item.reference === record.reference)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
      const created = { _id: `tx-${state.transactions.length + 1}`, ...record };
      state.transactions.push(created);
      return [created];
    },
  };

  const WalletModel = {
    async findOneAndUpdate(filter, update, options = {}) {
      if (options.upsert && !state.wallet) {
        state.wallet = { _id: ID, user: filter.user, balance: 0, reservedBalance: 0 };
      }
      if (!state.wallet) return null;
      if (update.$inc?.balance !== undefined) {
        const change = update.$inc.balance;
        if (change < 0 && state.wallet.balance - state.wallet.reservedBalance < -change) return null;
        if (change > 0 && state.wallet.balance + change > Number.MAX_SAFE_INTEGER) return null;
        state.wallet.balance += change;
      }
      return { ...state.wallet };
    },
  };

  const operations = createWalletOperations({
    WalletModel,
    WalletTransactionModel,
    isValidObjectId: (value) => /^[a-f0-9]{24}$/i.test(String(value)),
    startSession: async () => ({
      async withTransaction(callback) {
        const previous = lock;
        let release;
        lock = new Promise((resolve) => { release = resolve; });
        await previous;
        const walletBefore = state.wallet ? { ...state.wallet } : null;
        const transactionsBefore = [...state.transactions];
        try {
          return await callback();
        } catch (error) {
          state.wallet = walletBefore;
          state.transactions = transactionsBefore;
          throw error;
        } finally {
          release();
        }
      },
      async endSession() {},
    }),
  });

  return { ...operations, state };
}

test("concurrent retries for one contest entry debit the wallet once", async () => {
  const harness = makeWalletHarness({ balance: 100 });
  const args = {
    userId: USER,
    amount: 50,
    reference: `contest-entry:${CONTEST}`,
    type: "CONTEST_ENTRY",
    contestId: CONTEST,
  };
  const results = await Promise.all([
    harness.debitWallet(args),
    harness.debitWallet(args),
    harness.debitWallet(args),
  ]);
  assert.equal(harness.state.wallet.balance, 50);
  assert.equal(harness.state.transactions.length, 1);
  assert.ok(results.every((result) => result.reference === args.reference));
});

test("insufficient funds do not change balance or create a ledger row", async () => {
  const harness = makeWalletHarness({ balance: 25 });
  await assert.rejects(
    harness.debitWallet({ userId: USER, amount: 50, reference: "contest-entry:low-funds", type: "CONTEST_ENTRY" }),
    /Insufficient available coins/
  );
  assert.equal(harness.state.wallet.balance, 25);
  assert.equal(harness.state.transactions.length, 0);
});

test("concurrent distinct debits cannot overdraw the available wallet balance", async () => {
  const harness = makeWalletHarness({ balance: 100 });
  const attempts = await Promise.allSettled([
    harness.debitWallet({ userId: USER, amount: 80, reference: "entry:one", type: "CONTEST_ENTRY" }),
    harness.debitWallet({ userId: USER, amount: 50, reference: "entry:two", type: "CONTEST_ENTRY" }),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  assert.ok(harness.state.wallet.balance >= 0);
  assert.equal(harness.state.transactions.length, 1);
});

test("wallet and ledger writes roll back together after a transaction failure", async () => {
  const harness = makeWalletHarness({ balance: 100, failLedgerCreate: true });
  const args = { userId: USER, amount: 50, reference: "contest-entry:retry", type: "CONTEST_ENTRY" };
  await assert.rejects(harness.debitWallet(args), /simulated ledger write failure/);
  assert.equal(harness.state.wallet.balance, 100);
  assert.equal(harness.state.transactions.length, 0);

  await harness.debitWallet(args);
  assert.equal(harness.state.wallet.balance, 50);
  assert.equal(harness.state.transactions.length, 1);
});

test("duplicate settlement credit retries use one stable wallet transaction", async () => {
  const harness = makeWalletHarness({ balance: 10 });
  const args = {
    userId: USER,
    amount: 90,
    reference: `contest-winning:${CONTEST}:0:${USER}`,
    type: "CONTEST_WINNING",
    contestId: CONTEST,
  };
  await harness.creditWallet(args);
  await harness.creditWallet(args);
  assert.equal(harness.state.wallet.balance, 100);
  assert.equal(harness.state.transactions.length, 1);
});

test("deadline and result settlement refunds share the same revision key", () => {
  assert.equal(
    contestRefundReference(CONTEST, USER, 3),
    contestRefundReference(CONTEST, USER, 3)
  );
  assert.notEqual(
    contestRefundReference(CONTEST, USER, 3),
    contestRefundReference(CONTEST, USER, 4)
  );
});

test("pending contest entry recovery recognizes an already committed charge", async () => {
  const originalFindOne = WalletTransaction.findOne;
  const originalUpdateOne = Contest.updateOne;
  const originalFindById = Contest.findById;
  const paidContest = {
    _id: CONTEST,
    players: [{ user: USER, entryPaymentStatus: "PAID", refundStatus: "NOT_REQUIRED" }],
  };
  let paymentStateUpdated = false;
  WalletTransaction.findOne = () => ({ lean: async () => ({ status: "COMPLETED" }) });
  Contest.updateOne = async (_query, update) => {
    paymentStateUpdated = update.$set["players.$.entryPaymentStatus"] === "PAID";
    return { modifiedCount: 1 };
  };
  Contest.findById = () => ({ lean: async () => paidContest });
  try {
    const result = await reconcilePendingContestEntries({
      _id: CONTEST,
      players: [{ user: USER, entryPaymentStatus: "PENDING", joinedAt: new Date() }],
    });
    assert.equal(paymentStateUpdated, true);
    assert.equal(result.players[0].entryPaymentStatus, "PAID");
  } finally {
    WalletTransaction.findOne = originalFindOne;
    Contest.updateOne = originalUpdateOne;
    Contest.findById = originalFindById;
  }
});

test("financial uniqueness indexes cover idempotency and reversal records", () => {
  const walletIndexes = Wallet.schema.indexes();
  const transactionIndexes = WalletTransaction.schema.indexes();
  assert.ok(walletIndexes.some(([keys, options]) => keys.user === 1 && options.unique));
  assert.ok(transactionIndexes.some(([keys, options]) => keys.user === 1 && keys.reference === 1 && options.unique));
  assert.ok(transactionIndexes.some(([keys, options]) => keys.provider === 1 && keys.providerPaymentId === 1 && options.unique));
  assert.ok(transactionIndexes.some(([keys, options]) => keys.reversesTransaction === 1 && options.unique));
});

test("contest schema permits distinct opposing players and rejects duplicate participation", async () => {
  const otherUser = "64b000000000000000000004";
  const contest = (players) => new Contest({
    match: CONTEST,
    tier: "BRONZE",
    entryFee: 50,
    prizePool: 90,
    platformFeePercentage: 10,
    platformFee: 10,
    winnerPayout: 90,
    players,
    expiresAt: new Date(Date.now() + 60_000),
    createdBy: USER,
  });
  await assert.doesNotReject(contest([
    { user: USER, selectedTeam: "A" },
    { user: otherUser, selectedTeam: "B" },
  ]).validate());
  await assert.rejects(
    contest([
      { user: USER, selectedTeam: "A" },
      { user: USER, selectedTeam: "B" },
    ]).validate(),
    (error) => Boolean(error.errors?.players)
  );
  const joinRequestIndex = Contest.schema.indexes().find(([keys]) => keys["players.joinRequestId"] === 1);
  assert.ok(joinRequestIndex);
  assert.equal(joinRequestIndex[1].unique, true);
  assert.deepEqual(joinRequestIndex[1].partialFilterExpression, { "players.joinRequestId": { $type: "string" } });
});
