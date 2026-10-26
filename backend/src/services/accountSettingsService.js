export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  matchUpdates: true,
  contestUpdates: true,
  results: true,
  announcements: true,
});

const NOTIFICATION_KEYS = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES);

export function normalizeNotificationPreferences(value = {}) {
  return Object.fromEntries(NOTIFICATION_KEYS.map((key) => [
    key,
    typeof value[key] === "boolean" ? value[key] : DEFAULT_NOTIFICATION_PREFERENCES[key],
  ]));
}

export function validateNotificationPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => NOTIFICATION_KEYS.includes(key)) && keys.every((key) => typeof value[key] === "boolean");
}

export async function updateNotificationPreferences({ User, userId, preferences }) {
  if (!validateNotificationPreferences(preferences)) {
    return { status: 400, code: "INVALID_NOTIFICATION_PREFERENCES", message: "Choose valid notification preferences." };
  }
  const update = Object.fromEntries(Object.entries(preferences).map(([key, value]) => [`notificationPreferences.${key}`, value]));
  const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true })
    .select("notificationPreferences");
  if (!user) return { status: 404, code: "ACCOUNT_NOT_FOUND", message: "Account not found." };
  return { status: 200, preferences: normalizeNotificationPreferences(user.notificationPreferences) };
}

export async function changeAccountPassword({
  User,
  LoginSession,
  user,
  session,
  currentPassword,
  newPassword,
  comparePassword,
  hashPassword,
  now = () => new Date(),
}) {
  const current = await User.findById(user._id).select("+passwordHash +authVersion");
  if (!current) return { status: 404, code: "ACCOUNT_NOT_FOUND", message: "Account not found." };
  if (!(await comparePassword(currentPassword, current.passwordHash))) {
    return { status: 400, code: "CURRENT_PASSWORD_INCORRECT", message: "Current password is incorrect." };
  }
  if (await comparePassword(newPassword, current.passwordHash)) {
    return { status: 400, code: "PASSWORD_REUSED", message: "Choose a new password that you have not used before." };
  }

  const passwordHash = await hashPassword(newPassword);
  const currentVersion = current.authVersion || 0;
  const versionMatch = currentVersion === 0
    ? { $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] }
    : { authVersion: currentVersion };
  const updated = await User.findOneAndUpdate(
    { _id: current._id, ...versionMatch },
    { $set: { passwordHash }, $inc: { authVersion: 1 } },
    { new: true },
  ).select("+authVersion");
  if (!updated) return { status: 409, code: "PASSWORD_UPDATE_CONFLICT", message: "Account credentials changed during this request. Please retry." };

  const changedAt = now();
  try {
    const result = await LoginSession.updateOne(
      { _id: session._id, userId: current._id, revokedAt: null },
      { $set: { authVersion: updated.authVersion, lastActivityAt: changedAt } },
    );
    if (result.matchedCount !== 1 && result.n !== 1) {
      return { status: 200, changed: true, currentSessionPreserved: false };
    }
  } catch {
    // authVersion invalidates old sessions even if the current session cannot
    // be refreshed. The caller can safely ask the user to sign in again.
    return { status: 200, changed: true, currentSessionPreserved: false };
  }

  await LoginSession.updateMany(
    { userId: current._id, _id: { $ne: session._id }, revokedAt: null },
    { $set: { revokedAt: changedAt } },
  ).catch(() => {});
  return { status: 200, changed: true, currentSessionPreserved: true };
}
