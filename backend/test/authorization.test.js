import test from "node:test";
import assert from "node:assert/strict";

import requireAdmin from "../src/middleware/requireAdmin.js";
import { createAuthenticateMiddleware } from "../src/middleware/sessionAuth.js";
import { listMyContests } from "../src/modules/contests/contestService.js";
import Contest from "../src/models/Contest.js";
import Wallet from "../src/models/Wallet.js";

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("unknown session IDs are denied before protected handlers run", async () => {
  let nextCalled = false;
  const auth = createAuthenticateMiddleware({
    LoginSession: { async findOne() { return null; } },
    User: {},
    hashSessionId: (token) => token,
    idleTimeoutMs: 900_000,
  });
  const res = response();
  await auth({ get: () => "attacker-supplied-token" }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_INVALID");
  assert.equal(nextCalled, false);
});

test("session identity comes from the stored session, not a submitted user ID", async () => {
  const session = {
    _id: "session-1",
    userId: "verified-user-id",
    sessionType: "player",
    authVersion: 0,
    createdAt: new Date(Date.now() - 1000),
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 900_000),
    absoluteExpiresAt: new Date(Date.now() + 86_400_000),
    async save() {},
  };
  const auth = createAuthenticateMiddleware({
    LoginSession: { async findOne() { return session; } },
    User: { findById(id) { assert.equal(id, "verified-user-id"); return { async select() { return { _id: id, role: "user", isEmailVerified: true, userId: "CC-1", authVersion: 0 }; } }; } },
    hashSessionId: (token) => token,
    idleTimeoutMs: 900_000,
  });
  const req = { body: { userId: "another-user-id", role: "admin" }, get: () => "stored-session-token" };
  const res = response();
  let nextCalled = false;
  await auth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user._id, "verified-user-id");
  assert.equal(req.user.role, "user");
});

test("player-owned contest reads query only the verified player's entries", async () => {
  const originalFind = Contest.find;
  let filter;
  const query = {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    lean() { return Promise.resolve([]); },
  };
  Contest.find = (value) => { filter = value; return query; };
  try {
    await listMyContests("64b000000000000000000001");
    assert.deepEqual(filter, { "players.user": "64b000000000000000000001" });
  } finally {
    Contest.find = originalFind;
  }
});

test("player wallet reads are scoped to the verified player", async () => {
  const originalFindOne = Wallet.findOne;
  let filter;
  Wallet.findOne = async (value) => { filter = value; return null; };
  try {
    const { getWallet } = await import("../src/modules/wallet/walletService.js");
    const wallet = await getWallet("64b000000000000000000001");
    assert.deepEqual(filter, { user: "64b000000000000000000001" });
    assert.equal(wallet.availableBalance, 0);
  } finally {
    Wallet.findOne = originalFindOne;
  }
});

test("only server-authenticated admins pass the admin authorization guard", () => {
  for (const role of [undefined, "user"]) {
    const res = response();
    let nextCalled = false;
    requireAdmin({ user: role ? { role } : null }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403);
    assert.equal(nextCalled, false);
  }

  const res = response();
  let nextCalled = false;
  requireAdmin({ user: { role: "admin" } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});
