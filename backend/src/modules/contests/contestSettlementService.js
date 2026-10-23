import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";
import PlatformLedgerEntry from "../../models/PlatformLedgerEntry.js";
import { creditWallet } from "../wallet/walletService.js";
import { reconcilePendingContestEntries } from "./contestPaymentRecoveryService.js";
import { notifyUser } from "../../services/notificationService.js";
import { formatMatchResult } from "../../services/matchResultLabel.js";

async function notifySettlement({ userId, type, title, message, reference, contestId, matchId }) {
  try {
    await notifyUser({
      userId,
      type,
      title,
      message,
      reference,
      contestId,
      matchId,
    });
  } catch (error) {
    console.error("Contest settlement notification failed:", error);
  }
}

function isFinalMatch(match) {
  return ["completed", "cancelled", "abandoned"].includes(match.status);
}

function getWinnerTeam(match) {
  if (match.result === "teamA") return "A";
  if (match.result === "teamB") return "B";
  return null;
}

export function contestRefundReference(contestId, userId, resultRevision = 0) {
  return `contest-refund:${contestId}:${userId}:result:${resultRevision}`;
}

async function refundContest(contest) {
  const latestContest = await reconcilePendingContestEntries(contest);

  if (!latestContest) {
    await Contest.updateOne(
      { _id: contest._id, settlementStatus: { $ne: "SETTLED" } },
      { $set: { settlementStatus: "REFUND_REQUIRED" } }
    );
    return;
  }

  let failed = false;

  for (const player of latestContest.players) {
    if (player.entryPaymentStatus !== "PAID") continue;
    if (player.refundStatus === "COMPLETED") continue;

    await Contest.updateOne(
      {
        _id: latestContest._id,
        players: {
          $elemMatch: {
            user: player.user,
            entryPaymentStatus: "PAID",
            refundStatus: { $ne: "COMPLETED" },
          },
        },
      },
      { $set: { "players.$.refundStatus": "PROCESSING" } }
    );

    try {
      await creditWallet({
        userId: player.user,
        amount: latestContest.entryFee,
        reference: contestRefundReference(
          latestContest._id,
          player.user,
          contest.settlementResultRevision ?? 0
        ),
        type: "CONTEST_REFUND",
        contestId: latestContest._id,
        description: `Refund for ${latestContest.tier} contest`,
      });

      await Contest.updateOne(
        {
          _id: latestContest._id,
          players: {
            $elemMatch: {
              user: player.user,
              entryPaymentStatus: "PAID",
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
      failed = true;
      console.error(
        `Contest refund failed for ${latestContest._id}/${player.user}:`,
        error
      );
      await Contest.updateOne(
        {
          _id: latestContest._id,
          players: {
            $elemMatch: {
              user: player.user,
              refundStatus: "PROCESSING",
            },
          },
        },
        { $set: { "players.$.refundStatus": "FAILED" } }
      );
    }
  }

  const settledContest = await Contest.findById(latestContest._id).lean();
  const refundsComplete = settledContest.players.every(
    (player) =>
      player.entryPaymentStatus !== "PAID" &&
      player.entryPaymentStatus !== "PENDING"
  );

  await Contest.updateOne(
    { _id: settledContest._id },
    {
      $set: {
        status: "REFUNDED",
        cancellationReason:
          latestContest.matchOutcome === "NO_OPPONENT"
            ? "NO_OPPONENT"
            : latestContest.matchOutcome === "cancelled"
              ? "MATCH_CANCELLED"
              : latestContest.matchOutcome === "abandoned"
                ? "MATCH_ABANDONED"
                : "MATCH_NO_RESULT",
        settlementStatus:
          refundsComplete && !failed ? "REFUNDED" : "REFUND_REQUIRED",
        ...(contest.settlementResultRevision !== undefined
          ? { settlementRevision: contest.settlementResultRevision }
          : {}),
        ...(refundsComplete && !failed ? { settledAt: new Date() } : {}),
      },
      $unset: { activeQueueKey: "" },
    }
  );

  if (refundsComplete && !failed) {
    await Promise.all(
      settledContest.players
        .filter((player) => player.entryPaymentStatus === "REFUNDED")
        .map((player) =>
      notifySettlement({
        userId: player.user,
        type: "REFUND_COMPLETED",
        title: "Contest entry refunded",
        message: `Your ${settledContest.tier} contest entry has been refunded.`,
        reference: `contest-refund-notice:${settledContest._id}:${contest.settlementResultRevision ?? "deadline"}:${player.user}`,
        contestId: settledContest._id,
        matchId: settledContest.match,
      })
        )
    );
  }
}

async function settleContest(contest, match) {
  if (["SETTLED", "REFUNDED"].includes(contest.settlementStatus)) {
    if (contest.settlementStatus === "SETTLED" && contest.winnerId) {
      await notifySettlement({
        userId: contest.winnerId,
        type: "PAYOUT_COMPLETED",
        title: "Contest winnings credited",
        message: `Your ${contest.tier} contest winnings of ${contest.winnerPayout} coins have been credited.`,
        reference: `contest-payout-notice:${contest._id}:${contest.settlementRevision || 0}:${contest.winnerId}`,
        contestId: contest._id,
        matchId: match._id,
      });
    }
    await Promise.all(contest.players.map((player) =>
      notifySettlement({
        userId: player.user,
        type: "MATCH_RESULT",
        title: "Match result published",
        message: `${match.teamA} vs ${match.teamB}: ${formatMatchResult(match)}.`,
        reference: `match-result-notice:${match._id}:${match.resultRevision || 0}:${player.user}`,
        contestId: contest._id,
        matchId: match._id,
      })
    ));
    return;
  }

  if (contest.players.some((player) => player.entryPaymentStatus === "PENDING")) {
    const reconciled = await reconcilePendingContestEntries(contest);
    if (!reconciled) {
      await Contest.updateOne(
        { _id: contest._id },
        { $set: { settlementStatus: "PENDING" } }
      );
      return;
    }
    contest = reconciled;
  }

  const isWinnerResult = ["teamA", "teamB"].includes(match.result);
  const players = contest.players;
  const winnerTeam = getWinnerTeam(match);
  const winner = players.find((player) => player.selectedTeam === winnerTeam);
  const eligibleForWinner = isWinnerResult &&
    players.length === 2 &&
    players.every((player) =>
      ["PAID", "NOT_REQUIRED"].includes(player.entryPaymentStatus)
    );

  if (!eligibleForWinner || !winner) {
    await refundContest({
      ...contest,
      matchOutcome: players.length < 2 ? "NO_OPPONENT" : match.result,
      settlementResultRevision: match.resultRevision || 0,
    });
    return;
  }

  await Contest.updateOne(
    { _id: contest._id, settlementStatus: { $nin: ["SETTLED", "REFUNDED"] } },
    {
      $set: {
        status: "LOCKED",
        settlementStatus: "PENDING",
        winnerId: winner.user,
      },
      $unset: { activeQueueKey: "" },
    }
  );

  try {
    if (contest.winnerPayout > 0) {
      await creditWallet({
        userId: winner.user,
        amount: contest.winnerPayout,
        reference: `contest-winning:${contest._id}:${match.resultRevision || 0}:${winner.user}`,
        type: "CONTEST_WINNING",
        contestId: contest._id,
        description: `Winnings for ${contest.tier} contest`,
      });
    }

    if (contest.platformFee > 0) {
      const platformFees = await PlatformLedgerEntry.find({
        contest: contest._id,
        type: "PLATFORM_FEE",
        direction: "CREDIT",
      })
        .select("_id")
        .lean();
      let activePlatformFee = false;

      for (const platformFee of platformFees) {
        if (!(await PlatformLedgerEntry.exists({ reversesEntry: platformFee._id }))) {
          activePlatformFee = true;
          break;
        }
      }

      if (!activePlatformFee) {
        await PlatformLedgerEntry.updateOne(
          { reference: `contest-platform-fee:${contest._id}:${match.resultRevision || 0}` },
          {
            $setOnInsert: {
              contest: contest._id,
              match: match._id,
              amount: contest.platformFee,
              direction: "CREDIT",
              type: "PLATFORM_FEE",
              reference: `contest-platform-fee:${contest._id}:${match.resultRevision || 0}`,
              description: `Platform fee for ${contest.tier} contest`,
            },
          },
          { upsert: true }
        );
      }
    }

    await Contest.updateOne(
      { _id: contest._id, settlementStatus: "PENDING" },
      {
        $set: {
          status: "COMPLETED",
          settlementStatus: "SETTLED",
          winnerId: winner.user,
          settledAt: new Date(),
          settlementRevision: match.resultRevision || 0,
        },
        $unset: { activeQueueKey: "" },
      }
    );
    await Promise.all(players.map((player) =>
      notifySettlement({
        userId: player.user,
        type: "MATCH_RESULT",
        title: "Match result published",
        message: `${match.teamA} vs ${match.teamB}: ${formatMatchResult(match)}.`,
        reference: `match-result-notice:${match._id}:${match.resultRevision || 0}:${player.user}`,
        contestId: contest._id,
        matchId: match._id,
      })
    ));
    await notifySettlement({
      userId: winner.user,
      type: "PAYOUT_COMPLETED",
      title: "Contest winnings credited",
      message: `Your ${contest.tier} contest winnings of ${contest.winnerPayout} coins have been credited.`,
      reference: `contest-payout-notice:${contest._id}:${match.resultRevision || 0}:${winner.user}`,
      contestId: contest._id,
      matchId: match._id,
    });
  } catch (error) {
    console.error(`Contest settlement failed for ${contest._id}:`, error);
    await Contest.updateOne(
      { _id: contest._id, settlementStatus: "PENDING" },
      { $set: { settlementStatus: "FAILED" } }
    );
  }
}

export async function settleMatchContests(matchOrId) {
  const match = typeof matchOrId === "string" || matchOrId?._id
    ? await Match.findById(matchOrId._id || matchOrId).lean()
    : matchOrId;

  if (!match || !isFinalMatch(match)) return;

  const contests = await Contest.find({ match: match._id })
    .sort({ createdAt: 1 })
    .lean();

  for (const contest of contests) {
    await settleContest(contest, match);
  }
}
