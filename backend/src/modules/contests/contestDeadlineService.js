
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
import { ensureUpcomingMatchQueues } from "./contestService.js";
import { resumePendingMatchCorrections } from "../matches/matchCorrectionService.js";
import { notifyUser } from "../../services/notificationService.js";

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

  // One player: refund any confirmed paid entry.
  await Contest.updateOne(
    {
      _id: contest._id,
      status: { $in: ["OPEN", "WAITING"] },
      expiresAt: { $lte: now },
    },
    {
      $set: {
        status: "REFUNDED",
        cancellationReason: "NO_OPPONENT",
        settlementStatus: "REFUND_PROCESSING",
      },
    }
  );

  const reconciled = await reconcilePendingContestEntries(contest);

  if (!reconciled) {
    await Contest.updateOne(
      { _id: contest._id, status: "REFUNDED" },
      { $set: { settlementStatus: "REFUND_REQUIRED" } }
    );
    return;
  }

  for (const player of reconciled.players) {
    await refundPlayer(contest, player, match.resultRevision || 0);
  }

  const latest = await Contest.findById(contest._id).lean();

  const allRefundsComplete = latest?.players.every(
    (player) =>
      player.entryPaymentStatus === "REFUNDED" ||
      player.entryPaymentStatus === "NOT_REQUIRED" ||
      player.entryPaymentStatus === "FAILED"
  );

  if (allRefundsComplete) {
    await Contest.updateOne(
      { _id: contest._id, status: "REFUNDED" },
      {
        $set: {
          settlementStatus: "REFUNDED",
          settledAt: new Date(),
        },
      }
    );
  } else {
    await Contest.updateOne(
      { _id: contest._id, status: "REFUNDED" },
      {
        $set: {
          settlementStatus: "REFUND_REQUIRED",
        },
      }
    );
  }
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
        .select("_id teamA teamB")
        .lean();

      for (const match of matchesStarting) {
        const transitioned = await Match.updateOne(
          { _id: match._id, status: "upcoming", startTime: { $lte: now } },
          { $set: { status: "live" } }
        );

        if (transitioned.modifiedCount !== 1) continue;

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
      await ensureUpcomingMatchQueues();
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
