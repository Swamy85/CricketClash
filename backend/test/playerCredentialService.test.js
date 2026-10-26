import test from "node:test";
import assert from "node:assert/strict";
import { findPlayerWithValidPassword } from "../src/services/playerCredentialService.js";

function mockUser(user) {
  return { findOne(filter) {
    assert.deepEqual(filter, { email: "player@example.com" });
    return { async select(fields) {
      assert.equal(fields, "+passwordHash +authVersion");
      return user;
    } };
  } };
}

test("player login looks up normalized email and accepts a matching password", async () => {
  const user = { role: "user", passwordHash: "bcrypt-hash" };
  const found = await findPlayerWithValidPassword({
    User: mockUser(user), email: " PLAYER@EXAMPLE.COM ", password: "correct",
    comparePassword: async (password, hash) => password === "correct" && hash === "bcrypt-hash",
  });
  assert.equal(found, user);
});

test("incorrect passwords and admin accounts cannot use player login", async () => {
  const wrongPassword = await findPlayerWithValidPassword({
    User: mockUser({ role: "user", passwordHash: "bcrypt-hash" }),
    email: "player@example.com", password: "wrong", comparePassword: async () => false,
  });
  assert.equal(wrongPassword, null);
  const admin = await findPlayerWithValidPassword({
    User: mockUser({ role: "admin", passwordHash: "bcrypt-hash" }),
    email: "player@example.com", password: "correct", comparePassword: async () => true,
  });
  assert.equal(admin, null);
});
