import test from "node:test";
import assert from "node:assert/strict";
import { processAutomaticContestRefunds } from "../src/modules/contests/automaticContestRefundService.js";

const now = new Date("2026-10-27T12:00:00.000Z");

function fixture({ match: matchOverrides = {}, contest: contestOverrides = {}, failAt = null } = {}) {
  const state = { failAt };
  const match = {
    _id: "match-1", published: true, status: "upcoming", result: null, resultRevision: 0,
    providerSource: "MANUAL", providerState: "", ...matchOverrides,
  };
  const contest = {
    _id: "contest-1", match: match._id, status: "WAITING", expiresAt: new Date("2026-10-27T11:00:00Z"),
    entryFee: 50, tier: "BRONZE", players: [
      { user: "player-a", selectedTeam: "A", entryPaymentStatus: "PAID", refundStatus: "NOT_REQUIRED", refundNotificationStatus: "NOT_REQUIRED" },
    ], settlementStatus: "NOT_READY", cancellationReason: null, winnerId: null, settledAt: null, settlementRevision: 0,
    ...contestOverrides,
  };
  const wallets = new Map([["player-a", { _id: "wallet-a", user: "player-a", balance: 100, reservedBalance: 20 }]]);
  const transactions = [];
  const notifications = [];
  let transactionLock = Promise.resolve();
  const query = (get) => ({ session() { return this; }, lean: async () => get() });
  const MatchModel = {
    find: () => ({ select() { return this; }, lean: async () => {
      const final = ["cancelled", "abandoned"].includes(match.status)
        || ["tie", "no_result", "abandoned", "cancelled"].includes(match.result)
        || (match.providerSource === "CRICAPI" && match.providerState === "result");
      return match.published !== false && final ? [match] : [];
    } }),
    findById: (id) => query(() => String(id) === String(match._id) ? match : null),
  };
  const ContestModel = {
    find: (filter) => ({ select() { return this; }, lean: async () => {
      if (filter.status === "REFUNDED" && filter.players?.$elemMatch?.refundNotificationStatus?.$ne === "SENT") {
        return contest.status === "REFUNDED" && contest.settlementStatus === "REFUNDED"
          && contest.players.some((player) => player.entryPaymentStatus === "REFUNDED" && player.refundStatus === "COMPLETED" && player.refundNotificationStatus !== "SENT") ? [structuredClone(contest)] : [];
      }
      if (filter.players?.$size === 1) {
        return [contest].filter((row) => row.players.length === 1
          && new Date(row.expiresAt) <= filter.expiresAt.$lte
          && filter.status.$in.includes(row.status)
          && filter.settlementStatus.$in.includes(row.settlementStatus)
          && row.winnerId == null);
      }
      return [contest].filter((row) => filter.match.$in.some((id) => String(id) === String(row.match))
        && filter.status.$in.includes(row.status)
        && filter.settlementStatus.$in.includes(row.settlementStatus)
        && row.winnerId == null);
    } }),
    findById: (id) => query(() => String(id) === String(contest._id) ? structuredClone(contest) : null),
    async updateOne(filter, update) {
      if (update.$set?.settlementStatus === "REFUND_PROCESSING") {
        if (filter.status.$in.includes(contest.status) === false
          || !filter.settlementStatus.$in.includes(contest.settlementStatus)
          || contest.winnerId != null
          || contest.providerSettlementStatus === "SETTLED") return { modifiedCount: 0 };
        if (filter.expiresAt && (new Date(contest.expiresAt) > filter.expiresAt.$lte || contest.players.length !== filter.players.$size)) return { modifiedCount: 0 };
        if (filter.match && String(contest.match) !== String(filter.match)) return { modifiedCount: 0 };
        Object.assign(contest, update.$set);
        return { modifiedCount: 1 };
      }
      if (update.$set?.["players.$.refundNotificationStatus"] === "SENT") {
        for (const player of contest.players) {
          if (String(player.user) === String(filter.players.$elemMatch.user)
            && player.refundStatus === "COMPLETED"
            && player.refundNotificationStatus === "PENDING") player.refundNotificationStatus = "SENT";
        }
        return { modifiedCount: 1 };
      }
      if (update.$set?.settlementStatus === "REFUND_REQUIRED") {
        if (state.failAt === "contest") throw new Error("contest write failed");
        contest.settlementStatus = "REFUND_REQUIRED";
        contest.cancellationReason = update.$set.cancellationReason;
        for (const player of contest.players) if (player.entryPaymentStatus === "PAID") player.refundStatus = "FAILED";
        return { modifiedCount: 1 };
      }
      if (state.failAt === "contest") throw new Error("contest write failed");
      Object.assign(contest, update.$set);
      return { modifiedCount: 1 };
    },
  };
  const WalletModel = {
    async findOneAndUpdate({ user }) {
      if (!wallets.has(user)) wallets.set(user, { _id: `wallet-${user}`, user, balance: 0, reservedBalance: 0 });
      return wallets.get(user);
    },
    async updateOne({ _id, balance }, update) {
      if (state.failAt === "wallet") throw new Error("wallet write failed");
      const wallet = [...wallets.values()].find((item) => item._id === _id);
      if (!wallet || wallet.balance !== balance) return { modifiedCount: 0 };
      wallet.balance += update.$inc.balance;
      return { modifiedCount: 1 };
    },
  };
  const WalletTransactionModel = {
    findOne: (filter) => query(() => transactions.find((record) => String(record.user) === String(filter.user) && record.reference === filter.reference) || null),
    async create(rows) {
      if (state.failAt === "transaction") throw new Error("transaction write failed");
      transactions.push(...structuredClone(rows));
    },
  };
  const startSession = async () => ({
    async withTransaction(callback) {
      const prior = transactionLock;
      let release;
      transactionLock = new Promise((resolve) => { release = resolve; });
      await prior;
      const snapshot = { contest: structuredClone(contest), wallets: structuredClone([...wallets]), transactions: structuredClone(transactions) };
      try { await callback(); }
      catch (error) {
        Object.assign(contest, snapshot.contest);
        wallets.clear(); snapshot.wallets.forEach(([key, value]) => wallets.set(key, value));
        transactions.splice(0, transactions.length, ...snapshot.transactions);
        throw error;
      } finally { release(); }
    },
    async endSession() {},
  });
  const sendNotification = async (message) => {
    assert.equal(contest.settlementStatus, "REFUNDED", "notification must follow a committed refund");
    notifications.push(message);
  };
  const reconcileEntries = async () => contest.players.some((player) => player.entryPaymentStatus === "PENDING") ? null : structuredClone(contest);
  return { state, match, contest, wallets, transactions, notifications, MatchModel, ContestModel, WalletModel, WalletTransactionModel, startSession, sendNotification, reconcileEntries };
}

function run(f) {
  return processAutomaticContestRefunds({ ...f, now });
}

test("single paid participant is refunded after cutoff with atomic status, audit reason, and notification", async () => {
  const f = fixture();
  assert.deepEqual(await run(f), { considered: 1, refunded: 1, failed: 0 });
  assert.equal(f.wallets.get("player-a").balance, 150);
  assert.equal(f.wallets.get("player-a").reservedBalance, 20);
  assert.equal(f.transactions.length, 1);
  assert.equal(f.transactions[0].type, "CONTEST_REFUND");
  assert.equal(f.transactions[0].reference, "contest-refund:contest-1:player-a:result:0");
  assert.equal(f.contest.cancellationReason, "NO_OPPONENT");
  assert.equal(f.contest.players[0].entryPaymentStatus, "REFUNDED");
  assert.equal(f.contest.players[0].refundStatus, "COMPLETED");
  assert.equal(f.contest.players[0].refundNotificationStatus, "SENT");
  assert.equal(f.notifications.length, 1);
});

test("confirmed abandoned and no-result match outcomes refund eligible paid participants", async (t) => {
  for (const [name, match, contest, reason] of [
    ["cancelled", { status: "cancelled" }, { status: "LOCKED", expiresAt: new Date("2026-10-28") }, "MATCH_CANCELLED"],
    ["abandoned", { status: "abandoned" }, { status: "LOCKED", expiresAt: new Date("2026-10-28") }, "MATCH_ABANDONED"],
    ["tied", { status: "completed", result: "tie" }, { status: "LOCKED", expiresAt: new Date("2026-10-28") }, "MATCH_NO_RESULT"],
    ["manual no result", { status: "completed", result: "no_result" }, { status: "LOCKED", expiresAt: new Date("2026-10-28") }, "MATCH_NO_RESULT"],
    ["no result", { providerSource: "CRICAPI", providerState: "result" }, { status: "LOCKED", expiresAt: new Date("2026-10-28"), providerOutcomeStatus: "NO_RESULT" }, "MATCH_NO_RESULT"],
  ]) await t.test(name, async () => {
    const f = fixture({ match, contest: { ...contest, players: [
      { user: "player-a", selectedTeam: "A", entryPaymentStatus: "PAID", refundStatus: "NOT_REQUIRED" },
      { user: "player-b", selectedTeam: "B", entryPaymentStatus: "PAID", refundStatus: "NOT_REQUIRED" },
    ] } });
    assert.equal((await run(f)).refunded, 1);
    assert.equal(f.transactions.length, 2);
    assert.equal(f.contest.cancellationReason, reason);
    assert.equal(f.contest.players.every((player) => player.entryPaymentStatus === "REFUNDED"), true);
  });
});

test("repeat and concurrent refund scans cannot issue duplicate credits or notices", async () => {
  const f = fixture();
  await Promise.all([run(f), run(f)]);
  await run(f);
  assert.equal(f.wallets.get("player-a").balance, 150);
  assert.equal(f.transactions.length, 1);
  assert.equal(f.notifications.length, 1);
});

test("wallet, transaction, and contest failures roll back and recover on a later worker check", async (t) => {
  for (const failAt of ["wallet", "transaction", "contest"]) await t.test(failAt, async () => {
    const f = fixture({ failAt });
    assert.equal((await run(f)).failed, 1);
    assert.equal(f.wallets.get("player-a").balance, 100);
    assert.equal(f.transactions.length, 0);
    assert.equal(f.contest.settlementStatus, failAt === "contest" ? "NOT_READY" : "REFUND_REQUIRED");
    assert.equal(f.notifications.length, 0);
    f.state.failAt = null;
    assert.equal((await run(f)).refunded, 1);
    assert.equal(f.wallets.get("player-a").balance, 150);
    assert.equal(f.transactions.length, 1);
  });
});

test("settled, winner-paid, ambiguous, delayed, and unconfirmed no-result contests are not refunded", async () => {
  const fixtures = [
    fixture({ contest: { settlementStatus: "SETTLED", status: "COMPLETED", winnerId: "player-a" } }),
    fixture({ match: { providerSource: "CRICAPI", providerState: "result" }, contest: { status: "LOCKED", expiresAt: new Date("2026-10-28"), providerOutcomeStatus: "AMBIGUOUS" } }),
    fixture({ match: { status: "completed", result: null }, contest: { status: "LOCKED", expiresAt: new Date("2026-10-28") } }),
  ];
  for (const f of fixtures) {
    await run(f);
    assert.equal(f.transactions.length, 0);
    assert.equal(f.notifications.length, 0);
  }
});

test("failed notifications remain pending and are retried idempotently after worker restart", async () => {
  const f = fixture();
  let reject = true;
  const sendNotification = async () => { if (reject) throw new Error("temporary delivery failure"); };
  await run({ ...f, sendNotification });
  assert.equal(f.contest.settlementStatus, "REFUNDED");
  assert.equal(f.contest.players[0].refundNotificationStatus, "PENDING");
  reject = false;
  await run({ ...f, sendNotification });
  assert.equal(f.contest.players[0].refundNotificationStatus, "SENT");
  assert.equal(f.transactions.length, 1);
});
