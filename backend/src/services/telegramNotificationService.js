import TelegramAnnouncement from "../models/TelegramAnnouncement.js";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 4096;

function configuredTelegram() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) {
    const error = new Error("Telegram notifications are not configured.");
    error.code = "TELEGRAM_NOT_CONFIGURED";
    throw error;
  }
  return { token, chatId };
}

function safeErrorCode(value) {
  return String(value || "TELEGRAM_DELIVERY_FAILED")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
}

async function reserveAnnouncement(AnnouncementModel, key, text) {
  try {
    await AnnouncementModel.create({ key, text, status: "PROCESSING" });
    return { claimed: true, duplicate: false };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const existing = await AnnouncementModel.findOne({ key }).lean();
  if (!existing) {
    const error = new Error("Telegram notification reservation could not be read.");
    error.code = "TELEGRAM_RESERVATION_UNAVAILABLE";
    throw error;
  }
  if (existing.text !== text) {
    const error = new Error("This Telegram notification key is already used for different content.");
    error.code = "TELEGRAM_KEY_CONFLICT";
    throw error;
  }
  if (existing.status !== "FAILED") return { claimed: false, duplicate: true };

  const retry = await AnnouncementModel.findOneAndUpdate(
    { key, status: "FAILED" },
    { $set: { status: "PROCESSING", errorCode: null } },
    { new: true }
  ).lean();
  return retry
    ? { claimed: true, duplicate: false }
    : { claimed: false, duplicate: true };
}

export function createTelegramNotificationService({
  AnnouncementModel = TelegramAnnouncement,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return async function sendTelegramNotification({ key, text }) {
    const normalizedKey = String(key || "").trim();
    const normalizedText = String(text || "").trim();
    if (!normalizedKey || normalizedKey.length > 180) {
      const error = new Error("A stable Telegram notification key is required.");
      error.code = "TELEGRAM_INVALID_KEY";
      throw error;
    }
    if (!normalizedText || normalizedText.length > MAX_MESSAGE_LENGTH) {
      const error = new Error(`Telegram messages must contain 1-${MAX_MESSAGE_LENGTH} characters.`);
      error.code = "TELEGRAM_INVALID_MESSAGE";
      throw error;
    }

    const { token, chatId } = configuredTelegram();
    const reservation = await reserveAnnouncement(AnnouncementModel, normalizedKey, normalizedText);
    if (!reservation.claimed) return { sent: false, duplicate: true };

    let response;
    let payload;
    try {
      response = await fetchImpl(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: normalizedText }),
        signal: AbortSignal.timeout(12_000),
      });
      payload = await response.json();
    } catch {
      // Telegram does not support idempotency keys. A transport failure may
      // happen after Telegram accepted the message, so fail closed to avoid a
      // duplicate announcement on retry.
      await AnnouncementModel.updateOne(
        { key: normalizedKey, status: "PROCESSING" },
        { $set: { status: "UNKNOWN", errorCode: "TELEGRAM_TRANSPORT_UNKNOWN" } }
      );
      const error = new Error("Telegram delivery could not be confirmed.");
      error.code = "TELEGRAM_DELIVERY_UNKNOWN";
      throw error;
    }

    if (!response.ok || payload?.ok !== true) {
      const code = safeErrorCode(payload?.error_code ? `TELEGRAM_API_${payload.error_code}` : "TELEGRAM_API_REJECTED");
      await AnnouncementModel.updateOne(
        { key: normalizedKey, status: "PROCESSING" },
        { $set: { status: "FAILED", errorCode: code } }
      );
      const error = new Error("Telegram rejected the notification.");
      error.code = code;
      throw error;
    }

    await AnnouncementModel.updateOne(
      { key: normalizedKey, status: "PROCESSING" },
      {
        $set: {
          status: "SENT",
          telegramMessageId: Number.isSafeInteger(payload.result?.message_id)
            ? payload.result.message_id
            : null,
          errorCode: null,
        },
      }
    );
    return { sent: true, duplicate: false };
  };
}

export const sendTelegramNotification = createTelegramNotificationService();

export function formatMatchAnnouncement(event, match, { contestCount } = {}) {
  const teams = `${match.teamA} vs ${match.teamB}`;
  const competition = match.competition ? `\n${match.competition}` : "";
  const start = match.startTime ? `\n${new Date(match.startTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST` : "";
  const venue = match.venue ? `\n${match.venue}` : "";
  const id = String(match._id);

  if (event === "MATCH_STARTED") {
    return { key: `match:${id}:started`, text: `🏏 Match is live\n${teams}${competition}${venue}` };
  }
  if (event === "CONTESTS_AVAILABLE") {
    return { key: `match:${id}:contests-available`, text: `🎯 Contests are open\n${teams}${competition}${start}\n${contestCount || "Available"} contests are ready to join in CricketClash.` };
  }
  if (event === "VERIFIED_RESULT") {
    if (!match.result || match.pendingResultCorrection) return null;
    const result = match.result === "teamA" ? `${match.teamA} won` : match.result === "teamB" ? `${match.teamB} won` : match.result === "tie" ? "The match ended in a tie" : "The match ended with no result";
    return { key: `match:${id}:verified-result:${match.resultRevision || 0}`, text: `✅ Verified match result\n${teams}\n${result}${competition}` };
  }
  if (event === "UPCOMING_FIXTURE") {
    return { key: `match:${id}:fixture:${new Date(match.startTime).toISOString()}`, text: `📅 Upcoming fixture\n${teams}${competition}${start}${venue}` };
  }
  return null;
}

export async function announceMatchEvent(event, match, options) {
  const announcement = formatMatchAnnouncement(event, match, options);
  if (!announcement) return { sent: false, skipped: true };
  return sendTelegramNotification(announcement);
}
