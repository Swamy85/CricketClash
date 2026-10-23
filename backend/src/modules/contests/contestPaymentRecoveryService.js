import Contest from "../../models/Contest.js";
import WalletTransaction from "../../models/WalletTransaction.js";

const PAYMENT_RECOVERY_GRACE_MS = 5 * 60_000;

export async function reconcilePendingContestEntries(contest) {
  const now = Date.now();
  const staleBefore = new Date(now - PAYMENT_RECOVERY_GRACE_MS);

  for (const player of contest.players) {
    if (player.entryPaymentStatus !== "PENDING") continue;

    const transaction = await WalletTransaction.findOne({
      user: player.user,
      reference: `contest-entry:${contest._id}`,
    }).lean();

    if (transaction?.status === "COMPLETED") {
      await Contest.updateOne(
        {
          _id: contest._id,
          players: {
            $elemMatch: {
              user: player.user,
              entryPaymentStatus: "PENDING",
            },
          },
        },
        {
          $set: {
            "players.$.entryPaymentStatus": "PAID",
            "players.$.refundStatus": "NOT_REQUIRED",
          },
        }
      );
      continue;
    }

    const joinedAt = new Date(player.joinedAt).getTime();

    if (
      Number.isFinite(joinedAt) &&
      now - joinedAt >= PAYMENT_RECOVERY_GRACE_MS
    ) {
      const updated = await Contest.findOneAndUpdate(
        {
          _id: contest._id,
          players: {
            $elemMatch: {
              user: player.user,
              entryPaymentStatus: "PENDING",
              joinedAt: { $lte: staleBefore },
            },
          },
        },
        {
          $pull: {
            players: {
              user: player.user,
              entryPaymentStatus: "PENDING",
              joinedAt: { $lte: staleBefore },
            },
          },
        },
        { new: true }
      );

      if (updated) {
        const nextStatus =
          updated.status === "REFUNDED"
            ? "REFUNDED"
            : updated.players.length === 0
              ? "OPEN"
              : updated.players.length === 1
                ? "WAITING"
                : "FULL";

        await Contest.updateOne(
          { _id: updated._id },
          { $set: { status: nextStatus } }
        );
      }
    }
  }

  const current = await Contest.findById(contest._id).lean();

  if (!current) return null;
  if (current.players.some((player) => player.entryPaymentStatus === "PENDING")) {
    return null;
  }

  return current;
}

export async function recoverStaleContestPayments() {
  const staleBefore = new Date(Date.now() - PAYMENT_RECOVERY_GRACE_MS);
  const contests = await Contest.find({
    status: { $in: ["OPEN", "WAITING", "FULL", "LOCKED", "REFUNDED"] },
    settlementStatus: { $nin: ["SETTLED", "REFUNDED"] },
    players: {
      $elemMatch: {
        entryPaymentStatus: "PENDING",
        joinedAt: { $lte: staleBefore },
      },
    },
  })
    .select("_id players status")
    .lean();

  for (const contest of contests) {
    await reconcilePendingContestEntries(contest);
  }
}
