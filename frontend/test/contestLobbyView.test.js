import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONTEST_CATEGORY,
  getContestLobbyView,
  getJoinedContestStatus,
  getJoinedContestView,
} from "../src/features/dashboard/contests/contestLobbyView.js";

const userId = "player-1";
const match = { _id: "match-1", status: "upcoming", startTime: "2026-11-01T10:00:00Z" };
const now = new Date("2026-10-23T12:00:00Z");
const contests = [
  { _id: "mine", match, expiresAt: match.startTime, tier: "SILVER", entryFee: 100, status: "WAITING", players: [{ user: { _id: userId } }] },
  { _id: "empty-high", match, expiresAt: match.startTime, tier: "GOLD", entryFee: 250, status: "OPEN", players: [] },
  { _id: "opponent", match, expiresAt: match.startTime, tier: "BRONZE", entryFee: 50, status: "WAITING", players: [{ user: { _id: "player-2" }, selectedTeam: "A", entryPaymentStatus: "PAID" }] },
  { _id: "empty-low", match, expiresAt: match.startTime, tier: "FREE", entryFee: 0, status: "OPEN", players: [] },
  { _id: "full", match, expiresAt: match.startTime, entryFee: 5, status: "FULL", players: [{}, {}] },
];

test("Available Contests is the default category", () => {
  assert.equal(DEFAULT_CONTEST_CATEGORY, "AVAILABLE");
});

test("Available Contests shows only empty contests, not entries waiting for an opponent", () => {
  assert.deepEqual(
    getContestLobbyView(contests, { currentUserId: userId, now }).map((item) => item._id),
    ["empty-low", "empty-high"]
  );
});

test("Joined Contests retains separate entries across statuses and match filtering", () => {
  const secondEntry = { ...contests[0], _id: "mine-again", status: "FULL", players: [{ user: { _id: userId } }, { user: { _id: "player-2" } }] };
  const completed = { ...secondEntry, _id: "completed", status: "COMPLETED", settlementStatus: "SETTLED", winnerId: { userId } };
  assert.deepEqual(getJoinedContestView([contests[0], secondEntry, completed], "match-1").map((item) => item._id), ["mine", "mine-again", "completed"]);
  assert.deepEqual(getJoinedContestView([contests[0]], "other-match"), []);
});

test("Joined Contests defaults to the newest joined match instead of showing older match entries", () => {
  const previousMatch = { ...match, _id: "previous-match", teamA: "Old A", teamB: "Old B" };
  const entries = [
    { ...contests[0], match },
    { ...contests[0], _id: "old-entry", match: previousMatch },
  ];
  assert.deepEqual(getJoinedContestView(entries).map((item) => item._id), ["mine"]);
  assert.deepEqual(getJoinedContestView(entries, "previous-match").map((item) => item._id), ["old-entry"]);
});

test("Available Contests omits expired, started, non-upcoming, and already joined entries", () => {
  const expired = { ...contests[1], _id: "expired", expiresAt: new Date(now.getTime() - 1) };
  const started = { ...contests[1], _id: "started", match: { ...match, startTime: new Date(now.getTime() - 1) } };
  const live = { ...contests[1], _id: "live", match: { ...match, status: "live" } };
  assert.deepEqual(
    getContestLobbyView([...contests, expired, started, live], { currentUserId: userId, now }).map((item) => item._id),
    ["empty-low", "empty-high"]
  );
});

test("Available Contests rejects stale full, payment-pending, and settled rows", () => {
  const staleFull = { ...contests[2], _id: "stale-full", players: [
    { user: { _id: "player-2" }, selectedTeam: "A", entryPaymentStatus: "PAID" },
    { user: { _id: "player-3" }, selectedTeam: "B", entryPaymentStatus: "PAID" },
  ] };
  const pending = { ...contests[2], _id: "pending", players: [
    { user: { _id: "player-2" }, selectedTeam: "A", entryPaymentStatus: "PENDING" },
  ] };
  const settled = { ...contests[1], _id: "settled", settlementStatus: "SETTLED" };
  const result = getContestLobbyView([...contests, staleFull, pending, settled], { currentUserId: userId, now });
  assert.deepEqual(result.map((item) => item._id), ["empty-low", "empty-high"]);
});

test("Joined Contests derives full status from both participants when a stale response says waiting", () => {
  const stalePaired = {
    ...contests[0],
    status: "WAITING",
    players: [
      { user: { _id: userId }, selectedTeam: "A", entryPaymentStatus: "PAID" },
      { user: { _id: "player-2", userId: "CC-2" }, selectedTeam: "B", entryPaymentStatus: "PAID" },
    ],
  };
  assert.equal(getJoinedContestStatus(stalePaired, userId).label, "Contest Full");
  assert.deepEqual(getJoinedContestView([stalePaired], "match-1").map((row) => row._id), ["mine"]);
});

test("joined contest status reflects waiting, live, won, lost, and refunded backend state", () => {
  assert.equal(getJoinedContestStatus(contests[0], userId).label, "Waiting for Opponent");
  assert.equal(getJoinedContestStatus({ ...contests[0], status: "FULL", match: { ...match, status: "live" } }, userId).label, "Live");
  assert.equal(getJoinedContestStatus({ ...contests[0], status: "COMPLETED", settlementStatus: "SETTLED", winnerId: { userId } }, userId).label, "Won");
  assert.equal(getJoinedContestStatus({ ...contests[0], status: "COMPLETED", settlementStatus: "SETTLED", winnerId: { userId: "other" } }, userId).label, "Lost");
  assert.equal(getJoinedContestStatus({ ...contests[0], status: "REFUNDED", settlementStatus: "REFUNDED" }, userId).label, "Refunded");
});
