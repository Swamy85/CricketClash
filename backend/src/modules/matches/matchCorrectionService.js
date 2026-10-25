import mongoose from "mongoose";
import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";
import PlatformLedgerEntry from "../../models/PlatformLedgerEntry.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import Wallet from "../../models/Wallet.js";
import { settleMatchContests } from "../contests/contestSettlementService.js";
import { notifyUser } from "../../services/notificationService.js";
import { formatMatchResult } from "../../services/matchResultLabel.js";
import { announceMatchEvent } from "../../services/telegramNotificationService.js";

const REFUND_RESULTS = new Set(["tie", "no_result"]);

function makeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function applyCorrectionDebits(contests, correction) {
  const operations = [];
  const platformReversals = [];
  const playerRefunded = [];
  const correctedResultIsRefund = REFUND_RESULTS.has(correction.result);
  const originalResultWasRefund = REFUND_RESULTS.has(correction.previousResult);

  for (const contest of contests) {
    const oldPayouts = await WalletTransaction.find({
      contest: contest._id,
      type: "CONTEST_WINNING",
      direction: "CREDIT",
      status: "COMPLETED",
    }).lean();

    for (const oldPayout of oldPayouts) {
      if (
        await WalletTransaction.exists({
          reversesTransaction: oldPayout._id,
        })
      ) {
        continue;
      }

      operations.push({
        user: oldPayout.user,
        amount: oldPayout.amount,
        contest: contest._id,
        sourceTransaction: oldPayout._id,
        reference: `result-correction:${correction.revision}:${contest._id}:reverse-payout:${oldPayout._id}`,
        description: `Reverse contest payout: ${correction.reason}`,
      });
    }

    if (
      contest.players.length === 2 &&
      originalResultWasRefund &&
      !correctedResultIsRefund
    ) {
      for (const player of contest.players) {
        const refunds = await WalletTransaction.find({
          user: player.user,
          contest: contest._id,
          type: "CONTEST_REFUND",
          status: "COMPLETED",
        }).lean();

        for (const refund of refunds) {
          playerRefunded.push({ contestId: contest._id, userId: player.user });

          if (
            await WalletTransaction.exists({
              reversesTransaction: refund._id,
            })
          ) {
            continue;
          }

          operations.push({
            user: player.user,
            amount: refund.amount,
            contest: contest._id,
            sourceTransaction: refund._id,
            reference: `result-correction:${correction.revision}:${contest._id}:reclaim-refund:${refund._id}`,
            description: `Reverse contest refund: ${correction.reason}`,
          });
        }
      }
    }

    const platformFees = await PlatformLedgerEntry.find({
      contest: contest._id,
      type: "PLATFORM_FEE",
      direction: "CREDIT",
    }).lean();

    if (correctedResultIsRefund && !originalResultWasRefund) {
      for (const platformFee of platformFees) {
        if (
          await PlatformLedgerEntry.exists({
            reversesEntry: platformFee._id,
          })
        ) {
          continue;
        }

        platformReversals.push({
          contest: contest._id,
          match: contest.match,
          amount: platformFee.amount,
          sourceEntry: platformFee._id,
          reference: `result-correction:${correction.revision}:${contest._id}:reverse-platform-fee:${platformFee._id}`,
        });
      }
    }
  }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      for (const operation of operations) {
        const existing = await WalletTransaction.findOne({
          user: operation.user,
          reference: operation.reference,
        }).session(session);

        if (existing) {
          if (
            existing.amount !== operation.amount ||
            existing.type !== "ADMIN_ADJUSTMENT" ||
            existing.direction !== "DEBIT" ||
            existing.status !== "COMPLETED"
          ) {
            throw new Error("A result correction reference has conflicting ledger data.");
          }
          continue;
        }

        const wallet = await Wallet.findOne({ user: operation.user }).session(session);
        if (!wallet) {
          throw new Error("A player's wallet is unavailable for result correction.");
        }

        const updatedWallet = await Wallet.findOneAndUpdate(
          {
            _id: wallet._id,
            $expr: {
              $gte: [
                { $subtract: ["$balance", "$reservedBalance"] },
                operation.amount,
              ],
            },
          },
          { $inc: { balance: -operation.amount } },
          { new: true, session }
        );

        if (!updatedWallet) {
          throw new Error(
            "A player has insufficient available coins to safely reverse the previous settlement."
          );
        }

        await WalletTransaction.create(
          [
            {
              user: operation.user,
              wallet: wallet._id,
              type: "ADMIN_ADJUSTMENT",
              amount: operation.amount,
              direction: "DEBIT",
              status: "COMPLETED",
              reference: operation.reference,
              contest: operation.contest,
              initiatedBy: correction.admin,
              reversesTransaction: operation.sourceTransaction,
              description: operation.description,
              balanceBefore: wallet.balance,
              balanceAfter: updatedWallet.balance,
              processedAt: new Date(),
            },
          ],
          { session }
        );
      }

      for (const reversal of platformReversals) {
        await PlatformLedgerEntry.updateOne(
          { reference: reversal.reference },
          {
            $setOnInsert: {
              ...reversal,
              direction: "DEBIT",
              type: "PLATFORM_FEE_REVERSAL",
              description: `Reverse platform fee: ${correction.reason}`,
              initiatedBy: correction.admin,
              reversesEntry: reversal.sourceEntry,
            },
          },
          { upsert: true, session }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  for (const entry of playerRefunded) {
    await Contest.updateOne(
      {
        _id: entry.contestId,
        players: {
          $elemMatch: {
            user: entry.userId,
            entryPaymentStatus: "REFUNDED",
          },
        },
      },
      {
        $set: {
          "players.$.entryPaymentStatus": "PAID",
          "players.$.refundStatus": "NOT_REQUIRED",
          "players.$.refundedAt": null,
        },
      }
    );
  }
}

async function processCorrection(matchId) {
  const match = await Match.findById(matchId).lean();
  const correction = match?.pendingResultCorrection;

  if (!match || !correction) return match;

  const now = new Date();
  const claimed = await Match.findOneAndUpdate(
    {
      _id: match._id,
      "pendingResultCorrection.revision": correction.revision,
      $or: [
        { "pendingResultCorrection.processingAt": null },
        {
          "pendingResultCorrection.processingAt": {
            $lt: new Date(now.getTime() - 2 * 60_000),
          },
        },
      ],
    },
    { $set: { "pendingResultCorrection.processingAt": now } },
    { new: true }
  ).lean();

  if (!claimed) return match;

  const pending = claimed.pendingResultCorrection;
  const adjustmentNeeded =
    REFUND_RESULTS.has(claimed.result) !== REFUND_RESULTS.has(pending.result) ||
    (["teamA", "teamB"].includes(claimed.result) &&
      ["teamA", "teamB"].includes(pending.result) &&
      claimed.result !== pending.result);
  const reversalCorrection = {
    ...pending,
    previousResult: claimed.result,
  };

  try {
    const contests = await Contest.find({ match: claimed._id })
      .sort({ createdAt: 1 })
      .lean();

    if (adjustmentNeeded) {
      await applyCorrectionDebits(contests, reversalCorrection);
    }

    const finalized = await Match.updateOne(
      {
        _id: claimed._id,
        "pendingResultCorrection.revision": pending.revision,
      },
      {
        $set: {
          result: pending.result,
          resultRevision: pending.revision,
          pendingResultCorrection: null,
        },
      }
    );

    if (finalized.modifiedCount !== 1) {
      throw makeError("The result correction could not be finalized.", 409);
    }

    if (adjustmentNeeded) {
      await Contest.updateMany(
        { match: claimed._id, status: { $in: ["COMPLETED", "REFUNDED", "LOCKED"] } },
        {
          $set: {
            status: "LOCKED",
            settlementStatus: "NOT_READY",
            winnerId: null,
            settledAt: null,
          },
          $unset: { activeQueueKey: "" },
        }
      );
    }

    const updatedMatch = await Match.findById(claimed._id).lean();
    await settleMatchContests(updatedMatch);
    try {
      await announceMatchEvent("VERIFIED_RESULT", updatedMatch);
    } catch (error) {
      console.error("Telegram corrected-result announcement failed.", {
        code: String(error?.code || "TELEGRAM_ANNOUNCEMENT_FAILED").slice(0, 80),
      });
    }

    const reversals = await WalletTransaction.find({
      initiatedBy: pending.admin,
      contest: { $in: contests.map((contest) => contest._id) },
      reference: {
        $regex: `^result-correction:${pending.revision}:`,
      },
      type: "ADMIN_ADJUSTMENT",
      direction: "DEBIT",
    })
      .populate("reversesTransaction", "type")
      .lean();

    for (const reversal of reversals) {
      if (reversal.reversesTransaction?.type !== "CONTEST_WINNING") continue;
      try {
        await notifyUser({
          userId: reversal.user,
          type: "PAYOUT_REVERSED",
          title: "Contest payout adjusted",
          message: `A published match result was corrected. ${reversal.amount} coins from the previous payout were reversed.`,
          reference: `payout-reversed:${pending.revision}:${reversal._id}`,
          contestId: reversal.contest,
          matchId: updatedMatch._id,
        });
      } catch (error) {
        console.error("Payout correction notification failed:", error);
      }
    }

    for (const contest of contests) {
      for (const player of contest.players) {
        try {
          await notifyUser({
            userId: player.user,
            type: "MATCH_RESULT",
            title: "Match result corrected",
            message: `The official result for ${updatedMatch.teamA} vs ${updatedMatch.teamB} was corrected to ${formatMatchResult(updatedMatch, pending.result)}.`,
            reference: `match-result-correction:${updatedMatch._id}:${pending.revision}:${player.user}`,
            contestId: contest._id,
            matchId: updatedMatch._id,
          });
        } catch (error) {
          console.error("Result correction notification failed:", error);
        }
      }
    }

    return updatedMatch;
  } catch (error) {
    await Match.updateOne(
      {
        _id: claimed._id,
        "pendingResultCorrection.revision": pending.revision,
      },
      { $set: { "pendingResultCorrection.processingAt": null } }
    );
    throw error;
  }
}

export async function correctMatchResult({ matchId, result, reason, adminId }) {
  if (!mongoose.isValidObjectId(matchId) || !mongoose.isValidObjectId(adminId)) {
    throw makeError("A valid match and administrator ID are required.");
  }

  if (!["teamA", "teamB", "tie", "no_result"].includes(result)) {
    throw makeError("Select Team A, Team B, tie, or no result.");
  }

  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
    throw makeError("A correction reason of at most 500 characters is required.");
  }

  const match = await Match.findById(matchId).lean();
  if (!match) throw makeError("Match not found.", 404);
  if (match.status !== "completed") {
    throw makeError("Only completed matches can have their result corrected.", 409);
  }

  if (!match.pendingResultCorrection) {
    if (match.result === result) {
      throw makeError("This result is already published.", 409);
    }

    await Match.updateOne(
      {
        _id: match._id,
        status: "completed",
        result: match.result,
        pendingResultCorrection: null,
      },
      {
        $set: {
          pendingResultCorrection: {
            result,
            reason: reason.trim(),
            reference: new mongoose.Types.ObjectId().toString(),
            admin: adminId,
            revision: (match.resultRevision || 0) + 1,
            startedAt: new Date(),
            processingAt: null,
          },
        },
      }
    );
  } else if (
    match.pendingResultCorrection.result !== result ||
    match.pendingResultCorrection.reason !== reason.trim()
  ) {
    throw makeError("Another result correction is already in progress.", 409);
  }

  return processCorrection(match._id);
}

export async function resumePendingMatchCorrections() {
  const pending = await Match.find({
    "pendingResultCorrection.revision": { $exists: true },
  })
    .select("_id")
    .lean();

  for (const match of pending) {
    try {
      await processCorrection(match._id);
    } catch (error) {
      console.error(`Result correction recovery failed for match ${match._id}:`, error);
    }
  }
}
