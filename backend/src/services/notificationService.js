import Notification from "../models/Notification.js";
import User from "../models/User.js";

function preferenceForType(type) {
  if (type === "MATCH_LIVE") return "matchUpdates";
  if (type === "MATCH_RESULT") return "results";
  if (["CONTEST_JOINED", "OPPONENT_JOINED", "CONTEST_FULL", "CONTEST_CANCELLED"].includes(type)) return "contestUpdates";
  if (["PAYOUT_COMPLETED", "PAYOUT_REVERSED", "REFUND_COMPLETED", "DEPOSIT_STATUS", "WITHDRAWAL_STATUS"].includes(type)) return "announcements";
  return null;
}

export async function notifyUser({
  userId,
  type,
  title,
  message,
  reference,
  contestId = null,
  matchId = null,
}) {
  if (!userId || !reference) return;

  try {
    const preferenceKey = preferenceForType(type);
    if (preferenceKey) {
      const user = await User.findById(userId).select("notificationPreferences").lean();
      if (!user || user.notificationPreferences?.[preferenceKey] === false) return;
    }

    await Notification.updateOne(
      { user: userId, reference },
      {
        $setOnInsert: {
          user: userId,
          type,
          title,
          message,
          reference,
          contest: contestId,
          match: matchId,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) {
      console.error("Unable to create user notification:", error);
      throw error;
    }
  }
}

export async function notifyUsers(options) {
  await Promise.all(options.userIds.map((userId) =>
    notifyUser({ ...options, userId })
  ));
}

export async function notifyWalletRequestStatus(kind, request) {
  if (!request?.user || !request?._id) return;
  const isDeposit = kind === "deposit";
  const status = String(request.status || "PENDING").toUpperCase();
  const amount = Number(isDeposit ? request.amount : request.cashAmount ?? request.coinAmount);
  const formattedAmount = `₹${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-IN")}`;
  const identifier = isDeposit ? request.utr : request.reference;
  const payoutReference = isDeposit ? "" : request.payoutReference;
  const reason = isDeposit ? request.rejectionReason : request.failureReason;
  const title = isDeposit
    ? `Deposit ${status.toLowerCase()}`
    : `Withdrawal ${status.toLowerCase()}`;
  const details = [
    `Status: ${status}`,
    `Amount: ${formattedAmount}`,
    `${isDeposit ? "UTR / reference" : "Request reference"}: ${identifier || "Unavailable"}`,
    payoutReference && `Payout UTR / reference: ${payoutReference}`,
    ["REJECTED", "FAILED"].includes(status) && `Reason: ${reason || "Not provided"}`,
  ].filter(Boolean).join(" · ");

  try {
    await notifyUser({
      userId: request.user,
      type: isDeposit ? "DEPOSIT_STATUS" : "WITHDRAWAL_STATUS",
      title,
      message: details,
      reference: `${isDeposit ? "deposit" : "withdrawal"}:${request._id}:${status}`,
    });
  } catch (error) {
    console.error("Unable to create wallet request status notification:", {
      requestId: String(request._id),
      code: String(error?.code || "NOTIFICATION_FAILED").slice(0, 80),
    });
  }
}
