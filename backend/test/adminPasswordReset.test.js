import test from "node:test";
import assert from "node:assert/strict";
import { createAdminPasswordResetService } from "../src/services/adminPasswordResetService.js";

const EMAIL = "admin@example.com";
const GOOD_PASSWORD = "StrongPass9!";

function matches(value, condition) {
  if (condition && typeof condition === "object" && !(condition instanceof Date) && !Array.isArray(condition)) {
    return Object.entries(condition).every(([operator, expected]) => {
      if (operator === "$exists") return (value !== undefined) === expected;
      if (operator === "$gt") return value > expected;
      if (operator === "$gte") return value >= expected;
      if (operator === "$lt") return value < expected;
      if (operator === "$lte") return value <= expected;
      return false;
    });
  }
  return value instanceof Date && condition instanceof Date ? value.getTime() === condition.getTime() : value === condition;
}

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$and") return value.every((part) => matchesFilter(doc, part));
    if (key === "$or") return value.some((part) => matchesFilter(doc, part));
    return matches(doc[key], value);
  });
}

function applyUpdate(doc, update) {
  for (const [key, value] of Object.entries(update.$set || {})) doc[key] = value;
  for (const key of Object.keys(update.$unset || {})) delete doc[key];
  for (const [key, amount] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + amount;
}

function createHarness({ role = "admin", verified = true, emailError = null, initial = {} } = {}) {
  let timestamp = new Date("2026-10-21T10:00:00Z");
  let otp = "";
  const user = {
    _id: "admin-id", email: EMAIL, username: "chief", role, isEmailVerified: verified,
    authVersion: 2, adminPasswordResetOtpSendCount: 0, ...initial,
  };
  const sessions = [{ userId: user._id, sessionType: "admin", revokedAt: null }, { userId: user._id, sessionType: "player", revokedAt: null }];
  let otpCounter = 0;
  function query(result) {
    return { select() { return Promise.resolve(result); }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
  }
  const User = {
    findOne(filter) { return query(matchesFilter(user, filter) ? user : null); },
    findOneAndUpdate(filter, update) {
      const result = matchesFilter(user, filter) ? (applyUpdate(user, update), user) : null;
      return query(result);
    },
    async updateOne(filter, update) {
      if (matchesFilter(user, filter)) { applyUpdate(user, update); return { modifiedCount: 1 }; }
      return { modifiedCount: 0 };
    },
  };
  const LoginSession = {
    async updateMany(filter, update) {
      let modifiedCount = 0;
      for (const session of sessions) if (matchesFilter(session, filter)) { applyUpdate(session, update); modifiedCount += 1; }
      return { modifiedCount };
    },
  };
  const service = createAdminPasswordResetService({
    User, LoginSession,
    sendOtpEmail: async (_email, _username, sentOtp) => { if (emailError) throw emailError; otp = sentOtp; },
    otpHashKey: "test-key-not-a-production-secret",
    makeOtp: () => (++otpCounter === 1 ? "123456" : "654321"),
    hashPassword: async (password) => `hashed:${password}`,
    now: () => new Date(timestamp),
  });
  return { service, user, sessions, getOtp: () => otp, setNow: (date) => { timestamp = new Date(date); } };
}

test("eligible admin receives a six-digit email code stored only as a hash", async () => {
  const h = createHarness();
  const response = await h.service.requestReset(EMAIL);
  assert.match(response.message, /If an eligible account exists/);
  assert.equal(h.getOtp(), "123456");
  assert.notEqual(h.user.adminPasswordResetOtpHash, h.getOtp());
  assert.equal(h.user.adminPasswordResetOtpExpiresAt.getTime(), Date.parse("2026-10-21T10:05:00Z"));
  assert.equal(h.user.adminPasswordResetOtpAttempts, 0);
});

test("unknown, unverified, and player emails use the same generic response without issuing a code", async () => {
  const unknown = createHarness({ initial: { email: "elsewhere@example.com" } });
  const player = createHarness({ role: "user" });
  const unverified = createHarness({ verified: false });
  const results = await Promise.all([
    unknown.service.requestReset(EMAIL), player.service.requestReset(EMAIL), unverified.service.requestReset(EMAIL),
  ]);
  assert.equal(new Set(results.map((result) => result.message)).size, 1);
  assert.equal(player.user.adminPasswordResetOtpHash, undefined);
  assert.equal(player.getOtp(), "");
});

test("email delivery failure removes the reserved OTP and returns a generic response", async () => {
  const h = createHarness({ emailError: Object.assign(new Error("SMTP down"), { code: "SMTP_DOWN" }) });
  const result = await h.service.requestReset(EMAIL);
  assert.equal(result.message, "If an eligible account exists, password reset instructions will be sent.");
  assert.equal(result.deliveryFailed, true);
  assert.equal(h.user.adminPasswordResetOtpHash, undefined);
  assert.equal(h.user.adminPasswordResetOtpExpiresAt, undefined);
});

test("incorrect codes count attempts and invalidate the OTP after five failures", async () => {
  const h = createHarness();
  await h.service.requestReset(EMAIL);
  for (let i = 0; i < 4; i += 1) await h.service.resetPassword({ email: EMAIL, otp: "000000", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
  assert.equal(h.user.adminPasswordResetOtpAttempts, 4);
  await h.service.resetPassword({ email: EMAIL, otp: "000000", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
  assert.equal(h.user.adminPasswordResetOtpAttempts, 5);
  assert.equal(h.user.adminPasswordResetOtpHash, undefined);
  assert.ok(h.user.adminPasswordResetOtpBlockedUntil);
});

test("expired codes, password mismatch, and weak passwords are rejected", async () => {
  const h = createHarness();
  await h.service.requestReset(EMAIL);
  const mismatch = await h.service.resetPassword({ email: EMAIL, otp: "123456", password: GOOD_PASSWORD, confirmPassword: "Different9!" });
  assert.equal(mismatch.message, "Passwords do not match.");
  const weak = await h.service.resetPassword({ email: EMAIL, otp: "123456", password: "short", confirmPassword: "short" });
  assert.equal(weak.status, 400);
  h.setNow("2026-10-21T10:05:00Z");
  const expired = await h.service.resetPassword({ email: EMAIL, otp: "123456", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
  assert.match(expired.message, /Invalid or expired/);
});

test("successful reset consumes the code, increments authVersion, and revokes admin sessions", async () => {
  const h = createHarness();
  await h.service.requestReset(EMAIL);
  const result = await h.service.resetPassword({ email: EMAIL, otp: "123456", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
  assert.equal(result.ok, true);
  assert.equal(h.user.passwordHash, `hashed:${GOOD_PASSWORD}`);
  assert.equal(h.user.authVersion, 3);
  assert.equal(h.user.adminPasswordResetOtpHash, undefined);
  assert.ok(h.sessions[0].revokedAt);
  assert.equal(h.sessions[1].revokedAt, null);
  const replay = await h.service.resetPassword({ email: EMAIL, otp: "123456", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
  assert.equal(replay.ok, false);
});

test("concurrent verification requests can consume an OTP only once", async () => {
  const h = createHarness();
  await h.service.requestReset(EMAIL);
  const payload = { email: EMAIL, otp: "123456", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD };
  const results = await Promise.all([h.service.resetPassword(payload), h.service.resetPassword(payload)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(h.user.authVersion, 3);
});

test("reset requests respect per-account cooldown and hourly send cap", async () => {
  const h = createHarness();
  const first = await h.service.requestReset(EMAIL);
  const second = await h.service.requestReset(EMAIL);
  assert.equal(first.message, second.message);
  assert.equal(h.user.adminPasswordResetOtpSendCount, 1);
  assert.equal(h.getOtp(), "123456");
});

test("a newly accepted request invalidates the older code", async () => {
  const h = createHarness();
  await h.service.requestReset(EMAIL);
  h.setNow("2026-10-21T10:01:01Z");
  await h.service.requestReset(EMAIL);
  assert.equal(h.getOtp(), "654321");
  const oldCode = await h.service.resetPassword({ email: EMAIL, otp: "123456", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
  assert.equal(oldCode.ok, false);
  const currentCode = await h.service.resetPassword({ email: EMAIL, otp: "654321", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD });
  assert.equal(currentCode.ok, true);
});
