const SESSION_TYPES = new Set(["player", "admin"]);

function sessionTypeForUser(user) {
  if (user.role === "admin") return "admin";
  if (user.role === "user") return "player";
  return null;
}

export function createAuthenticateMiddleware({
  LoginSession,
  User,
  hashSessionId,
  idleTimeoutMs,
  maxLifetimeMsByType = { player: 24 * 60 * 60 * 1000, admin: 8 * 60 * 60 * 1000 },
  now = Date.now,
}) {
  return async function authenticate(req, res, next) {
    try {
      const sessionId = req.get("X-CricketClash-Session");
      if (!sessionId || typeof sessionId !== "string" || sessionId.length > 200) {
        return res.status(401).json({ success: false, code: "SESSION_REQUIRED", message: "Please log in to continue." });
      }

      const session = await LoginSession.findOne({ tokenHash: hashSessionId(sessionId), revokedAt: null });
      if (!session) {
        return res.status(401).json({ success: false, code: "SESSION_INVALID", message: "Your session is invalid. Please log in again." });
      }

      const nowMs = now();
      const revokedAt = new Date(nowMs);
      if (nowMs - new Date(session.lastActivityAt).getTime() >= idleTimeoutMs || new Date(session.expiresAt).getTime() <= nowMs) {
        await LoginSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt } });
        return res.status(401).json({ success: false, code: "SESSION_TIMEOUT", message: "Your session expired due to inactivity. Please log in again." });
      }

      const user = await User.findById(session.userId).select("+authVersion");
      if (!user || !user.isEmailVerified || !user.userId) {
        await LoginSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt } });
        return res.status(401).json({ success: false, code: "SESSION_INVALID", message: "Your session is invalid. Please log in again." });
      }

      const expectedType = sessionTypeForUser(user);
      if (!expectedType) {
        await LoginSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt } });
        return res.status(401).json({ success: false, code: "SESSION_INVALID", message: "Your session is invalid. Please log in again." });
      }
      const sessionType = session.sessionType || expectedType;
      if (!SESSION_TYPES.has(sessionType) || sessionType !== expectedType || (session.authVersion || 0) !== (user.authVersion || 0)) {
        await LoginSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt } });
        return res.status(401).json({ success: false, code: "SESSION_INVALID", message: "Your session is invalid. Please log in again." });
      }

      const maxLifetimeMs = maxLifetimeMsByType[sessionType];
      const createdAtMs = new Date(session.createdAt || session.lastActivityAt).getTime();
      const absoluteExpiresAt = session.absoluteExpiresAt
        ? new Date(session.absoluteExpiresAt)
        : new Date(createdAtMs + maxLifetimeMs);
      if (!Number.isFinite(absoluteExpiresAt.getTime()) || absoluteExpiresAt.getTime() <= nowMs) {
        await LoginSession.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt } });
        return res.status(401).json({ success: false, code: "SESSION_MAX_LIFETIME", message: "Your session reached its maximum lifetime. Please log in again." });
      }

      session.sessionType = sessionType;
      session.absoluteExpiresAt = absoluteExpiresAt;
      session.lastActivityAt = new Date(nowMs);
      session.expiresAt = new Date(Math.min(nowMs + idleTimeoutMs, absoluteExpiresAt.getTime()));
      await session.save();
      req.user = user;
      req.authSession = session;
      return next();
    } catch {
      return res.status(503).json({ success: false, code: "SESSION_CHECK_UNAVAILABLE", message: "Your session could not be checked. Please try again." });
    }
  };
}

export function createLogoutHandler({ LoginSession, hashSessionId, clearAuthCookie }) {
  return async function logout(req, res) {
    try {
      const sessionId = req.get("X-CricketClash-Session");
      if (!sessionId || typeof sessionId !== "string" || sessionId.length > 200) {
        return res.status(401).json({ success: false, code: "SESSION_REQUIRED", message: "Please log in to continue." });
      }
      await LoginSession.updateOne(
        { tokenHash: hashSessionId(sessionId), revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
      clearAuthCookie(res);
      return res.json({ success: true, message: "Logged out successfully." });
    } catch {
      return res.status(500).json({ success: false, message: "Could not log out. Please retry." });
    }
  };
}
