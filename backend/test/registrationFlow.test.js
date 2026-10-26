import test from "node:test";
import assert from "node:assert/strict";
import { createRegistrationService, hashOtp, otpMatches, makeOtp, isOtpExpired } from "../src/services/registrationService.js";

const now = new Date("2026-10-26T12:00:00.000Z");
const email = "player@example.com";
const username = "batter";

function harness({ users = [], pendingItems = [], sendError = null, notificationError = null, cooldown = 60_000 } = {}) {
  const sent = [];
  const notifications = [];
  const notificationFailures = [];
  const claims = new Map();
  let currentSendError = sendError;
  const find = (items, filter) => items.find((item) => Object.entries(filter).every(([key, value]) => {
    if (value instanceof RegExp) return value.test(item[key]);
    if (value && typeof value === "object" && "$exists" in value) return (item[key] !== undefined) === value.$exists;
    if (value && typeof value === "object" && "$gt" in value) return new Date(item[key]) > value.$gt;
    if (value && typeof value === "object" && "$lt" in value) return Number(item[key] ?? 0) < value.$lt;
    if (value && typeof value === "object" && "$gte" in value) return Number(item[key] ?? 0) >= value.$gte;
    return item[key] === value;
  }));
  const query = (value) => ({ select() { return Promise.resolve(value); }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
  class PendingRegistration {
    constructor(values) { Object.assign(this, values); this._id ||= `pending-${pendingItems.length + 1}`; this.otpAttempts ??= 0; }
    async save() {
      const collision = pendingItems.find((item) => item._id !== this._id && (item.email === this.email || item.usernameKey === this.usernameKey));
      if (collision) throw Object.assign(new Error("duplicate"), { code: 11000, keyPattern: { email: 1 } });
      if (!pendingItems.includes(this)) pendingItems.push(this);
      return this;
    }
    static findOne(filter) { return query(find(pendingItems, filter) || null); }
    static findOneAndUpdate(filter, update) {
      const item = find(pendingItems, filter);
      if (item) {
        Object.assign(item, update.$set || {});
        for (const key of Object.keys(update.$unset || {})) delete item[key];
        for (const [key, value] of Object.entries(update.$inc || {})) item[key] = (item[key] || 0) + value;
      }
      return query(item || null);
    }
    static async updateOne(filter, update) { await this.findOneAndUpdate(filter, update); }
    static async deleteOne(filter) { const item = find(pendingItems, filter); if (item) pendingItems.splice(pendingItems.indexOf(item), 1); }
  }
  class User {
    constructor(values) { Object.assign(this, values); this._id ||= `user-${users.length + 1}`; }
    async save() {
      if (users.some((item) => item.email === this.email || (item.username.toLowerCase() === this.username.toLowerCase() && item._id !== this._id))) {
        throw Object.assign(new Error("duplicate"), { code: 11000, keyPattern: { email: 1 } });
      }
      if (!users.includes(this)) users.push(this);
      return this;
    }
    static findOne(filter) { return query(find(users, filter) || null); }
    static async findOneAndUpdate(filter, update) {
      const item = find(users, filter);
      if (!item) return null;
      Object.assign(item, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete item[key];
      return item;
    }
    static async updateOne(filter, update) {
      const item = find(users, filter);
      if (!item) return { modifiedCount: 0 };
      Object.assign(item, update.$set || {});
      return { modifiedCount: 1 };
    }
  }
  const UsernameClaim = {
    async updateOne(filter, update) { if (!claims.has(filter.usernameKey)) claims.set(filter.usernameKey, update.$setOnInsert); },
    async findOne(filter) { return claims.get(filter.usernameKey) || null; },
    async deleteOne(filter) { if (claims.get(filter.usernameKey)?.email === filter.email) claims.delete(filter.usernameKey); },
  };
  const hash = (otp) => hashOtp("test-secret", otp);
  const service = createRegistrationService({
    User, PendingRegistration, UsernameClaim, now: () => now, hashOtp: hash,
    makeUserId: () => "CC-0001", resendCooldownMs: cooldown,
    sendOtpEmail: async (...args) => { sent.push(args); if (currentSendError) throw currentSendError; },
    sendRegistrationNotification: async (user) => { notifications.push(user); if (notificationError) throw notificationError; },
    logNotificationFailure: (error) => notificationFailures.push(error),
  });
  return { service, users, pendingItems, sent, notifications, notificationFailures, hash, setSendError(error) { currentSendError = error; } };
}

test("new registration emails OTP and stores only a hash in PendingRegistration", async () => {
  const h = harness();
  const result = await h.service.register({ username, email: " PLAYER@EXAMPLE.COM ", passwordHash: "bcrypt", otp: "123456" });
  assert.equal(result.status, 202);
  assert.equal(h.users.length, 0);
  assert.equal(h.pendingItems.length, 1);
  assert.equal(h.pendingItems[0].email, email);
  assert.equal(h.pendingItems[0].passwordHash, "bcrypt");
  assert.equal(h.pendingItems[0].otpHash, h.hash("123456"));
  assert.notEqual(h.pendingItems[0].otpHash, "123456");
  assert.equal(h.pendingItems[0].otpExpiresAt.getTime(), now.getTime() + 300_000);
  assert.match(makeOtp(), /^\d{6}$/);
});

test("email delivery failure leaves no new pending or permanent account", async () => {
  const h = harness({ sendError: new Error("SMTP refused") });
  const result = await h.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  assert.equal(result.code, "EMAIL_DELIVERY_FAILED");
  assert.equal(h.pendingItems.length, 0);
  assert.equal(h.users.length, 0);
});

test("retry after SMTP failure creates a pending record only after successful delivery", async () => {
  const h = harness({ sendError: new Error("temporary SMTP failure") });
  const first = await h.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  assert.equal(first.code, "EMAIL_DELIVERY_FAILED");
  assert.equal(h.pendingItems.length, 0);
  assert.equal(h.users.length, 0);
  h.setSendError(null);
  const retry = await h.service.register({ username, email, passwordHash: "bcrypt", otp: "654321" });
  assert.equal(retry.status, 202);
  assert.equal(h.pendingItems.length, 1);
  assert.equal(h.users.length, 0);
  assert.equal(h.pendingItems[0].otpHash, h.hash("654321"));
});

test("matching unverified registration retries with fresh OTP and supplied password hash", async () => {
  const pending = { _id: "p1", username, usernameKey: username, email, passwordHash: "old", otpHash: "old-otp", otpLastSentAt: new Date(now - 120_000), otpAttempts: 2, async save() { this.saved = true; } };
  const h = harness({ pendingItems: [pending] });
  const result = await h.service.register({ username, email, passwordHash: "new-hash", otp: "654321" });
  assert.equal(result.status, 202);
  assert.equal(pending.passwordHash, "new-hash");
  assert.equal(pending.otpHash, h.hash("654321"));
  assert.equal(pending.otpAttempts, 0);
  assert.equal(h.users.length, 0);
});

test("pending registration can change username and password after email cooldown", async () => {
  const pending = { _id: "p1", username, usernameKey: username, email, passwordHash: "old", otpHash: "current-otp", otpLastSentAt: new Date(now - 120_000), otpAttempts: 1, async save() { this.saved = true; } };
  const h = harness({ pendingItems: [pending] });
  const result = await h.service.register({ username: "new_batter", email, passwordHash: "new-hash", otp: "654321" });
  assert.equal(result.status, 202);
  assert.equal(pending.username, "new_batter");
  assert.equal(pending.usernameKey, "new_batter");
  assert.equal(pending.passwordHash, "new-hash");
  assert.equal(pending.otpHash, h.hash("654321"));
});

test("pending identity can be edited inside resend cooldown without replacing the active OTP", async () => {
  const pending = { _id: "p1", username, usernameKey: username, email, passwordHash: "old", otpHash: "current-otp", otpLastSentAt: now, otpAttempts: 0, async save() { this.saved = true; } };
  const h = harness({ pendingItems: [pending] });
  const result = await h.service.register({ username: "new_batter", email, passwordHash: "new-hash", otp: "654321" });
  assert.equal(result.status, 202);
  assert.equal(pending.username, "new_batter");
  assert.equal(pending.passwordHash, "new-hash");
  assert.equal(pending.otpHash, "current-otp");
  assert.equal(h.sent.length, 0);
});

test("verified email and username conflicts are rejected", async () => {
  const verified = harness({ users: [{ _id: "u1", username, email, isEmailVerified: true }] });
  assert.equal((await verified.service.register({ username, email, passwordHash: "x", otp: "123456" })).code, "ACCOUNT_ALREADY_VERIFIED");
  const usernameConflict = harness({ pendingItems: [{ _id: "p1", username: "other", usernameKey: "other", email: "other@example.com" }] });
  const result = await usernameConflict.service.register({ username: "other", email, passwordHash: "x", otp: "123456" });
  assert.equal(result.status, 409);
  const permanentNameConflict = harness({ users: [{ _id: "u2", username: "other", email: "other@example.com", isEmailVerified: true }] });
  const permanentConflict = await permanentNameConflict.service.register({ username: "other", email, passwordHash: "x", otp: "123456" });
  assert.equal(permanentConflict.status, 409);
});

test("valid OTP creates verified permanent User, assigns ID, and consumes pending record", async () => {
  const h = harness();
  await h.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  const verified = await h.service.verify(email, "123456");
  assert.equal(verified.status, 200);
  assert.equal(verified.user.isEmailVerified, true);
  assert.equal(verified.user.userId, "CC-0001");
  assert.equal(verified.user.email, email);
  assert.equal(h.users.length, 1);
  assert.equal(h.pendingItems.length, 0);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].username, username);
  assert.equal(h.notifications[0].email, email);
  assert.equal(h.notifications[0].userId, "CC-0001");
  assert.ok(h.users[0].registrationNotificationAttemptedAt instanceof Date);
  assert.equal((await h.service.verify(email, "123456")).code, "OTP_UNAVAILABLE");
  assert.equal(h.notifications.length, 1);
});

test("registration notification delivery failure does not interrupt successful account verification", async () => {
  const h = harness({ notificationError: Object.assign(new Error("SMTP unavailable"), { code: "ECONNECTION" }) });
  await h.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  const result = await h.service.verify(email, "123456");
  assert.equal(result.status, 200);
  assert.equal(h.users.length, 1);
  assert.equal(h.pendingItems.length, 0);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notificationFailures.length, 1);
  assert.ok(h.users[0].registrationNotificationAttemptedAt instanceof Date);
});

test("expired OTP cannot verify, and resend replaces it subject to cooldown", async () => {
  const h = harness({ cooldown: 0 });
  await h.service.register({ username, email, passwordHash: "bcrypt", otp: "111111" });
  h.pendingItems[0].otpExpiresAt = new Date(now.getTime() - 1);
  assert.equal((await h.service.verify(email, "111111")).code, "OTP_EXPIRED");
  await h.service.resend(email, "222222");
  assert.equal(h.pendingItems[0].otpHash, h.hash("222222"));
  assert.equal((await h.service.verify(email, "222222")).status, 200);
});

test("resend cooldown and five-attempt block cannot be bypassed by registration", async () => {
  const cooldownHarness = harness();
  await cooldownHarness.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  await cooldownHarness.service.resend(email, "654321");
  assert.equal(cooldownHarness.sent.length, 1);
  assert.equal(cooldownHarness.pendingItems[0].otpHash, cooldownHarness.hash("123456"));

  const blockedHarness = harness();
  await blockedHarness.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  for (let attempt = 0; attempt < 5; attempt += 1) await blockedHarness.service.verify(email, "999999");
  const retry = await blockedHarness.service.register({ username, email, passwordHash: "new-hash", otp: "654321" });
  assert.equal(retry.status, 429);
  assert.equal(retry.code, "OTP_COOLDOWN");
  assert.equal(blockedHarness.sent.length, 1);
});

test("concurrent verification attempts consume one OTP and create one permanent user", async () => {
  const h = harness();
  await h.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  const results = await Promise.all([h.service.verify(email, "123456"), h.service.verify(email, "123456")]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(h.users.length, 1);
  assert.equal(h.pendingItems.length, 0);
  assert.equal(h.notifications.length, 1);
});

test("an OTP submitted for another email cannot consume that registration", async () => {
  const h = harness();
  await h.service.register({ username, email, passwordHash: "first-hash", otp: "123456" });
  await h.service.register({ username: "bowler", email: "other@example.com", passwordHash: "second-hash", otp: "654321" });
  const result = await h.service.verify(email, "654321");
  assert.equal(result.code, "OTP_INVALID");
  assert.equal(h.pendingItems.length, 2);
  assert.equal(h.pendingItems.find((pending) => pending.email === "other@example.com").otpHash, h.hash("654321"));
  assert.equal(h.users.length, 0);
});

test("legacy unverified User upgrades after verification without changing its user ID", async () => {
  const originalWalletId = "wallet-legacy-9";
  const legacy = { _id: "legacy-id", username, email, passwordHash: "old-hash", role: "user", userId: "CC-LEGACY-42", isEmailVerified: false, otpLastSentAt: new Date(now - 120_000), walletId: originalWalletId };
  const h = harness({ users: [legacy] });
  const registration = await h.service.register({ username, email, passwordHash: "attacker-supplied-hash", otp: "123456" });
  assert.equal(registration.code, "LEGACY_VERIFICATION_REQUIRED");
  assert.equal(h.pendingItems.length, 0);
  assert.equal(legacy.passwordHash, "old-hash");
  await h.service.resend(email, "123456");
  assert.equal(h.users.length, 1);
  assert.equal(h.pendingItems.length, 1);
  const result = await h.service.verify(email, "123456");
  assert.equal(result.status, 200);
  assert.equal(h.users.length, 1);
  assert.equal(h.pendingItems.length, 0);
  assert.equal(legacy.isEmailVerified, true);
  assert.equal(legacy.userId, "CC-LEGACY-42");
  assert.equal(legacy.passwordHash, "old-hash");
  assert.equal(legacy.walletId, originalWalletId);
});

test("verified legacy accounts cannot restart email verification", async () => {
  const h = harness({ users: [{ _id: "verified-id", username, email, passwordHash: "stable-hash", role: "user", isEmailVerified: true }] });
  const result = await h.service.resend(email, "123456");
  assert.equal(result.status, 200);
  assert.equal(result.sent, false);
  assert.equal(h.sent.length, 0);
  assert.equal(h.pendingItems.length, 0);
});

test("wrong OTP attempts are counted and OTP comparison is timing-safe", async () => {
  const h = harness();
  await h.service.register({ username, email, passwordHash: "bcrypt", otp: "123456" });
  assert.equal((await h.service.verify(email, "999999")).code, "OTP_INVALID");
  assert.equal(h.pendingItems[0].otpAttempts, 1);
  assert.equal(otpMatches(h.hash, "123456", h.hash("123456")), true);
  assert.equal(isOtpExpired(new Date(now.getTime() - 1), now), true);
});
