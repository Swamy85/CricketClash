import { PLAYER_SESSION_KEY } from "./sessionKeys.js";

export async function restoreValidatedSession(storage, validateWithServer, now = Date.now()) {
  const sessionId = storage.getItem(PLAYER_SESSION_KEY);
  if (!sessionId) return { valid: false, reason: "missing" };

  const data = await validateWithServer();
  if (storage.getItem(PLAYER_SESSION_KEY) !== sessionId) {
    return { valid: false, reason: "superseded" };
  }
  if (data?.success !== true || !data.user) {
    return { valid: false, reason: "invalid" };
  }

  const absoluteExpiry = Date.parse(data.session?.absoluteExpiresAt || "");
  return {
    valid: true,
    user: data.user,
    checkedAt: now,
    absoluteExpiresAt: Number.isFinite(absoluteExpiry) ? absoluteExpiry : null,
  };
}
