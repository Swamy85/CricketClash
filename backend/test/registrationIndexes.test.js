import test from "node:test";
import assert from "node:assert/strict";
import User from "../src/models/User.js";
import PendingRegistration from "../src/models/PendingRegistration.js";
import UsernameClaim from "../src/models/UsernameClaim.js";
import { initializeUsernameClaims } from "../src/services/registrationService.js";

function uniqueIndexFor(Model, field) {
  return Model.schema.indexes().find(([keys, options]) => keys[field] === 1 && options.unique === true);
}

test("Mongo schemas declare unique email, username claims, pending identity, and sparse user IDs", () => {
  assert.ok(uniqueIndexFor(User, "email"));
  assert.ok(uniqueIndexFor(User, "userId")[1].sparse);
  assert.ok(uniqueIndexFor(UsernameClaim, "usernameKey"));
  assert.ok(uniqueIndexFor(PendingRegistration, "email"));
  assert.ok(uniqueIndexFor(PendingRegistration, "usernameKey"));
  assert.equal(uniqueIndexFor(User, "username"), undefined);
});

test("password and OTP hashes are excluded from default model selection", () => {
  assert.equal(User.schema.path("passwordHash").options.select, false);
  assert.equal(User.schema.path("otpHash").options.select, false);
  assert.equal(PendingRegistration.schema.path("passwordHash").options.select, false);
  assert.equal(PendingRegistration.schema.path("otpHash").options.select, false);
});

test("startup username-claim initialization creates indexes and backfills normalized legacy names", async () => {
  const claims = new Map();
  let indexesInitialized = false;
  const Model = {
    async createIndexes() { indexesInitialized = true; },
    async updateOne(filter, update) {
      if (!claims.has(filter.usernameKey)) claims.set(filter.usernameKey, update.$setOnInsert);
    },
  };
  await initializeUsernameClaims({ User: { async distinct() { return [" Batter ", "batter"]; } }, UsernameClaim: Model });
  assert.equal(indexesInitialized, true);
  assert.equal(claims.size, 1);
  assert.deepEqual(claims.get("batter"), { usernameKey: "batter", legacy: true, email: null });
});
