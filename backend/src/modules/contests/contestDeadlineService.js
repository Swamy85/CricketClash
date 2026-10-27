
import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import PlatformLedgerEntry from "../../models/PlatformLedgerEntry.js";
import { creditWallet } from "../wallet/walletService.js";
import { contestRefundReference, settleMatchContests } from "./contestSettlementService.js";
import { ensureMissingReplacementContests } from "./contestService.js";
import {
  reconcilePendingContestEntries,
  recoverStaleContestPayments,
} from "./contestPaymentRecoveryService.js";
import { resumePendingMatchCorrections } from "../matches/matchCorrectionService.js";
import { notifyUser } from "../../services/notificationService.js";
import { announceMatchEvent } from "../../services/telegramNotificationService.js";

const PROCESS_INTERVAL_MS = 10_000;

// Refund a single player's paid entry using a stable transaction reference.
async function refundPlayer(contest, player, resultRevision = 0) {
  if (player.entryPaymentStatus === "REFUNDED") {
    return;
  }

  // Free entries and entries that were never charged need no wallet refund.
  if (player.entryPaymentStatus !== "PAID") {
    await Contest.updateOne(
      {
        _id: contest._id,
        players: {
          $elemMatch: {
            user: player.user,
            entryPaymentStatus: { $ne: "PAID" },
          },
        },
      },
      {
        $set: {
          "players.$.refundStatus": "NOT_REQUIRED",
        },
      }
    );
    return;
  }

  // Claim the refund before processing it.
  await Contest.updateOne(
    {
      _id: contest._id,
      players: {
        $elemMatch: {
          user: player.user,
          entryPaymentStatus: "PAID",
          refundStatus: {
            $in: ["NOT_REQUIRED", "PENDING", "FAILED", "PROCESSING"],
          },
        },
      },
    },
    {
      $set: {
        "players.$.refundStatus": "PROCESSING",
      },
    }
  );

  const current = await Contest.findOne({
    _id: contest._id,
    players: {
      $elemMatch: {
        user: player.user,
        entryPaymentStatus: "PAID",
        refundStatus: "PROCESSING",
      },
    },
  }).lean();

  if (!current) return;

  const currentPlayer = current.players.find(
    (item) => String(item.user) === String(player.user)
  );

  if (!currentPlayer) return;

  try {
    await creditWallet({
      userId: currentPlayer.user,
      amount: current.entryFee,
      reference: contestRefundReference(current._id, currentPlayer.user, resultRevision),
      type: "CONTEST_REFUND",
      contestId: current._id,
      description: `Refund for ${current.tier} contest`,
    });

    await Contest.updateOne(
      {
        _id: current._id,
        players: {
          $elemMatch: {
            user: currentPlayer.user,
            entryPaymentStatus: "PAID",
            refundStatus: "PROCESSING",
          },
        },
      },
      {
        $set: {
          "players.$.entryPaymentStatus": "REFUNDED",
          "players.$.refundStatus": "COMPLETED",
          "players.$.refundedAt": new Date(),
        },
      }
    );

  } catch (error) {
    console.error(
      `Refund failed for contest ${current._id}, player ${currentPlayer.user}:`,
      error.message
    );

    await Contest.updateOne(
      {
        _id: current._id,
        players: {
          $elemMatch: {
            user: currentPlayer.user,
            entryPaymentStatus: "PAID",
            refundStatus: "PROCESSING",
          },
        },
      },
      {
        $set: {
          "players.$.refundStatus": "FAILED",
        },
      }
    );
  }
}

export function createSingleParticipantRefundProcessor({
  ContestModel = Contest,
  reconcileEntries = reconcilePendingContestEntries,
  refundEntry = refundPlayer,
  sendNotification = notifyUser,
  now = () => new Date(),
} = {}) {
  return async function processSingleParticipantRefund(contest, resultRevision = 0, { allowRetry = false } = {}) {
    const processingTime = now();
    const claimed = await ContestModel.updateOne(
      {
        _id: contest._id,
        status: { $in: ["OPEN", "WAITING", "FULL"] },
        expiresAt: { $lte: processingTime },
        players: { $size: 1 },
        settlementStatus: { $nin: ["SETTLED", "REFUNDED"] },
        winnerId: null,
      },
      {
        $set: {
          status: "REFUNDED",
          cancellationReason: "NO_OPPONENT",
          settlementStatus: "REFUND_PROCESSING",
        },
        $unset: { activeQueueKey: "" },
      }
    );

    // This compare-and-set closes the contest once. Refund retries only resume
    // a previously closed no-opponent contest and still require one player.
    let refundContest = claimed.modifiedCount === 1 ? contest : null;
    if (!refundContest && allowRetry) {
      const current = await ContestModel.findById(contest._id).lean();
      if (
        current?.status === "REFUNDED" &&
        current.cancellationReason === "NO_OPPONENT" &&
        ["REFUND_PROCESSING", "REFUND_REQUIRED"].includes(current.settlementStatus) &&
        current.players.length === 1 &&
        !current.winnerId
      ) refundContest = current;
    }
    if (!refundContest) return false;

    const reconciled = await reconcileEntries(refundContest);
    if (!reconciled) {
      await ContestModel.updateOne(
        { _id: contest._id, status: "REFUNDED", cancellationReason: "NO_OPPONENT", settlementStatus: "REFUND_PROCESSING" },
        { $set: { settlementStatus: "REFUND_REQUIRED" } }
      );
      return false;
    }

    for (const player of reconciled.players) {
      await refundEntry(reconciled, player, resultRevision);
    }

    const latest = await ContestModel.findById(contest._id).lean();
    // Send the notice before marking settlement complete. If notification
    // delivery fails, the pending refund state remains eligible for retry.
    try {
      for (const player of latest?.players || []) {
        if (player.entryPaymentStatus !== "REFUNDED") continue;
        await sendNotification({
          userId: player.user,
          type: "REFUND_COMPLETED",
          title: "Contest entry refunded",
          message: `Your ${latest.tier} contest entry has been refunded.`,
          reference: `contest-refund-notice:${latest._id}:${resultRevision ?? "deadline"}:${player.user}`,
          contestId: latest._id,
          matchId: latest.match,
        });
      }
    } catch (error) {
      console.error(`Refund notification failed for contest ${contest._id}:`, error.message);
      return false;
    }
    const refundsComplete = latest?.players.every((player) =>
      ["REFUNDED", "NOT_REQUIRED", "FAILED"].includes(player.entryPaymentStatus)
    );
    await ContestModel.updateOne(
      { _id: contest._id, status: "REFUNDED", cancellationReason: "NO_OPPONENT", settlementStatus: { $in: ["REFUND_PROCESSING", "REFUND_REQUIRED"] } },
      {
        $set: {
          settlementStatus: refundsComplete ? "REFUNDED" : "REFUND_REQUIRED",
          ...(refundsComplete ? { settledAt: now() } : {}),
        },
      }
    );
    return Boolean(refundsComplete);
  };
}

const processSingleParticipantRefund = createSingleParticipantRefundProcessor();

async function processExpiredContest(contest) {
  const match = await Match.findById(contest.match).lean();

  if (!match) {
    const reconciled = await reconcilePendingContestEntries(contest);

    // A pending entry may still have a wallet transaction in flight. Let the
    // normal payment recovery grace period resolve it before closing/refunding.
    if (!reconciled) return;

    await Contest.updateOne(
      {
        _id: contest._id,
        status: { $in: ["OPEN", "WAITING", "FULL", "REFUNDED"] },
        expiresAt: { $lte: new Date() },
      },
      {
        $set: {
          status: "REFUNDED",
          cancellationReason: "MATCH_CANCELLED",
          settlementStatus: "REFUND_PROCESSING",
        },
        $unset: { activeQueueKey: "" },
      }
    );

    const latest = await Contest.findById(contest._id).lean();
    if (!latest || latest.status !== "REFUNDED") return;

    for (const player of latest.players) {
      await refundPlayer(latest, player, match.resultRevision || 0);
    }

    const afterRefunds = await Contest.findById(contest._id).lean();
    const refundsComplete = afterRefunds?.players.every(
      (player) =>
        player.entryPaymentStatus === "REFUNDED" ||
        player.entryPaymentStatus === "NOT_REQUIRED"
    );

    await Contest.updateOne(
      { _id: contest._id, status: "REFUNDED" },
      {
        $set: {
          settlementStatus: refundsComplete ? "REFUNDED" : "REFUND_REQUIRED",
          ...(refundsComplete ? { settledAt: new Date() } : {}),
        },
      }
    );

    return;
  }

  const now = new Date();
  const deadline = new Date(contest.expiresAt);

  if (!Number.isFinite(deadline.getTime()) || deadline > now) {
    return;
  }

  // Two players: lock the contest for the match outcome.
  if (contest.players.length === 2) {
    await Contest.updateOne(
      {
        _id: contest._id,
        status: "FULL",
        expiresAt: { $lte: now },
      },
      {
        $set: {
          status: "LOCKED",
          lockedAt: now,
          settlementStatus: "PENDING",
          cancellationReason: "MATCH_STARTED",
        },
      }
    );

    return;
  }

  // No players: close the empty contest without a refund.
  if (contest.players.length === 0) {
    await Contest.updateOne(
      {
        _id: contest._id,
        status: { $in: ["OPEN", "WAITING"] },
        expiresAt: { $lte: now },
        players: { $size: 0 },
      },
      {
        $set: {
          status: "CANCELLED",
          cancellationReason: "NO_OPPONENT",
          settlementStatus: "NOT_READY",
        },
      }
    );

    return;
  }

  // One-player contests close at their scheduled deadline, even if the match
  // status update is delayed. The refund handler claims only a one-player row.
  await processSingleParticipantRefund(contest, match.resultRevision || 0);
}

let intervalId = null;
let isProcessing = false;

async function removeSettledMatchEmptyContests(now) {
  const startedMatches = await Match.find({
    status: { $in: ["live", "completed", "abandoned"] },
    startTime: { $lte: now },
  })
    .select("_id")
    .lean();
  if (!startedMatches.length) return;

  const emptyContests = await Contest.find({
    match: { $in: startedMatches.map((match) => match._id) },
    players: { $size: 0 },
    status: "CANCELLED",
    cancellationReason: { $in: ["MATCH_STARTED", "NO_OPPONENT"] },
    settlementStatus: "NOT_READY",
    settledAt: null,
    settlementRevision: 0,
    winnerId: null,
    replacementContestId: null,
  })
    .select("_id")
    .lean();

  for (const contest of emptyContests) {
    const [walletHistory, platformHistory, replacementReference] = await Promise.all([
      WalletTransaction.exists({ contest: contest._id }),
      PlatformLedgerEntry.exists({ contest: contest._id }),
      Contest.exists({ replacementContestId: contest._id }),
    ]);
    if (walletHistory || platformHistory || replacementReference) continue;

    await Contest.deleteOne({
      _id: contest._id,
      match: { $in: startedMatches.map((match) => match._id) },
      players: { $size: 0 },
      status: "CANCELLED",
      cancellationReason: { $in: ["MATCH_STARTED", "NO_OPPONENT"] },
      settlementStatus: "NOT_READY",
      settledAt: null,
      settlementRevision: 0,
      winnerId: null,
      replacementContestId: null,
    });
  }
}

export function startContestDeadlineProcessor() {
  if (intervalId) return;

  const processDeadlines = async () => {
    if (isProcessing) return;

    isProcessing = true;

    try {
      const now = new Date();

      const matchesStarting = await Match.find({
        status: "upcoming",
        startTime: { $lte: now },
      })
        .select("_id published competition teamA teamB startTime venue")
        .lean();

      for (const match of matchesStarting) {
        const transitioned = await Match.updateOne(
          { _id: match._id, status: "upcoming", startTime: { $lte: now } },
          { $set: { status: "live" } }
        );

        if (transitioned.modifiedCount !== 1) continue;

        void announceMatchEvent("MATCH_STARTED", match).catch((error) => {
          console.error("Telegram match-start announcement failed.", {
            code: String(error?.code || "TELEGRAM_ANNOUNCEMENT_FAILED").slice(0, 80),
          });
        });

        const contests = await Contest.find({ match: match._id })
          .select("players.user")
          .lean();
        const userIds = new Set(
          contests.flatMap((contest) =>
            contest.players.map((player) => String(player.user))
          )
        );

        await Promise.all([...userIds].map((userId) =>
          notifyUser({
            userId,
            type: "MATCH_LIVE",
            title: "Match is live",
            message: `${match.teamA} vs ${match.teamB} has started. Contest entries are closed.`,
            reference: `match-live:${match._id}:${userId}`,
            matchId: match._id,
          }).catch((error) => {
            console.error(`Match-live notification failed for ${match._id}:`, error);
          })
        ));
      }

      await recoverStaleContestPayments();
      await ensureMissingReplacementContests();
      await resumePendingMatchCorrections();

      const finalMatches = await Match.find({
        status: { $in: ["completed", "cancelled", "abandoned"] },
      })
        .select("_id status result")
        .lean();

      for (const match of finalMatches) {
        try {
          await settleMatchContests(match);
        } catch (error) {
          console.error(
            `Match settlement processing failed for ${match._id}:`,
            error
          );
        }
      }

      const expiredContests = await Contest.find({
        status: { $in: ["OPEN", "WAITING", "FULL", "REFUNDED"] },
        $or: [
          { status: { $in: ["OPEN", "WAITING", "FULL"] } },
          { settlementStatus: { $in: ["REFUND_REQUIRED", "REFUND_PROCESSING"] } },
        ],
        expiresAt: { $lte: now },
      })
        .limit(200)
        .lean();

      for (const contest of expiredContests) {
        try {
          await processExpiredContest(contest);
        } catch (error) {
          console.error(
            `Deadline processing failed for contest ${contest._id}:`,
            error.message
          );
        }
      }

      await removeSettledMatchEmptyContests(now);

      // Retry refunds that failed previously.
      const refundContests = await Contest.find({
        status: "REFUNDED",
        settlementStatus: { $in: ["REFUND_REQUIRED", "REFUND_PROCESSING"] },
      })
        .lean();

      for (const contest of refundContests) {
        if (contest.cancellationReason === "NO_OPPONENT" && contest.players.length === 1) {
          await processSingleParticipantRefund(contest, 0, { allowRetry: true });
          continue;
        }

        const reconciled = await reconcilePendingContestEntries(contest);
        if (!reconciled) continue;

        for (const player of reconciled.players) {
          if (
            ["PAID", "PENDING"].includes(player.entryPaymentStatus) &&
            ["FAILED", "PENDING", "NOT_REQUIRED", "PROCESSING"].includes(player.refundStatus)
          ) {
            await refundPlayer(contest, player);
          }
        }

        const latest = await Contest.findById(contest._id).lean();

        if (
          latest?.players.every(
            (player) =>
              player.entryPaymentStatus === "REFUNDED" ||
              player.entryPaymentStatus === "NOT_REQUIRED" ||
              player.entryPaymentStatus === "FAILED"
          )
        ) {
          await Contest.updateOne(
            { _id: contest._id, status: "REFUNDED" },
            {
              $set: {
                settlementStatus: "REFUNDED",
                settledAt: new Date(),
              },
            }
          );
        }
      }
    } catch (error) {
      console.error("Contest deadline processor error:", error.message);
    } finally {
      isProcessing = false;
    }
  };

  void processDeadlines();

  intervalId = setInterval(() => {
    void processDeadlines();
  }, PROCESS_INTERVAL_MS);

  console.log("Contest deadline processor started.");
}
