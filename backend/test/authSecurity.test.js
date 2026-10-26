import test from "node:test";
import assert from "node:assert/strict";
import requireAdmin from "../src/middleware/requireAdmin.js";
import { createFailedAttemptTracker, createRateLimiter, nextOtpFailure } from "../src/middleware/authSecurity.js";
import { createAuthenticateMiddleware, createLogoutHandler } from "../src/middleware/sessionAuth.js";
import { createSessionIssuer, hashSessionId, IDLE_TIMEOUT_MS } from "../src/services/sessionService.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function invoke(middleware, { sessionId } = {}) {
  const req = { ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, get: (name) => name === "X-CricketClash-Session" ? sessionId : undefined };
  const res = response();
  let nextCalled = false;
  return Promise.resolve(middleware(req, res, () => { nextCalled = true; })).then(() => ({ req, res, nextCalled }));
}

test("repeated failed player/admin login attempts trigger separate cooldowns", () => {
  const player = createFailedAttemptTracker({ maxAttempts: 5, cooldownMs: 15 * 60 * 1000 });
  const admin = createFailedAttemptTracker({ maxAttempts: 5, cooldownMs: 15 * 60 * 1000 });
  const key = "ip:email@example.com";
  for (let i = 0; i < 4; i += 1) assert.equal(player.fail(key, 1000 + i).blocked, false);
  const locked = player.fail(key, 2000);
  assert.equal(locked.blocked, true);
  assert.equal(locked.remainingAttempts, 0);
  assert.equal(player.check(key, 2001).blocked, true);
  assert.equal(admin.check(key, 2001).blocked, false);
  assert.equal(player.check(key, 2000 + 15 * 60 * 1000 + 1).blocked, false);
});

test("auth endpoint rate limiter returns 429 and Retry-After at the configured limit", async () => {
  const limit = createRateLimiter({ limit: 2, windowMs: 60_000 });
  assert.equal((await invoke(limit)).nextCalled, true);
  assert.equal((await invoke(limit)).nextCalled, true);
  const blocked = await invoke(limit);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.body.code, "RATE_LIMITED");
  assert.ok(Number(blocked.res.headers["Retry-After"]) > 0);
});

test("repeated OTP failures block after five attempts and set a temporary cooldown", () => {
  let attempts = 0;
  let result;
  for (let i = 0; i < 5; i += 1) {
    result = nextOtpFailure(attempts, 5, 10_000, 900_000);
    attempts = result.attempts;
  }
  assert.equal(attempts, 5);
  assert.equal(result.blocked, true);
  assert.equal(result.blockedUntil.getTime(), 910_000);
});

test("expired sessions are rejected and revoked", async () => {
  let revoked = false;
  const session = { _id: "session-1", lastActivityAt: new Date(), expiresAt: new Date(Date.now() - 1000), authVersion: 0 };
  const LoginSession = {
    async findOne() { return revoked ? null : session; },
    async updateOne() { revoked = true; },
  };
  const User = { findById() { throw new Error("expired sessions must not load a user"); } };
  const auth = createAuthenticateMiddleware({ LoginSession, User, hashSessionId: (id) => id, idleTimeoutMs: 900_000 });
  const first = await invoke(auth, { sessionId: "expired-token" });
  assert.equal(first.res.statusCode, 401);
  assert.equal(first.res.body.code, "SESSION_TIMEOUT");
  const second = await invoke(auth, { sessionId: "expired-token" });
  assert.equal(second.res.body.code, "SESSION_INVALID");
});

test("legacy unverified users cannot use an existing session or protected route", async () => {
  let revoked = false;
  const session = {
    _id: "legacy-session", userId: "legacy-user", sessionType: "player", authVersion: 0,
    createdAt: new Date(), lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    absoluteExpiresAt: new Date(Date.now() + 60_000), async save() {},
  };
  const auth = createAuthenticateMiddleware({
    LoginSession: { async findOne() { return session; }, async updateOne() { revoked = true; } },
    User: { findById() { return { async select() { return { role: "user", isEmailVerified: false, userId: "CC-LEGACY-42", authVersion: 0 }; } }; } },
    hashSessionId: (id) => id,
    idleTimeoutMs: 900_000,
  });
  const result = await invoke(auth, { sessionId: "legacy-session" });
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.body.code, "SESSION_INVALID");
  assert.equal(result.nextCalled, false);
  assert.equal(revoked, true);
});

test("maximum lifetime expires an otherwise active session", async () => {
  const now = 50_000_000;
  let revoked = false;
  const session = {
    _id: "maxed-session",
    sessionType: "player",
    authVersion: 0,
    createdAt: new Date(now - 24 * 60 * 60 * 1000),
    lastActivityAt: new Date(now - 1000),
    expiresAt: new Date(now + 60_000),
    absoluteExpiresAt: new Date(now - 1),
  };
  const LoginSession = { async findOne() { return session; }, async updateOne() { revoked = true; } };
  const User = { findById() { return { async select() { return { role: "user", isEmailVerified: true, userId: "CC-1", authVersion: 0 }; } }; } };
  const auth = createAuthenticateMiddleware({ LoginSession, User, hashSessionId: (id) => id, idleTimeoutMs: IDLE_TIMEOUT_MS, now: () => now });
  const result = await invoke(auth, { sessionId: "maxed" });
  assert.equal(result.res.statusCode, 401);
  assert.equal(result.res.body.code, "SESSION_MAX_LIFETIME");
  assert.equal(revoked, true);
});

test("server validation refreshes idle expiry without extending absolute lifetime", async () => {
  const now = 75_000_000;
  const session = {
    _id: "refresh-session",
    sessionType: "player",
    authVersion: 2,
    createdAt: new Date(now - 60_000),
    lastActivityAt: new Date(now - 2 * 60_000),
    expiresAt: new Date(now + 13 * 60_000),
    absoluteExpiresAt: new Date(now + 5 * 60_000),
    async save() {},
  };
  const LoginSession = { async findOne() { return session; }, async updateOne() { assert.fail("valid restored sessions are not revoked"); } };
  const User = { findById() { return { async select() { return { role: "user", isEmailVerified: true, userId: "CC-2", authVersion: 2 }; } }; } };
  const auth = createAuthenticateMiddleware({ LoginSession, User, hashSessionId: (id) => id, idleTimeoutMs: IDLE_TIMEOUT_MS, now: () => now });
  const result = await invoke(auth, { sessionId: "restored" });
  assert.equal(result.nextCalled, true);
  assert.equal(session.lastActivityAt.getTime(), now);
  assert.equal(session.expiresAt.getTime(), session.absoluteExpiresAt.getTime());
  assert.equal(result.req.authSession.sessionType, "player");
});

test("player and admin logins issue distinct role-bound sessions", async () => {
  const issued = [];
  let token = 0;
  const issuer = createSessionIssuer({ async create(record) { issued.push(record); } }, {
    maxLifetimeMs: { player: 86_400_000, admin: 28_800_000 },
    makeSessionId: () => "session-token-" + (++token),
    now: () => new Date(1_000_000),
  });
  const playerToken = await issuer({ _id: "player-id", role: "user", authVersion: 1 }, "player");
  const adminToken = await issuer({ _id: "admin-id", role: "admin", authVersion: 4 }, "admin");
  assert.notEqual(playerToken, adminToken);
  assert.equal(issued[0].sessionType, "player");
  assert.equal(issued[1].sessionType, "admin");
  assert.equal(issued[0].userId, "player-id");
  assert.equal(issued[1].userId, "admin-id");
  assert.equal(issued[0].tokenHash, hashSessionId(playerToken));
  assert.notEqual(issued[0].tokenHash, playerToken);
  assert.equal(issued[0].absoluteExpiresAt.getTime() - 1_000_000, 86_400_000);
  assert.equal(issued[1].absoluteExpiresAt.getTime() - 1_000_000, 28_800_000);
});

test("logged-out session tokens cannot be reused", async () => {
  let revoked = false;
  const LoginSession = {
    async findOne() { return revoked ? null : { _id: "session-2", lastActivityAt: new Date(), expiresAt: new Date(Date.now() + 60_000), authVersion: 0 }; },
    async updateOne() { revoked = true; },
  };
  const hashSessionId = (id) => "hash:" + id;
  const logout = createLogoutHandler({ LoginSession, hashSessionId, clearAuthCookie() {} });
  const logoutRes = response();
  await logout({ get: () => "valid-token" }, logoutRes);
  assert.equal(logoutRes.statusCode, 200);
  assert.equal(revoked, true);
  const auth = createAuthenticateMiddleware({
    LoginSession,
    User: { findById() { throw new Error("revoked sessions must not load a user"); } },
    hashSessionId,
    idleTimeoutMs: 900_000,
  });
  const attemptedReuse = await invoke(auth, { sessionId: "valid-token" });
  assert.equal(attemptedReuse.res.statusCode, 401);
  assert.equal(attemptedReuse.res.body.code, "SESSION_INVALID");
});

test("unauthenticated access is denied and player roles cannot access admin routes", async () => {
  const noSession = await invoke(createAuthenticateMiddleware({
    LoginSession: { async findOne() { throw new Error("missing header should stop before lookup"); } },
    User: {},
    hashSessionId: (id) => id,
    idleTimeoutMs: 900_000,
  }));
  assert.equal(noSession.res.statusCode, 401);
  assert.equal(noSession.res.body.code, "SESSION_REQUIRED");

  const logoutWithoutToken = createLogoutHandler({
    LoginSession: { async updateOne() { throw new Error("missing token should stop before revocation"); } },
    hashSessionId: (id) => id,
    clearAuthCookie() {},
  });
  const logoutRes = response();
  await logoutWithoutToken({ get: () => undefined }, logoutRes);
  assert.equal(logoutRes.statusCode, 401);
  assert.equal(logoutRes.body.code, "SESSION_REQUIRED");

  const req = { user: { role: "user" } };
  const res = response();
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});
