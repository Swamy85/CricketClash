import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_SESSION_KEY, PLAYER_ACTIVITY_KEY, PLAYER_SESSION_KEY } from "../src/features/auth/services/sessionKeys.js";
import { restoreValidatedSession } from "../src/features/auth/services/sessionRestore.js";

function storage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
  };
}

test("browser refresh restoration requires server validation and resets activity to validation time", async () => {
  const store = storage({ [PLAYER_SESSION_KEY]: "player-token", [PLAYER_ACTIVITY_KEY]: "1000" });
  let validations = 0;
  const result = await restoreValidatedSession(store, async () => {
    validations += 1;
    return { success: true, user: { userId: "CC-123" }, session: { absoluteExpiresAt: "2026-10-22T00:00:00.000Z" } };
  }, 2_000_000);
  assert.equal(validations, 1);
  assert.equal(result.valid, true);
  assert.equal(result.user.userId, "CC-123");
  assert.equal(result.checkedAt, 2_000_000);
  assert.equal(result.absoluteExpiresAt, Date.parse("2026-10-22T00:00:00.000Z"));
});

test("browser refresh does not trust a local token without successful server validation", async () => {
  const store = storage({ [PLAYER_SESSION_KEY]: "expired-token" });
  const result = await restoreValidatedSession(store, async () => ({ success: false }), 10_000);
  assert.deepEqual(result, { valid: false, reason: "invalid" });
});

test("a replaced session response cannot authenticate a different stored token", async () => {
  const store = storage({ [PLAYER_SESSION_KEY]: "old-token" });
  const result = await restoreValidatedSession(store, async () => {
    store.setItem(PLAYER_SESSION_KEY, "new-token");
    return { success: true, user: { userId: "CC-OLD" } };
  }, 10_000);
  assert.deepEqual(result, { valid: false, reason: "superseded" });
  assert.equal(store.getItem(PLAYER_SESSION_KEY), "new-token");
});

test("player and admin tokens use independent existing session storage keys", () => {
  assert.equal(PLAYER_SESSION_KEY, "cc_session_id");
  assert.equal(ADMIN_SESSION_KEY, "cc_admin_session");
  assert.notEqual(PLAYER_SESSION_KEY, ADMIN_SESSION_KEY);
  const store = storage({ [PLAYER_SESSION_KEY]: "player-token", [ADMIN_SESSION_KEY]: "admin-token" });
  store.removeItem(ADMIN_SESSION_KEY);
  assert.equal(store.getItem(PLAYER_SESSION_KEY), "player-token");
  assert.equal(store.getItem(ADMIN_SESSION_KEY), null);
});
