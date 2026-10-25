import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { jsonBodyParser, parseBoundedInteger, rejectUnsafeRequestKeys, unexpectedFields } from "../src/middleware/requestSafety.js";
import { validateCreateContest, validateJoinContest } from "../src/modules/contests/contestValidation.js";
import { validateMatch } from "../src/modules/matches/matchValidation.js";
import { DEPOSIT_UPLOAD_LIMITS } from "../src/modules/wallet/depositUpload.js";
import Match from "../src/models/Match.js";
import Contest from "../src/models/Contest.js";

function invokeSafety(req) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  rejectUnsafeRequestKeys(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test("request safety rejects Mongo operators and dotted keys in nested input", () => {
  for (const body of [
    { email: { $gt: "" } },
    { "$where": "return true" },
    { profile: { "wallet.balance": 1 } },
    { constructor: { prototype: { admin: true } } },
  ]) {
    const { res, nextCalled } = invokeSafety({ body, query: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(nextCalled, false);
  }
  assert.equal(invokeSafety({ body: { email: "person@example.com" }, query: {} }).nextCalled, true);
});

test("contest and match validators accept existing payloads and reject malformed IDs or unexpected fields", () => {
  const matchId = "64b000000000000000000001";
  assert.equal(validateCreateContest({ matchId, tier: "BRONZE" }).valid, true);
  assert.equal(validateCreateContest({ matchId: { $ne: null }, tier: "BRONZE" }).valid, false);
  assert.equal(validateCreateContest({ matchId, tier: "BRONZE", prizePool: 1 }).valid, false);
  assert.equal(validateJoinContest({ selectedTeam: "A" }).valid, true);
  assert.equal(validateJoinContest({ selectedTeam: "A", matchId, tier: "BRONZE", idempotencyKey: "request_key_1234567890" }).valid, true);
  assert.equal(validateJoinContest({ selectedTeam: "A", matchId, tier: "BRONZE", idempotencyKey: "short" }).valid, false);
  assert.equal(validateJoinContest({ selectedTeam: "A", matchId }).valid, false);
  assert.equal(validateJoinContest({ selectedTeam: "A", userId: matchId }).valid, false);

  const validMatch = {
    competition: "Premier League",
    teamA: "Falcons",
    teamB: "Tigers",
    format: "T20",
    startTime: "2027-01-01T12:00:00.000Z",
  };
  assert.deepEqual(validateMatch(validMatch), []);
  assert.deepEqual(validateMatch({
    ...validMatch,
    automaticContestGeneration: true,
    automaticContestTiers: ["FREE", "BRONZE"],
    creationRequestId: "match_creation_request_12345",
  }), []);
  assert.deepEqual(validateMatch({
    ...validMatch,
    automaticContestGeneration: false,
    automaticContestTiers: [],
  }), []);
  assert.ok(validateMatch({
    ...validMatch,
    automaticContestGeneration: true,
    automaticContestTiers: [],
  }).length > 0);
  assert.ok(validateMatch({
    ...validMatch,
    automaticContestTiers: ["UNSUPPORTED"],
  }).length > 0);
  assert.ok(validateMatch({ ...validMatch, creationRequestId: "short" }).length > 0);
  assert.ok(validateMatch({ ...validMatch, creationRequestId: "match_creation_request_12345" }, { partial: true }).length > 0);
  assert.ok(validateMatch({ ...validMatch, $set: { status: "completed" } }).length > 0);
  assert.ok(validateMatch({ ...validMatch, status: { $ne: "live" } }).length > 0);
});

test("matches default to automatic head-to-head templates and contests record their creation method", () => {
  const match = new Match({
    competition: "Premier League",
    teamA: "Falcons",
    teamB: "Tigers",
    startTime: new Date("2027-01-01T12:00:00.000Z"),
  });
  const contest = new Contest({ match: match._id, tier: "BRONZE", entryFee: 50, prizePool: 100, expiresAt: match.startTime, createdBy: match._id });
  assert.equal(match.automaticContestGeneration, true);
  assert.deepEqual(match.automaticContestTiers, ["FREE", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "ELITE", "CHAMPION"]);
  assert.equal(contest.creationMethod, "MANUAL");
});

test("unexpected field and bounded integer helpers reject unsafe query shapes", () => {
  assert.equal(unexpectedFields({ limit: "20" }, ["limit"]).length, 0);
  assert.ok(unexpectedFields({ limit: "20", sort: "anything" }, ["limit"]).length > 0);
  assert.equal(parseBoundedInteger("20", { min: 1, max: 100 }), 20);
  for (const value of ["0", "101", "10abc", "1e2", ["10"], { $gt: 1 }]) {
    assert.equal(parseBoundedInteger(value, { min: 1, max: 100 }), null);
  }
});

test("deposit upload caps file size, file count, field size, and multipart parts", () => {
  assert.deepEqual(DEPOSIT_UPLOAD_LIMITS, {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 5,
    fieldSize: 10 * 1024,
    fieldNameSize: 100,
    parts: 6,
  });
});

test("JSON parser rejects oversized and malformed request bodies safely", async (t) => {
  const app = express();
  app.use(jsonBodyParser);
  app.post("/", (_req, res) => res.json({ success: true }));
  app.use((error, _req, res, _next) => {
    const status = error?.type === "entity.too.large" ? 413 : error?.type === "entity.parse.failed" ? 400 : 500;
    res.status(status).json({ success: false, message: status === 413 ? "Request body is too large." : "Request body contains invalid JSON." });
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/`;

  const oversized = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(21 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { success: false, message: "Request body is too large." });

  const malformed = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid-json",
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { success: false, message: "Request body contains invalid JSON." });
});
