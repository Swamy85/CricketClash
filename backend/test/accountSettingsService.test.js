import test from "node:test";
import assert from "node:assert/strict";
import {
  changeAccountPassword,
  normalizeNotificationPreferences,
  updateNotificationPreferences,
} from "../src/services/accountSettingsService.js";

test("notification preferences validate and persist only supported boolean fields", async () => {
  let update;
  const saved = { notificationPreferences: { matchUpdates: false, contestUpdates: true, results: true, announcements: true } };
  const User = {
    findByIdAndUpdate(_id, value) {
      update = value;
      return { select: async () => saved };
    },
  };
  const result = await updateNotificationPreferences({
    User,
    userId: "user-1",
    preferences: { matchUpdates: false },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(update.$set, { "notificationPreferences.matchUpdates": false });
  assert.equal(result.preferences.matchUpdates, false);
  assert.equal(result.preferences.contestUpdates, true);
  assert.equal(normalizeNotificationPreferences({}).results, true);

  const invalid = await updateNotificationPreferences({
    User,
    userId: "user-1",
    preferences: { admin: true },
  });
  assert.equal(invalid.status, 400);
});

test("password change verifies current password, keeps current session, and invalidates other sessions", async () => {
  const calls = [];
  const user = { _id: "user-1", passwordHash: "hash-old", authVersion: 3 };
  const User = {
    findById() { return { select: async () => user }; },
    findOneAndUpdate(filter, update) {
      calls.push([filter, update]);
      user.passwordHash = update.$set.passwordHash;
      user.authVersion += update.$inc.authVersion;
      return { select: async () => user };
    },
  };
  const LoginSession = {
    async updateOne(filter, update) { calls.push([filter, update]); return { matchedCount: 1 }; },
    async updateMany(filter, update) { calls.push([filter, update]); },
  };
  const result = await changeAccountPassword({
    User,
    LoginSession,
    user: { _id: user._id },
    session: { _id: "session-current" },
    currentPassword: "correct-old",
    newPassword: "new-password",
    comparePassword: async (candidate, hash) => candidate === "correct-old" && hash === "hash-old",
    hashPassword: async (value) => `hash:${value}`,
    now: () => new Date("2026-10-26T10:00:00.000Z"),
  });

  assert.equal(result.status, 200);
  assert.equal(result.currentSessionPreserved, true);
  assert.equal(user.passwordHash, "hash:new-password");
  assert.equal(user.authVersion, 4);
  assert.equal(calls[1][0]._id, "session-current");
  assert.equal(calls[1][1].$set.authVersion, 4);
  assert.equal(calls[2][0]._id.$ne, "session-current");
});

test("wrong current password cannot update the password hash", async () => {
  let updated = false;
  const result = await changeAccountPassword({
    User: {
      findById() { return { select: async () => ({ _id: "u1", passwordHash: "hash-old", authVersion: 0 }) }; },
      findOneAndUpdate() { updated = true; return { select: async () => ({}) }; },
    },
    LoginSession: {},
    user: { _id: "u1" },
    session: { _id: "s1" },
    currentPassword: "wrong",
    newPassword: "new-password",
    comparePassword: async (candidate) => candidate === "right",
    hashPassword: async () => "new-hash",
  });
  assert.equal(result.code, "CURRENT_PASSWORD_INCORRECT");
  assert.equal(updated, false);
});
