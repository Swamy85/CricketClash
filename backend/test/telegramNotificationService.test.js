import test from "node:test";
import assert from "node:assert/strict";

import {
  createTelegramNotificationService,
  announceMatchEvent,
  enqueueTelegramNotification,
  formatMatchAnnouncement,
  retryDueMatchTelegramNotifications,
} from "../src/services/telegramNotificationService.js";

function makeAnnouncementModel() {
  const rows = new Map();
  return {
    rows,
    async create(record) {
      if (rows.has(record.key)) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
      rows.set(record.key, { ...record });
    },
    findOne({ key }) {
      return { lean: async () => rows.get(key) || null };
    },
    findOneAndUpdate(filter, update) {
      const row = rows.get(filter.key);
      if (!row || row.status !== filter.status) return { lean: async () => null };
      if (filter.$or && row.nextAttemptAt && new Date(row.nextAttemptAt) > new Date()) return { lean: async () => null };
      Object.assign(row, update.$set);
      return { lean: async () => ({ ...row }) };
    },
    async updateOne(filter, update) {
      const row = rows.get(filter.key);
      if (!row && update.$setOnInsert) {
        rows.set(filter.key, { ...update.$setOnInsert });
        return { upsertedCount: 1 };
      }
      if (!row || row.status !== filter.status) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    },
  };
}

test("Telegram notifications use the Bot API and a stable key sends only once", async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-secret-token";
  process.env.TELEGRAM_CHAT_ID = "-1004406740305";
  const AnnouncementModel = makeAnnouncementModel();
  const requests = [];
  const send = createTelegramNotificationService({
    AnnouncementModel,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
    },
  });
  try {
    assert.deepEqual(await send({ key: "match:abc:started", text: "Match is live" }), {
      sent: true,
      duplicate: false,
    });
    assert.deepEqual(await send({ key: "match:abc:started", text: "Match is live" }), {
      sent: false,
      duplicate: true,
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.telegram.org/bottest-secret-token/sendMessage");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      chat_id: "-1004406740305",
      text: "Match is live",
    });
    assert.equal(AnnouncementModel.rows.get("match:abc:started").status, "SENT");
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = previousChat;
  }
});

test("ambiguous transport failures are not automatically retried", async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-secret-token";
  process.env.TELEGRAM_CHAT_ID = "-1004406740305";
  const AnnouncementModel = makeAnnouncementModel();
  let requests = 0;
  const send = createTelegramNotificationService({
    AnnouncementModel,
    fetchImpl: async () => {
      requests += 1;
      throw new Error("network failure");
    },
  });
  try {
    await assert.rejects(send({ key: "match:abc:started", text: "Match is live" }), {
      code: "TELEGRAM_DELIVERY_UNKNOWN",
    });
    assert.deepEqual(await send({ key: "match:abc:started", text: "Match is live" }), {
      sent: false,
      duplicate: true,
    });
    assert.equal(requests, 1);
    assert.equal(AnnouncementModel.rows.get("match:abc:started").status, "UNKNOWN");
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = previousChat;
  }
});

test("Telegram API rejection is persisted and retried successfully on the next scan", async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "test-secret-token";
  process.env.TELEGRAM_CHAT_ID = "test-channel";
  const AnnouncementModel = makeAnnouncementModel();
  let requests = 0;
  const send = createTelegramNotificationService({
    AnnouncementModel,
    fetchImpl: async () => {
      requests += 1;
      return requests === 1
        ? { ok: false, json: async () => ({ ok: false, error_code: 429 }) }
        : { ok: true, json: async () => ({ ok: true, result: { message_id: 43 } }) };
    },
  });
  try {
    await assert.rejects(send({ key: "match:retry:started", text: "Match is live" }), { code: "TELEGRAM_API_429" });
    assert.equal(AnnouncementModel.rows.get("match:retry:started").status, "FAILED");
    AnnouncementModel.rows.get("match:retry:started").nextAttemptAt = new Date(0);
    assert.deepEqual(await send({ key: "match:retry:started", text: "Match is live" }), { sent: true, duplicate: false });
    assert.equal(AnnouncementModel.rows.get("match:retry:started").status, "SENT");
    assert.equal(requests, 2);
  } finally {
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = previousChat;
  }
});

test("queued notification survives a worker restart and due scan retries it once", async () => {
  const AnnouncementModel = makeAnnouncementModel();
  const deliveries = [];
  const send = async (message) => { deliveries.push(message); return { sent: true }; };
  await enqueueTelegramNotification({ key: "match:restart:started", text: "Alpha vs Beta is live", AnnouncementModel, send });
  assert.equal(AnnouncementModel.rows.get("match:restart:started").status, "PENDING");
  const dueQuery = {
    select() { return this; }, sort() { return this; }, limit() { return this; },
    lean: async () => [...AnnouncementModel.rows.values()].filter((row) => row.key.startsWith("match:") && ["PENDING", "FAILED"].includes(row.status)),
  };
  AnnouncementModel.find = () => dueQuery;
  const MatchModel = { find: (filter) => {
    assert.deepEqual(filter, { _id: { $in: ["restart"] }, published: true });
    return { select() { return this; }, lean: async () => [{ _id: "restart" }] };
  } };
  assert.equal(await retryDueMatchTelegramNotifications({ AnnouncementModel, MatchModel, send }), 1);
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries[0], deliveries[1]);
});

test("queued retries for matches that are currently unpublished are not delivered", async () => {
  const AnnouncementModel = makeAnnouncementModel();
  AnnouncementModel.rows.set("match:hidden:started", { key: "match:hidden:started", text: "Hidden match", status: "PENDING" });
  AnnouncementModel.find = () => ({
    select() { return this; }, sort() { return this; }, limit() { return this; },
    lean: async () => [AnnouncementModel.rows.get("match:hidden:started")],
  });
  const MatchModel = { find: (filter) => {
    assert.deepEqual(filter, { _id: { $in: ["hidden"] }, published: true });
    return { select() { return this; }, lean: async () => [] };
  } };
  let deliveries = 0;
  const send = async () => { deliveries += 1; };
  assert.equal(await retryDueMatchTelegramNotifications({ AnnouncementModel, MatchModel, send }), 0);
  assert.equal(deliveries, 0);
});

test("match announcement text is generated from existing match data", () => {
  const fixture = formatMatchAnnouncement("UPCOMING_FIXTURE", {
    _id: "match-1",
    teamA: "India",
    teamB: "New Zealand",
    competition: "T20 Series",
    startTime: "2026-10-27T07:00:00.000Z",
  });
  assert.equal(fixture.key, "match:match-1:fixture:2026-10-27T07:00:00.000Z");
  assert.match(fixture.text, /India vs New Zealand/);
  assert.match(fixture.text, /T20 Series/);

  const result = formatMatchAnnouncement("VERIFIED_RESULT", {
    _id: "match-1",
    teamA: "India",
    teamB: "New Zealand",
    result: "teamA",
    resultRevision: 2,
  });
  assert.match(result.text, /Winner: India/);
  assert.equal(formatMatchAnnouncement("VERIFIED_RESULT", {
    _id: "match-1",
    teamA: "India",
    teamB: "New Zealand",
    result: "teamA",
    pendingResultCorrection: { revision: 3 },
  }), null);
});

test("provider result messages include available score and winner and unpublished matches are skipped", async () => {
  const result = formatMatchAnnouncement("PROVIDER_FINAL_RESULT", {
    _id: "match-result",
    teamA: "India",
    teamB: "New Zealand",
    competition: "Test Series",
    providerStatus: "India won by 5 wickets",
    providerScoreA: "150/5",
    providerScoreB: "148/10",
  }, { key: "match:match-result:provider-final-result" });
  assert.match(result.text, /India won by 5 wickets/);
  assert.match(result.text, /Winner: India/);
  assert.match(result.text, /150\/5/);
  assert.deepEqual(await announceMatchEvent("MATCH_STARTED", { published: false, _id: "unpublished" }), {
    sent: false,
    skipped: true,
    reason: "match-unpublished",
  });
  assert.deepEqual(await announceMatchEvent("MATCH_STARTED", { _id: "publication-unknown" }), {
    sent: false,
    skipped: true,
    reason: "match-unpublished",
  });
});

test("match notifications share official formatting, IST time, status, and branded footer", () => {
  const match = {
    _id: "official-format",
    teamA: "India",
    teamB: "New Zealand",
    competition: "Champions Series",
    startTime: "2030-01-02T12:30:00.000Z",
    venue: "Central Ground",
  };
  for (const event of ["UPCOMING_FIXTURE", "UPCOMING_REMINDER", "MATCH_STARTED", "CONTESTS_AVAILABLE", "MATCH_RESCHEDULED", "MATCH_STATUS"]) {
    const announcement = formatMatchAnnouncement(event, {
      ...match,
      status: event === "MATCH_STATUS" ? "abandoned" : "upcoming",
      previousStartTime: "2030-01-01T12:30:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    }, { contestCount: 8 });
    assert.match(announcement.text, /CRICKETCLASH/);
    assert.match(announcement.text, /India vs New Zealand/);
    assert.match(announcement.text, /Champions Series/);
    assert.match(announcement.text, /IST/);
    assert.match(announcement.text, /Official Match Updates/);
    assert.ok(announcement.text.length <= 4096);
  }
});

test("provider status and final messages omit missing details and sanitize dynamic text", () => {
  const delayed = formatMatchAnnouncement("PROVIDER_MATCH_STATUS", {
    _id: "missing-data",
    teamA: "Alpha\nStatus: fabricated",
    teamB: "",
    providerStatus: "Match delayed\nWinner: Alpha",
    providerScoreA: "",
    providerScoreB: null,
  }, { key: "match:missing-data:provider-status" });
  assert.match(delayed.text, /Alpha Status: fabricated vs Team B/);
  assert.match(delayed.text, /Status: Match delayed Winner: Alpha/);
  assert.doesNotMatch(delayed.text, /\nWinner: Alpha/);
  assert.doesNotMatch(delayed.text, /Score unavailable/);
  assert.doesNotMatch(delayed.text, /Tournament \/ Series:/);
  assert.doesNotMatch(delayed.text, /IST/);

  const final = formatMatchAnnouncement("PROVIDER_FINAL_RESULT", {
    _id: "provider-final-missing",
    teamA: "Alpha",
    teamB: "Beta",
    providerStatus: "Match completed",
  }, { key: "match:provider-final-missing:provider-final-result" });
  assert.match(final.text, /PROVIDER-CONFIRMED RESULT/);
  assert.doesNotMatch(final.text, /Winner:/);
  assert.doesNotMatch(final.text, /Alpha:|Beta:/);
});

test("provider schedule updates and final results use only supplied dates, scores, and confirmed winner", () => {
  const schedule = formatMatchAnnouncement("PROVIDER_MATCH_STATUS", {
    _id: "provider-rescheduled",
    teamA: "Alpha",
    teamB: "Beta",
    providerStatus: "Match rescheduled - provider schedule updated",
    previousStartTime: "2030-01-01T12:30:00.000Z",
    providerStartTime: "2030-01-02T12:30:00.000Z",
  }, { key: "match:provider-rescheduled:provider-schedule:1" });
  assert.match(schedule.text, /Previous schedule:/);
  assert.match(schedule.text, /Updated schedule:/);

  const result = formatMatchAnnouncement("PROVIDER_FINAL_RESULT", {
    _id: "provider-confirmed",
    teamA: "Alpha",
    teamB: "Beta",
    providerStatus: "Alpha won by 5 wickets",
    providerScoreA: "150\/5",
  }, { key: "match:provider-confirmed:provider-final-result" });
  assert.match(result.text, /Alpha: 150\/5/);
  assert.match(result.text, /Winner: Alpha/);
  assert.doesNotMatch(result.text, /Beta:|Score unavailable/);
});
