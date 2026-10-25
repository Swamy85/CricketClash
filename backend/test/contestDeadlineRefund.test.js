import test from "node:test";
import assert from "node:assert/strict";

import { createSingleParticipantRefundProcessor } from "../src/modules/contests/contestDeadlineService.js";
import { buildCompatibleContestQuery } from "../src/modules/contests/contestAllocation.js";
import { contestRefundReference } from "../src/modules/contests/contestSettlementService.js";
import { createWalletOperations } from "../src/modules/wallet/walletService.js";

const USER = "64b000000000000000000001";
const OPPONENT = "64b000000000000000000004";
const CONTEST = "64b000000000000000000002";
const WALLET = "64b000000000000000000003";

function makeWalletHarness() {
  const state = { wallet: { _id: WALLET, user: USER, balance: 0, reservedBalance: 0 }, transactions: [] };
  let transactionLock = Promise.resolve();
  const WalletModel = {
    async findOneAndUpdate(_query, update) {
      state.wallet.balance += update.$inc?.balance || 0;
      return { ...state.wallet };
    },
  };
  const WalletTransactionModel = {
    findOne(query) {
      const found = state.transactions.find((item) => item.user === query.user && item.reference === query.reference) || null;
      return { session: async () => found, then: (resolve, reject) => Promise.resolve(found).then(resolve, reject) };
    },
    async create(records) {
      const [record] = records;
      if (state.transactions.some((item) => item.user === record.user && item.reference === record.reference)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
      const created = { ...record };
      state.transactions.push(created);
      return [created];
    },
  };
  const walletOperations = createWalletOperations({
    WalletModel,
    WalletTransactionModel,
    isValidObjectId: (value) => /^[a-f0-9]{24}$/i.test(String(value)),
    startSession: async () => ({
      async withTransaction(callback) {
        const previous = transactionLock;
        let release;
        transactionLock = new Promise((resolve) => { release = resolve; });
        await previous;
        try { return await callback(); } finally { release(); }
      },
      async endSession() {},
    }),
  });
  return { state, creditWallet: walletOperations.creditWallet };
}

function makeContestModel(state) {
  return {
    async updateOne(filter, update) {
      if (update.$set?.cancellationReason === "NO_OPPONENT") {
        const eligible = String(state._id) === String(filter._id)
          && ["OPEN", "WAITING"].includes(state.status)
          && new Date(state.expiresAt) <= filter.expiresAt.$lte
          && state.players.length === filter.players.$size
          && !["SETTLED", "REFUNDED"].includes(state.settlementStatus)
          && state.winnerId === null;
        if (!eligible) return { modifiedCount: 0 };
        Object.assign(state, update.$set);
        delete state.activeQueueKey;
        return { modifiedCount: 1 };
      }
      if (String(state._id) !== String(filter._id)) return { modifiedCount: 0 };
      if (filter.status && state.status !== filter.status) return { modifiedCount: 0 };
      if (filter.settlementStatus?.$in && !filter.settlementStatus.$in.includes(state.settlementStatus)) return { modifiedCount: 0 };
      Object.assign(state, update.$set || {});
      return { modifiedCount: 1 };
    },
    findById(id) {
      return { lean: async () => String(id) === String(state._id) ? state : null };
    },
  };
}

function waitingContest(overrides = {}) {
  return {
    _id: CONTEST,
    status: "WAITING",
    expiresAt: new Date("2026-10-25T10:00:00.000Z"),
    settlementStatus: "NOT_READY",
    cancellationReason: null,
    winnerId: null,
    entryFee: 50,
    tier: "BRONZE",
    players: [{ user: USER, selectedTeam: "A", entryPaymentStatus: "PAID", refundStatus: "NOT_REQUIRED" }],
    ...overrides,
  };
}

test("duplicate deadline processing cancels/refunds a lone entrant once and records one wallet credit", async () => {
  const state = waitingContest();
  const model = makeContestModel(state);
  const wallet = makeWalletHarness();
  const notifications = [];
  const processRefund = createSingleParticipantRefundProcessor({
    ContestModel: model,
    now: () => new Date("2026-10-25T10:00:10.000Z"),
    reconcileEntries: async () => state,
    sendNotification: async ({ userId }) => { notifications.push(userId); },
    refundEntry: async (contest, player, revision) => {
      await wallet.creditWallet({
        userId: player.user,
        amount: contest.entryFee,
        reference: contestRefundReference(contest._id, player.user, revision),
        type: "CONTEST_REFUND",
        contestId: contest._id,
      });
      player.entryPaymentStatus = "REFUNDED";
      player.refundStatus = "COMPLETED";
    },
  });

  await Promise.all([processRefund(state, 0), processRefund(state, 0)]);
  assert.equal(state.status, "REFUNDED");
  assert.equal(state.cancellationReason, "NO_OPPONENT");
  assert.equal(state.settlementStatus, "REFUNDED");
  assert.equal(state.players[0].entryPaymentStatus, "REFUNDED");
  assert.equal(wallet.state.wallet.balance, 50);
  assert.equal(wallet.state.transactions.length, 1);
  assert.deepEqual(notifications, [USER]);
});

test("deadline refund never claims a contest with an opponent or a settled contest", async () => {
  for (const state of [
    waitingContest({ players: [
      { user: USER, selectedTeam: "A", entryPaymentStatus: "PAID" },
      { user: OPPONENT, selectedTeam: "B", entryPaymentStatus: "PAID" },
    ] }),
    waitingContest({ settlementStatus: "SETTLED", winnerId: USER }),
  ]) {
    let refundCalls = 0;
    const processRefund = createSingleParticipantRefundProcessor({
      ContestModel: makeContestModel(state),
      now: () => new Date("2026-10-25T10:00:10.000Z"),
      reconcileEntries: async () => state,
      refundEntry: async () => { refundCalls += 1; },
    });
    assert.equal(await processRefund(state), false);
    assert.equal(refundCalls, 0);
  }
});

test("deadline refund retries a pending wallet charge after a delayed match status update", async () => {
  const state = waitingContest({ players: [{
    user: USER,
    selectedTeam: "A",
    entryPaymentStatus: "PENDING",
    refundStatus: "NOT_REQUIRED",
  }] });
  const model = makeContestModel(state);
  let reconciliations = 0;
  let refunded = 0;
  let notifications = 0;
  const processRefund = createSingleParticipantRefundProcessor({
    ContestModel: model,
    now: () => new Date("2026-10-25T10:10:00.000Z"),
    reconcileEntries: async () => {
      reconciliations += 1;
      if (reconciliations === 1) return null;
      if (state.players[0].entryPaymentStatus === "PENDING") {
        state.players[0].entryPaymentStatus = "PAID";
      }
      return state;
    },
    refundEntry: async (_contest, player) => {
      if (player.entryPaymentStatus === "PAID") {
        refunded += 1;
        player.entryPaymentStatus = "REFUNDED";
      }
    },
    sendNotification: async () => {
      notifications += 1;
      if (notifications === 1) throw new Error("temporary notification failure");
    },
  });
  assert.equal(await processRefund(state), false);
  assert.equal(state.settlementStatus, "REFUND_REQUIRED");
  assert.equal(await processRefund(state, 0, { allowRetry: true }), false);
  assert.equal(await processRefund(state, 0, { allowRetry: true }), true);
  assert.equal(refunded, 1);
  assert.equal(notifications, 2);
  assert.equal(state.players[0].entryPaymentStatus, "REFUNDED");
  assert.equal(state.settlementStatus, "REFUNDED");
  // A delayed match status update does not prevent the deadline refund.
  assert.equal(state.status, "REFUNDED");
});

test("atomic compatible-slot filters allow only one concurrent join into the final slot", async () => {
  const now = new Date("2026-10-25T09:59:00.000Z");
  const state = waitingContest();
  const claim = async (user) => {
    const filter = buildCompatibleContestQuery({
      matchId: "match-id",
      tier: "BRONZE",
      entryFee: 50,
      prizePool: 100,
      userId: user,
      selectedTeam: "B",
      now,
    });
    assert.deepEqual(filter["players.1"], { $exists: false });
    assert.deepEqual(filter.$expr, { $gt: ["$expiresAt", "$$NOW"] });
    if (state.status !== filter.status || state.players.length !== 1 || state.players[0].selectedTeam !== filter["players.0.selectedTeam"] || new Date(state.expiresAt) <= now) return false;
    if (state.players.some((player) => String(player.user) === String(user))) return false;
    state.players.push({ user, selectedTeam: "B", entryPaymentStatus: "PENDING" });
    state.status = "FULL";
    return true;
  };
  const results = await Promise.all([claim(OPPONENT), claim("64b000000000000000000005")]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(state.players.length, 2);
  assert.equal(state.status, "FULL");
});
