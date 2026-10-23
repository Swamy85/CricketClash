import test from "node:test";
import assert from "node:assert/strict";
import { selectVisibleOpenContests } from "../src/modules/contests/contestVisibility.js";

const now = new Date("2026-10-23T12:00:00.000Z");
const matchA = { _id: "match-a", status: "upcoming", startTime: new Date("2026-10-24T12:00:00.000Z") };
const matchB = { _id: "match-b", status: "upcoming", startTime: new Date("2026-10-25T12:00:00.000Z") };

function contest(id, { match = matchA, tier = "BRONZE", status = "WAITING", players = [], age = 0, expiresAt = match.startTime, settlementStatus } = {}) {
  return {
    _id: id,
    match,
    tier,
    status,
    players,
    settlementStatus,
    expiresAt,
    createdAt: new Date(now.getTime() + age),
  };
}

const half = (selectedTeam, entryPaymentStatus = "PAID", user = "player-a") => [{ user, selectedTeam, entryPaymentStatus }];

test("shared lobby exposes oldest half-filled contest per side and one empty contest per match and tier", () => {
  const rows = [
    contest("empty-new", { status: "OPEN", players: [], age: 5 }),
    contest("side-a-old", { players: half("A"), age: 1 }),
    contest("side-a-new", { players: half("A"), age: 3 }),
    contest("side-b", { players: half("B"), age: 2 }),
    contest("empty-old", { status: "OPEN", players: [], age: 0 }),
    contest("full", { status: "FULL", players: half("A").concat(half("B")), age: -1 }),
    contest("other-tier", { tier: "SILVER", status: "OPEN", players: [] }),
    contest("other-match", { match: matchB, status: "OPEN", players: [] }),
  ];

  const visible = selectVisibleOpenContests(rows, now);
  assert.deepEqual(new Set(visible.map((item) => item._id)), new Set([
    "empty-old", "side-a-old", "side-b", "other-tier", "other-match",
  ]));
});

test("pending, malformed, stale, and non-upcoming contests are not joinable in the public lobby", () => {
  const rows = [
    contest("pending", { players: half("A", "PENDING") }),
    contest("missing-side", { players: half("X") }),
    contest("started", { match: { ...matchA, status: "live" }, status: "OPEN", players: [] }),
    contest("expired", { status: "OPEN", players: [], expiresAt: new Date(now.getTime() - 1) }),
    contest("good", { status: "OPEN", players: [] }),
  ];

  assert.deepEqual(selectVisibleOpenContests(rows, now).map((item) => item._id), ["good"]);
});

test("participant count and settlement state override stale joinable status fields", () => {
  const rows = [
    contest("stale-full", { players: half("A").concat(half("B", "PAID", "player-b")) }),
    contest("duplicate-user", { players: half("A").concat(half("B", "PAID", "player-a")) }),
    contest("settled-open", { status: "OPEN", players: [], settlementStatus: "SETTLED" }),
    contest("refunded-waiting", { players: half("A"), settlementStatus: "REFUNDED" }),
    contest("valid-empty", { status: "OPEN", players: [] }),
  ];

  assert.deepEqual(selectVisibleOpenContests(rows, now).map((item) => item._id), ["valid-empty"]);
});

test("a filled or ineligible preferred half-filled contest allows the next eligible entry to be promoted", () => {
  const rows = [
    contest("older-pending", { players: half("A", "PENDING"), age: 0 }),
    contest("eligible-a", { players: half("A"), age: 1 }),
    contest("eligible-a-next", { players: half("A"), age: 2 }),
    contest("empty", { status: "OPEN", players: [] }),
  ];
  const visible = selectVisibleOpenContests(rows, now);
  assert.deepEqual(new Set(visible.map((item) => item._id)), new Set(["eligible-a", "empty"]));
});
