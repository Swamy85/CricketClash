import mongoose from "mongoose";
import Contest from "../../models/Contest.js";
import Match from "../../models/Match.js";
import Wallet from "../../models/Wallet.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import PlatformLedgerEntry from "../../models/PlatformLedgerEntry.js";

const ELIGIBLE_CONTEST_STATUSES = ["FULL", "LOCKED"];
const MAX_BALANCE = Number.MAX_SAFE_INTEGER;

function isEligibleContest(contest) {
  const players = Array.isArray(contest.players) ? contest.players : [];
  return (contest.entryClosedAt || contest.status === "LOCKED")
    && ELIGIBLE_CONTEST_STATUSES.includes(contest.status)
    && players.length === 2
    && players[0].selectedTeam !== players[1].selectedTeam
    && players.every((player) => ["PAID", "NOT_REQUIRED"].includes(player.entryPaymentStatus));
}

function getSettlementAmounts(contest) {
  const prizePool = contest.prizePool;
  const fee = contest.platformFee ?? 0;
  const payout = contest.winnerPayout ?? 0;
  const percentage = contest.platformFeePercentage ?? 10;
  if (![prizePool, fee, payout, percentage].every(Number.isSafeInteger)
    || prizePool < 0 || fee < 0 || payout < 0 || percentage < 0 || percentage > 100
    || fee + payout !== prizePool
    || fee !== Math.round(prizePool * percentage / 100)) return null;
  return { fee, payout };
}

function outcomeWinner(contest) {
  if (contest.providerOutcomeStatus !== "DETERMINED"
    || contest.providerOutcome?.type !== "WINNER"
    || !["A", "B"].includes(contest.providerOutcome?.winningMatchSide)
    || !contest.providerOutcome?.determinedWinnerId) return null;
  const winner = contest.players.find((player) => player.selectedTeam === contest.providerOutcome.winningMatchSide);
  if (!winner || String(winner.user) !== String(contest.providerOutcome.determinedWinnerId)) return null;
  return winner;
}

/**
 * Atomically settle Phase 4 provider outcomes. All financial writes and the contest's
 * settled marker share one MongoDB transaction, so a process crash rolls them all back.
 */
export async function settleProviderContestOutcomes({
  MatchModel = Match,
  ContestModel = Contest,
  WalletModel = Wallet,
  WalletTransactionModel = WalletTransaction,
  PlatformLedgerModel = PlatformLedgerEntry,
  startSession = () => mongoose.startSession(),
  now = new Date(),
} = {}) {
  const matches = await MatchModel.find({
    published: { $ne: false }, providerSource: "CRICAPI", providerState: "result",
    // The legacy admin result pipeline owns manually finalized matches.
    result: null,
  }).select("_id providerId providerSource providerState published result resultRevision").lean();
  let considered = 0;
  let settled = 0;
  let failed = 0;

  for (const match of matches) {
    const contests = await ContestModel.find({
      match: match._id,
      $or: [{ entryClosedAt: { $ne: null } }, { status: "LOCKED" }],
      status: { $in: ELIGIBLE_CONTEST_STATUSES },
      settlementStatus: { $nin: ["SETTLED", "REFUNDED"] },
      providerOutcomeStatus: "DETERMINED",
      "providerOutcome.type": "WINNER",
      providerSettlementStatus: { $in: ["PENDING", "FAILED", null] },
    }).select("_id match status entryClosedAt players settlementStatus providerOutcomeStatus providerOutcome providerSettlementStatus prizePool platformFeePercentage platformFee winnerPayout tier").lean();

    for (const contest of contests) {
      considered += 1;
      const winner = outcomeWinner(contest);
      const amounts = getSettlementAmounts(contest);
      if (!match.providerId
        || String(contest.providerOutcome.providerMatchId) !== String(match.providerId)
        || !contest.providerOutcome.signature
        || !isEligibleContest(contest) || !winner || !amounts) {
        console.warn("Provider contest settlement skipped: eligibility or persisted financial data did not validate.", {
          contestId: String(contest._id), matchId: String(match._id),
        });
        continue;
      }

      const payoutReference = `contest-winning:${contest._id}:provider:${match.providerId}`;
      const feeReference = `contest-platform-fee:${contest._id}:provider:${match.providerId}`;
      const session = await startSession();
      let didSettle = false;
      try {
        await session.withTransaction(async () => {
          // This conditional write is the cross-worker claim. PROCESSING is inside the
          // transaction, so a crash or abort restores PENDING and the worker retries.
          const claim = await ContestModel.updateOne({
            _id: contest._id,
            match: match._id,
            status: { $in: ELIGIBLE_CONTEST_STATUSES },
            $or: [{ entryClosedAt: { $ne: null } }, { status: "LOCKED" }],
            settlementStatus: { $nin: ["SETTLED", "REFUNDED"] },
            providerOutcomeStatus: "DETERMINED",
            "providerOutcome.type": "WINNER",
            "providerOutcome.signature": contest.providerOutcome.signature,
            "providerOutcome.determinedWinnerId": winner.user,
            providerSettlementStatus: { $in: ["PENDING", "FAILED", null] },
          }, { $set: { providerSettlementStatus: "PROCESSING" } }, { session });
          if (claim.modifiedCount !== 1) return;

          if (amounts.payout > 0) {
            const wallet = await WalletModel.findOneAndUpdate(
              { user: winner.user },
              { $setOnInsert: { user: winner.user, balance: 0, reservedBalance: 0 } },
              { upsert: true, new: true, setDefaultsOnInsert: true, session }
            );
            const before = wallet.balance;
            if (!Number.isSafeInteger(before) || before < 0 || before + amounts.payout > MAX_BALANCE) {
              throw new Error("Wallet balance cannot safely accept contest payout.");
            }
            const balanceUpdate = await WalletModel.updateOne(
              { _id: wallet._id, balance: before },
              { $inc: { balance: amounts.payout } },
              { session, runValidators: true }
            );
            if (balanceUpdate.modifiedCount !== 1) throw new Error("Wallet changed during contest settlement.");
            await WalletTransactionModel.create([{
              user: winner.user,
              wallet: wallet._id,
              type: "CONTEST_WINNING",
              amount: amounts.payout,
              direction: "CREDIT",
              status: "COMPLETED",
              reference: payoutReference,
              contest: contest._id,
              balanceBefore: before,
              balanceAfter: before + amounts.payout,
              description: `Winnings for ${contest.tier} contest`,
              processedAt: now,
            }], { session });
          }

          if (amounts.fee > 0) {
            await PlatformLedgerModel.create([{
              contest: contest._id,
              match: match._id,
              amount: amounts.fee,
              direction: "CREDIT",
              type: "PLATFORM_FEE",
              reference: feeReference,
              description: `Platform fee for ${contest.tier} contest`,
            }], { session });
          }

          const completed = await ContestModel.updateOne({
            _id: contest._id,
            providerSettlementStatus: "PROCESSING",
            "providerOutcome.signature": contest.providerOutcome.signature,
          }, { $set: {
            status: "COMPLETED",
            winnerId: winner.user,
            settlementStatus: "SETTLED",
            settledAt: now,
            settlementRevision: match.resultRevision || 0,
            providerSettlementStatus: "SETTLED",
          }, $unset: { activeQueueKey: "" } }, { session });
          if (completed.modifiedCount !== 1) throw new Error("Contest settlement claim was lost before commit.");
          didSettle = true;
        });
        if (didSettle) {
          settled += 1;
          console.info("Provider contest settlement completed.", {
            contestId: String(contest._id), matchId: String(match._id), winnerId: String(winner.user),
            payout: amounts.payout, platformFee: amounts.fee,
          });
        }
      } catch (error) {
        // Unknown commit outcomes are resolved by checking the atomic terminal marker.
        const persisted = await ContestModel.findOne({ _id: contest._id, providerSettlementStatus: "SETTLED" }).select("_id").lean().catch(() => null);
        if (persisted) {
          settled += 1;
          console.info("Provider settlement commit confirmed after a database response error.", {
            contestId: String(contest._id), matchId: String(match._id),
          });
        } else {
          failed += 1;
          console.error("Provider contest settlement failed; it remains eligible for a later retry.", {
            contestId: String(contest._id), matchId: String(match._id),
            code: String(error?.code || "SETTLEMENT_FAILED").slice(0, 80),
          });
        }
      } finally {
        await session.endSession();
      }
    }
  }
  console.info("Provider contest settlement check finished.", { matches: matches.length, considered, settled, failed });
  return { matches: matches.length, considered, settled, failed };
}
