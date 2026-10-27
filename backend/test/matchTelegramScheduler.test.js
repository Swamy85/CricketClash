import test from "node:test";
import assert from "node:assert/strict";
import { getMatchNotificationEvents, processMatchNotifications } from "../src/services/matchTelegramScheduler.js";

const now = new Date("2026-10-27T06:00:00.000Z");

test("scheduler recognizes upcoming reminders and confirmed transitions", () => {
  const base = { _id: "m1", published: true, teamA: "India", teamB: "NZ", startTime: "2026-10-27T06:30:00.000Z" };
  assert.equal(getMatchNotificationEvents({ ...base, status: "upcoming" }, now, 60 * 60_000)[0].name, "UPCOMING_REMINDER");
  assert.equal(getMatchNotificationEvents({ ...base, status: "live" }, now)[0].name, "MATCH_STARTED");
  assert.equal(getMatchNotificationEvents({ ...base, status: "completed", result: "teamA" }, now)[0].name, "VERIFIED_RESULT");
  assert.equal(getMatchNotificationEvents({ ...base, status: "completed", result: "teamA", pendingResultCorrection: { revision: 2 } }, now).length, 0);
  assert.equal(getMatchNotificationEvents({ ...base, status: "abandoned", updatedAt: now }, now)[0].name, "MATCH_STATUS");
  assert.equal(getMatchNotificationEvents({ ...base, status: "upcoming", previousStartTime: "2026-10-27T06:00:00.000Z" }, now, 60 * 60_000).some((event) => event.name === "MATCH_RESCHEDULED"), true);
});

test("unpublished matches produce no reminder, start, status, reschedule, or result events", () => {
  const base = { _id: "hidden", published: false, teamA: "India", teamB: "NZ", startTime: "2026-10-27T06:30:00.000Z", updatedAt: now };
  for (const match of [
    { ...base, status: "upcoming" },
    { ...base, status: "upcoming", previousStartTime: now },
    { ...base, status: "live" },
    { ...base, status: "cancelled" },
    { ...base, status: "completed", result: "teamA" },
  ]) {
    assert.deepEqual(getMatchNotificationEvents(match, now, 60 * 60_000), []);
  }
});

test("worker query and event loop send every notification category only for published matches", async () => {
  const matches = [
    { _id: "pub-reminder", published: true, status: "upcoming", startTime: new Date(now.getTime() + 10_000) },
    { _id: "hidden-reminder", published: false, status: "upcoming", startTime: new Date(now.getTime() + 10_000) },
    { _id: "pub-live", published: true, status: "live", startTime: now },
    { _id: "hidden-live", published: false, status: "live", startTime: now },
    { _id: "pub-cancel", published: true, status: "cancelled", updatedAt: now },
    { _id: "hidden-cancel", published: false, status: "cancelled", updatedAt: now },
    { _id: "pub-result", published: true, status: "completed", result: "teamA" },
    { _id: "hidden-result", published: false, status: "completed", result: "teamA" },
  ];
  let matchFilter;
  const MatchModel = { find: (filter) => { matchFilter = filter; return { select() { return this; }, lean: async () => matches }; } };
  const sent = [];
  await processMatchNotifications({
    MatchModel,
    now,
    announcementModel: { findOne: () => ({ select() { return this; }, lean: async () => null }) },
    announce: async (event, match) => { sent.push(`${match._id}:${event}`); },
    closeEntries: async () => {}, processOutcomes: async () => {}, settleOutcomes: async () => {}, processRefunds: async () => {},
    retryQueued: async () => 0,
  });
  assert.equal(matchFilter.published, true);
  assert.deepEqual(sent.sort(), [
    "pub-reminder:UPCOMING_REMINDER", "pub-live:MATCH_STARTED", "pub-cancel:MATCH_STATUS", "pub-result:VERIFIED_RESULT",
  ].sort());
});

test("scheduler catches up after restart and skips previously reserved events", async () => {
  const match = { _id: "m2", published: true, teamA: "India", teamB: "NZ", status: "live", startTime: now, updatedAt: now };
  const rows = new Map();
  const announcementModel = { findOne: ({ key }) => ({ select: () => ({ lean: async () => rows.get(key) || null }) }) };
  const MatchModel = { find: () => ({ select: () => ({ lean: async () => [match] }) }) };
  let sent = 0;
  let outcomeChecks = 0;
  let settlementChecks = 0;
  let refundChecks = 0;
  const announce = async (_event, _match, { key }) => { sent += 1; rows.set(key, { status: "SENT" }); return { sent: true }; };
  const closeEntries = async () => ({ checked: 0, closed: 0 });
  const processOutcomes = async () => { outcomeChecks += 1; return { matches: 0, considered: 0, processed: 0 }; };
  const settleOutcomes = async () => { settlementChecks += 1; return { matches: 0, considered: 0, settled: 0, failed: 0 }; };
  const processRefunds = async () => { refundChecks += 1; return { considered: 0, refunded: 0, failed: 0 }; };
  const retryQueued = async () => 0;
  await processMatchNotifications({ MatchModel, announcementModel, announce, now, closeEntries, processOutcomes, settleOutcomes, processRefunds, retryQueued });
  await processMatchNotifications({ MatchModel, announcementModel, announce, now, closeEntries, processOutcomes, settleOutcomes, processRefunds, retryQueued });
  assert.equal(sent, 1);
  assert.equal(outcomeChecks, 2);
  assert.equal(settlementChecks, 2);
  assert.equal(refundChecks, 2);
});
