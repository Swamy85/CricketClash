import Notification from "../models/Notification.js";
import User from "../models/User.js";

function preferenceForType(type) {
  if (type === "MATCH_LIVE") return "matchUpdates";
  if (type === "MATCH_RESULT") return "results";
  if (["CONTEST_JOINED", "OPPONENT_JOINED", "CONTEST_FULL", "CONTEST_CANCELLED"].includes(type)) return "contestUpdates";
  if (["PAYOUT_COMPLETED", "PAYOUT_REVERSED", "REFUND_COMPLETED"].includes(type)) return "announcements";
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
