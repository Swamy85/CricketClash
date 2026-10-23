import crypto from "node:crypto";
import dotenv from "dotenv";
import LoginSession from "../models/LoginSession.js";

dotenv.config();

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_PLAYER_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ADMIN_MAX_LIFETIME_MS = 8 * 60 * 60 * 1000;

function configuredDuration(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= IDLE_TIMEOUT_MS ? parsed : fallback;
}

export const SESSION_MAX_LIFETIME_MS = Object.freeze({
  player: configuredDuration(process.env.PLAYER_SESSION_MAX_LIFETIME_MS, DEFAULT_PLAYER_MAX_LIFETIME_MS),
  admin: configuredDuration(process.env.ADMIN_SESSION_MAX_LIFETIME_MS, DEFAULT_ADMIN_MAX_LIFETIME_MS),
});

// Hash a session ID before storing it in MongoDB.
export function hashSessionId(sessionId) {
  return crypto
    .createHash("sha256")
    .update(sessionId)
    .digest("hex");
}

// Create a separate server-side session for each login.
export function createSessionIssuer(SessionModel, { maxLifetimeMs = SESSION_MAX_LIFETIME_MS, makeSessionId = () => crypto.randomBytes(32).toString("base64url"), now = () => new Date() } = {}) {
  return async function issueSession(user, requestedType) {
    const userType = user.role === "admin" ? "admin" : user.role === "user" ? "player" : null;
    const sessionType = requestedType || userType;
    if (!userType || sessionType !== userType || !Object.hasOwn(maxLifetimeMs, sessionType)) {
      throw new Error("Invalid session type.");
    }
    const sessionId = makeSessionId();
    const createdAt = now();
    const absoluteExpiresAt = new Date(createdAt.getTime() + maxLifetimeMs[sessionType]);

    await SessionModel.create({
      tokenHash: hashSessionId(sessionId),
      userId: user._id,
      authVersion: user.authVersion || 0,
      sessionType,
      lastActivityAt: createdAt,
      absoluteExpiresAt,
      expiresAt: new Date(Math.min(createdAt.getTime() + IDLE_TIMEOUT_MS, absoluteExpiresAt.getTime())),
    });

    return sessionId;
  };
}

export const createLoginSession = createSessionIssuer(LoginSession);
