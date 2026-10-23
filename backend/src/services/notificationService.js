import Notification from "../models/Notification.js";

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
