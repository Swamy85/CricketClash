import mongoose from "mongoose";
import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";
import Wallet from "../../models/Wallet.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import { notifyUser } from "../../services/notificationService.js";
import { reconcilePendingContestEntries } from "./contestPaymentRecoveryService.js";
import { contestRefundReference } from "./contestSettlementService.js";

const MAX_BALANCE = Number.MAX_SAFE_INTEGER;
const ACTIVE_STATUSES = ["OPEN", "WAITING", "FULL", "LOCKED"];
const RETRY_SETTLEMENT_STATUSES = ["NOT_READY", "PENDING", "FAILED", "REFUND_REQUIRED", "REFUND_PROCESSING"];
function matchRefundReason(match, contest) {
  if (match.status === "cancelled" || match.result === "cancelled") return "MATCH_CANCELLED";
  if (match.status === "abandoned" || match.result === "abandoned") return "MATCH_ABANDONED";
  if (["tie", "no_result"].includes(match.result)) return "MATCH_NO_RESULT";

  // CricAPI outcomes must first be persisted by Phase 4. Missing/ambiguous provider
  // results are deliberately not treated as cancellation or no-result events.
  if (match.providerSource === "CRICAPI" && match.providerState === "result") {
    if (contest.providerOutcomeStatus === "ABANDONED") return "MATCH_ABANDONED";
    if (["TIE", "NO_RESULT"].includes(contest.providerOutcomeStatus)) return "MATCH_NO_RESULT";
    return null;
  }
  return null;
}

function refundNoticeReference(contest, userId, revision) {
  return `contest-refund-notice:${contest._id}:${revision ?? "deadline"}:${userId}`;
}

function exactExistingRefund(transaction, { userId, amount, reference, contestId }) {
  return transaction
    && String(transaction.user) === String(userId)
    && String(transaction.contest) === String(contestId)
    && transaction.reference === reference
    && transaction.type === "CONTEST_REFUND"
    && transaction.direction === "CREDIT"
    && transaction.status === "COMPLETED"
    && transaction.amount === amount;
}

async function queryOne(query, session) {
  if (session) query = query.session(session);
  return query.lean();
}

/** Persisted notification state allows delivery to recover after a worker restart. */
export async function deliverPendingContestRefundNotifications({ ContestModel = Contest, sendNotification = notifyUser } = {}) {
  const contests = await ContestModel.find({
    status: "REFUNDED",
    settlementStatus: "REFUNDED",
    players: { $elemMatch: {
      entryPaymentStatus: "REFUNDED",
      refundStatus: "COMPLETED",
      refundNotificationStatus: { $ne: "SENT" },
    } },
  }).select("_id match tier settlementRevision players").lean();
  let sent = 0;
  for (const contest of contests) {
    for (const player of contest.players || []) {
      if (player.entryPaymentStatus !== "REFUNDED" || player.refundStatus !== "COMPLETED" || player.refundNotificationStatus === "SENT") continue;
      try {
        await sendNotification({
          userId: player.user,
          type: "REFUND_COMPLETED",
          title: "Contest entry refunded",
          message: `Your ${contest.tier} contest entry has been refunded.`,
          reference: refundNoticeReference(contest, player.user, contest.settlementRevision ?? 0),
          contestId: contest._id,
          matchId: contest.match,
        });
        await ContestModel.updateOne({
          _id: contest._id,
          players: { $elemMatch: { user: player.user, refundStatus: "COMPLETED", refundNotificationStatus: "PENDING" } },
        }, { $set: { "players.$.refundNotificationStatus": "SENT" } });
        sent += 1;
      } catch (error) {
        console.warn("Contest refund notification failed; it will be retried.", {
          contestId: String(contest._id), userId: String(player.user),
          code: String(error?.code || "REFUND_NOTIFICATION_FAILED").slice(0, 80),
        });
      }
    }
  }
  return sent;
}

/**
 * Refunds one-player contests after their configured cutoff and refunds entries
 * for explicit cancelled, abandoned, tied, or no-result match outcomes.
 */
export async function processAutomaticContestRefunds({
  MatchModel = Match,
  ContestModel = Contest,
  WalletModel = Wallet,
  WalletTransactionModel = WalletTransaction,
  reconcileEntries = reconcilePendingContestEntries,
  sendNotification = notifyUser,
  startSession = () => mongoose.startSession(),
  now = new Date(),
} = {}) {
  await deliverPendingContestRefundNotifications({ ContestModel, sendNotification });

  const [singleParticipantContests, finalMatches] = await Promise.all([
    ContestModel.find({
      status: { $in: [...ACTIVE_STATUSES, "REFUNDED"] },
      settlementStatus: { $in: RETRY_SETTLEMENT_STATUSES },
      winnerId: null,
      expiresAt: { $lte: now },
      players: { $size: 1 },
    }).select("_id match status expiresAt entryFee tier players settlementStatus cancellationReason winnerId").lean(),
    MatchModel.find({
      published: { $ne: false },
      $or: [
        { status: { $in: ["cancelled", "abandoned"] } },
        { result: { $in: ["tie", "no_result", "abandoned", "cancelled"] } },
        { providerSource: "CRICAPI", providerState: "result" },
      ],
    }).select("_id published status result resultRevision providerSource providerState").lean(),
  ]);
  const matchesById = new Map(finalMatches.map((match) => [String(match._id), match]));
  let considered = 0;
  let refunded = 0;
  let failed = 0;
  const candidates = new Map();

  for (const contest of singleParticipantContests) {
    const match = await queryOne(MatchModel.findById(contest.match));
    if (match?.published !== false) candidates.set(String(contest._id), { contest, match, reason: "NO_OPPONENT" });
  }

  if (finalMatches.length) {
    const matchContests = await ContestModel.find({
      match: { $in: finalMatches.map((match) => match._id) },
      status: { $in: [...ACTIVE_STATUSES, "REFUNDED"] },
      settlementStatus: { $in: RETRY_SETTLEMENT_STATUSES },
      winnerId: null,
    }).select("_id match status expiresAt entryFee tier players settlementStatus cancellationReason winnerId providerOutcomeStatus").lean();
    for (const contest of matchContests) {
      const match = matchesById.get(String(contest.match));
      const reason = match && matchRefundReason(match, contest);
      if (reason) candidates.set(String(contest._id), { contest, match, reason });
    }
  }

  for (const { contest: candidate, match, reason } of candidates.values()) {
    considered += 1;
    if (!match || match.published === false || !RETRY_SETTLEMENT_STATUSES.includes(candidate.settlementStatus)) continue;
    let reconciled = await reconcileEntries(candidate);
    if (!reconciled) {
      console.info("Contest refund deferred while entry payment recovery is pending.", { contestId: String(candidate._id) });
      continue;
    }
    if (reason === "NO_OPPONENT" && reconciled.players.length !== 1) continue;
    if (reconciled.players.some((player) => player.entryPaymentStatus === "PENDING")) continue;

    const revision = Number.isSafeInteger(match.resultRevision) ? match.resultRevision : 0;
    const session = await startSession();
    let committed = false;
    let notifiedPlayers = [];
    try {
      await session.withTransaction(async () => {
        const current = await queryOne(ContestModel.findById(candidate._id), session);
        const currentMatch = await queryOne(MatchModel.findById(match._id), session);
        if (!current || !currentMatch || currentMatch.published === false || current.winnerId
          || ["SETTLED", "REFUNDED"].includes(current.settlementStatus)
          || current.providerSettlementStatus === "SETTLED") return;

        let confirmedReason = reason;
        if (reason === "NO_OPPONENT") {
          const resumeOldRefund = current.status === "REFUNDED"
            && current.cancellationReason === "NO_OPPONENT"
            && RETRY_SETTLEMENT_STATUSES.includes(current.settlementStatus);
          if ((!ACTIVE_STATUSES.includes(current.status) && !resumeOldRefund)
            || current.players.length !== 1
            || new Date(current.expiresAt) > now) return;
        } else {
          confirmedReason = matchRefundReason(currentMatch, current);
          if (!confirmedReason || confirmedReason !== reason) return;
          if (![...ACTIVE_STATUSES, "REFUNDED"].includes(current.status)) return;
        }

        const claimFilter = {
          _id: current._id,
          status: { $in: [...ACTIVE_STATUSES, "REFUNDED"] },
          settlementStatus: { $in: RETRY_SETTLEMENT_STATUSES },
          winnerId: null,
          providerSettlementStatus: { $ne: "SETTLED" },
          ...(reason === "NO_OPPONENT"
            ? { expiresAt: { $lte: now }, players: { $size: 1 } }
            : { match: currentMatch._id }),
        };
        const claim = await ContestModel.updateOne(claimFilter, {
          $set: {
            status: "REFUNDED",
            cancellationReason: confirmedReason,
            settlementStatus: "REFUND_PROCESSING",
            settlementRevision: revision,
          },
          $unset: { activeQueueKey: "" },
        }, { session });
        if (claim.modifiedCount !== 1) return;

        const players = current.players.map((player) => ({ ...player }));
        notifiedPlayers = [];
        for (const player of players) {
          if (player.entryPaymentStatus === "REFUNDED") {
            const reference = contestRefundReference(current._id, player.user, revision);
            const existing = await WalletTransactionModel.findOne({ user: player.user, reference }).session(session).lean();
            if (!exactExistingRefund(existing, { userId: player.user, amount: current.entryFee, reference, contestId: current._id })) {
              throw new Error("Participant is marked refunded without a matching completed refund transaction.");
            }
            if (player.refundNotificationStatus !== "SENT") player.refundNotificationStatus = "PENDING";
            continue;
          }
          if (player.entryPaymentStatus !== "PAID") {
            player.refundStatus = "NOT_REQUIRED";
            player.refundNotificationStatus = "NOT_REQUIRED";
            continue;
          }
          const amount = current.entryFee;
          if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Paid contest entry has an invalid refund amount.");
          const reference = contestRefundReference(current._id, player.user, revision);
          const existing = await WalletTransactionModel.findOne({ user: player.user, reference }).session(session).lean();
          if (existing) {
            if (!exactExistingRefund(existing, { userId: player.user, amount, reference, contestId: current._id })) {
              throw new Error("Existing refund transaction does not match the contest entry.");
            }
          } else {
            const wallet = await WalletModel.findOneAndUpdate(
              { user: player.user },
              { $setOnInsert: { user: player.user, balance: 0, reservedBalance: 0 } },
              { upsert: true, new: true, setDefaultsOnInsert: true, session }
            );
            const before = wallet.balance;
            if (!Number.isSafeInteger(before) || before < 0 || before + amount > MAX_BALANCE) {
              throw new Error("Wallet balance cannot safely accept contest refund.");
            }
            const updated = await WalletModel.updateOne(
              { _id: wallet._id, balance: before },
              { $inc: { balance: amount } },
              { session, runValidators: true }
            );
            if (updated.modifiedCount !== 1) throw new Error("Wallet changed during contest refund.");
            await WalletTransactionModel.create([{
              user: player.user,
              wallet: wallet._id,
              type: "CONTEST_REFUND",
              amount,
              direction: "CREDIT",
              status: "COMPLETED",
              reference,
              contest: current._id,
              balanceBefore: before,
              balanceAfter: before + amount,
              description: `Refund for ${current.tier} contest (${confirmedReason})`,
              processedAt: now,
            }], { session });
          }
          player.entryPaymentStatus = "REFUNDED";
          player.refundStatus = "COMPLETED";
          player.refundedAt = player.refundedAt || now;
          player.refundNotificationStatus = "PENDING";
          notifiedPlayers.push(player.user);
        }
        if (players.some((player) => player.entryPaymentStatus === "PENDING" || player.entryPaymentStatus === "PAID")) {
          throw new Error("Contest still has an unresolved entry payment or refund.");
        }
        const completed = await ContestModel.updateOne({
          _id: current._id,
          status: "REFUNDED",
          settlementStatus: "REFUND_PROCESSING",
          cancellationReason: confirmedReason,
        }, { $set: {
          players,
          status: "REFUNDED",
          settlementStatus: "REFUNDED",
          settledAt: now,
          settlementRevision: revision,
        } }, { session });
        if (completed.modifiedCount !== 1) throw new Error("Contest refund claim was lost before commit.");
        committed = true;
      });

      if (committed) {
        refunded += 1;
        console.info("Contest refund committed.", {
          contestId: String(candidate._id), matchId: String(match._id), reason,
          participantCount: notifiedPlayers.length,
        });
        await deliverPendingContestRefundNotifications({ ContestModel, sendNotification });
      }
    } catch (error) {
      const persisted = await ContestModel.findById(candidate._id).lean().catch(() => null);
      if (persisted?.status === "REFUNDED" && persisted.settlementStatus === "REFUNDED"
        && persisted.cancellationReason === reason) {
        refunded += 1;
        console.info("Contest refund commit confirmed after a database response error.", {
          contestId: String(candidate._id), matchId: String(match._id), reason,
        });
        await deliverPendingContestRefundNotifications({ ContestModel, sendNotification });
      } else {
        failed += 1;
        await ContestModel.updateOne({
          _id: candidate._id,
          winnerId: null,
          settlementStatus: { $in: RETRY_SETTLEMENT_STATUSES },
        }, {
          $set: {
            settlementStatus: "REFUND_REQUIRED",
            cancellationReason: reason,
            "players.$[refundPlayer].refundStatus": "FAILED",
          },
        }, {
          arrayFilters: [{ "refundPlayer.entryPaymentStatus": "PAID", "refundPlayer.refundStatus": { $ne: "COMPLETED" } }],
        }).catch(() => null);
        console.error("Contest refund failed; it remains eligible for a later retry.", {
          contestId: String(candidate._id), matchId: String(match._id), reason,
          code: String(error?.code || "CONTEST_REFUND_FAILED").slice(0, 80),
        });
      }
    } finally {
      await session.endSession();
    }
  }

  console.info("Automatic contest refund check finished.", {
    singleParticipantCandidates: singleParticipantContests.length,
    finalMatches: finalMatches.length,
    considered, refunded, failed,
  });
  return { considered, refunded, failed };
}
