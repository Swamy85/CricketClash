import test from "node:test";
import assert from "node:assert/strict";

import {
  createTelegramNotificationService,
  formatMatchAnnouncement,
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
    async findOneAndUpdate(filter, update) {
      const row = rows.get(filter.key);
      if (!row || row.status !== filter.status) return null;
      Object.assign(row, update.$set);
      return { ...row };
    },
    async updateOne(filter, update) {
      const row = rows.get(filter.key);
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
  assert.match(result.text, /India won/);
  assert.equal(formatMatchAnnouncement("VERIFIED_RESULT", {
    _id: "match-1",
    teamA: "India",
    teamB: "New Zealand",
    result: "teamA",
    pendingResultCorrection: { revision: 3 },
  }), null);
});
