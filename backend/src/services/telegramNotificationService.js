import TelegramAnnouncement from "../models/TelegramAnnouncement.js";
import Match from "../models/Match.js";

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
  if (!["FAILED", "PENDING"].includes(existing.status)) return { claimed: false, duplicate: true };
  if (existing.nextAttemptAt && new Date(existing.nextAttemptAt) > new Date()) return { claimed: false, duplicate: true };
  console.info("Retrying queued Telegram notification.", { key });

  const retry = await AnnouncementModel.findOneAndUpdate(
    { key, status: existing.status, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }] },
    { $set: { status: "PROCESSING", errorCode: null, nextAttemptAt: null } },
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
        body: JSON.stringify({ chat_id: chatId, text: normalizedText, parse_mode: "HTML" }),
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
        { $set: {
          status: "FAILED",
          errorCode: code,
          nextAttemptAt: new Date(Date.now() + Math.max(60, Number(payload?.parameters?.retry_after) || 60) * 1000),
        } }
      );
      console.warn("Telegram API rejected notification.", { key: normalizedKey, code });
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
          nextAttemptAt: null,
        },
      }
    );
    console.info("Telegram notification sent.", { key: normalizedKey });
    return { sent: true, duplicate: false };
  };
}

export const sendTelegramNotification = createTelegramNotificationService();

export async function enqueueTelegramNotification({ key, text, AnnouncementModel = TelegramAnnouncement, send = sendTelegramNotification }) {
  const record = { key, text, status: "PENDING", errorCode: "QUEUED", nextAttemptAt: null };
  try {
    await AnnouncementModel.updateOne({ key }, { $setOnInsert: record }, { upsert: true });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return send({ key, text });
}

export async function retryDueMatchTelegramNotifications({ AnnouncementModel = TelegramAnnouncement, MatchModel = Match, send = sendTelegramNotification, now = new Date(), limit = 100 } = {}) {
  const due = await AnnouncementModel.find({
    key: /^match:/,
    status: { $in: ["PENDING", "FAILED"] },
    $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
  }).select("key text").sort({ createdAt: 1 }).limit(limit).lean();
  const matchIds = [...new Set(due.map((row) => String(row.key).split(":")[1]).filter(Boolean))];
  const publishedMatches = await MatchModel.find({ _id: { $in: matchIds }, published: true }).select("_id").lean();
  const publishedIds = new Set(publishedMatches.map((match) => String(match._id)));
  const eligible = due.filter((row) => publishedIds.has(String(row.key).split(":")[1]));
  for (const row of eligible) {
    try { await send({ key: row.key, text: row.text }); }
    catch (error) {
      console.warn("Queued Telegram match notification retry failed.", { key: row.key, code: String(error?.code || "TELEGRAM_DELIVERY_FAILED").slice(0, 80) });
    }
  }
  return eligible.length;
}

const BRAND_FOOTER = "🏏 <b>CRICKETCLASH</b> • <i>OFFICIAL MATCH UPDATES</i>";
const SEPARATOR = "━━━━━━━━━━━━━━━━━━";

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

const TEAM_FLAGS = new Map([
  ["afghanistan", "🇦🇫"], ["australia", "🇦🇺"], ["bangladesh", "🇧🇩"], ["england", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
  ["india", "🇮🇳"], ["ireland", "🇮🇪"], ["new zealand", "🇳🇿"], ["pakistan", "🇵🇰"], ["south africa", "🇿🇦"],
  ["sri lanka", "🇱🇰"], ["west indies", "🌴"], ["zimbabwe", "🇿🇼"], ["united arab emirates", "🇦🇪"],
]);

function teamFlag(team) { return TEAM_FLAGS.get(String(team || "").toLowerCase()) || ""; }

function formatIstDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  })} IST`;
}

function announcementKey(match, suffix, eventKey) {
  if (eventKey) return eventKey;
  const id = cleanText(match?._id, 180) || "unknown";
  return `match:${id}:${suffix}`;
}

function renderAnnouncement({ heading, emoji = "📢", match, status, extra = [], scores = false, winner = "", result = false }) {
  const teamA = cleanText(match?.teamA || match?.providerTeamA, 100);
  const teamB = cleanText(match?.teamB || match?.providerTeamB, 100);
  const teams = [teamA, teamB].filter(Boolean);
  const teamLine = teams.length ? `${teamFlag(teamA)} <b>${escapeHtml(teams.join(" vs "))}</b> ${teamFlag(teamB)}`.trim() : "";
  const competition = cleanText(match?.competition, 180);
  const venue = cleanText(match?.venue || match?.providerVenue, 180);
  const date = formatIstDate(match?.startTime || match?.providerStartTime);
  const format = cleanText(match?.format, 40);
  const lines = [`${emoji} <b>CRICKETCLASH | ${escapeHtml(heading)}</b>`, SEPARATOR];
  if (teamLine) lines.push(`🏏 ${teamLine}`);
  const details = [competition, format].filter(Boolean).map(escapeHtml);
  if (details.length) lines.push(`🏆 ${details.join(" · ")}`);
  if (date) lines.push(`📅 ${escapeHtml(date)}`);
  if (venue) lines.push(`📍 ${escapeHtml(venue)}`);
  if (status) lines.push(`${emoji} <b>${escapeHtml(cleanText(status, 240))}</b>`);
  if (scores) {
    const scoreA = cleanText(match?.providerScoreA, 80);
    const scoreB = cleanText(match?.providerScoreB, 80);
    if (scoreA || scoreB) {
      lines.push(`📊 <b>${result ? "FINAL SCORE" : "LIVE SCORE"}</b>`);
      if (scoreA) lines.push(`${teamFlag(teamA)} ${escapeHtml(teamA || "Team A")}: <b>${escapeHtml(scoreA)}</b>`);
      if (scoreB) lines.push(`${teamFlag(teamB)} ${escapeHtml(teamB || "Team B")}: <b>${escapeHtml(scoreB)}</b>`);
    }
    const situation = cleanText(match?.providerScoreSummary, 300);
    if (situation) lines.push(`📝 Match situation: ${escapeHtml(situation)}`);
  }
  if (winner) lines.push(`🥇 <b>WINNER: ${escapeHtml(cleanText(winner, 120))}</b>`);
  if (result) lines.push("✅ <b>RESULT VERIFIED</b>");
  for (const item of extra) if (item) lines.push(escapeHtml(cleanText(item, 240)));
  lines.push(SEPARATOR, BRAND_FOOTER);
  const text = lines.join("\n");
  return text.length <= MAX_MESSAGE_LENGTH ? text : `${text.slice(0, MAX_MESSAGE_LENGTH - BRAND_FOOTER.length - SEPARATOR.length - 2).trimEnd()}\n${SEPARATOR}\n${BRAND_FOOTER}`;
}

function confirmedProviderWinner(status, match) {
  const lower = cleanText(status, 240).toLowerCase();
  const teamA = cleanText(match?.teamA || match?.providerTeamA, 100);
  const teamB = cleanText(match?.teamB || match?.providerTeamB, 100);
  return [teamA, teamB].find((team) => team &&
    (lower.includes(`${team.toLowerCase()} won`) || lower.includes(`${team.toLowerCase()} wins`))) || "";
}

export function formatMatchAnnouncement(event, match, { contestCount, key: eventKey } = {}) {
  if (!match || typeof match !== "object") return null;
  const startTime = match.startTime || match.providerStartTime;
  const start = formatIstDate(startTime);
  const startKey = startTime && Number.isFinite(new Date(startTime).getTime())
    ? new Date(startTime).toISOString()
    : "unknown-time";

  if (event === "MATCH_STARTED") {
    return { key: announcementKey(match, "started", eventKey), text: renderAnnouncement({ heading: "LIVE MATCH CENTER", emoji: "🔴", match, status: "MATCH IS LIVE", scores: true }) };
  }
  if (event === "CONTESTS_AVAILABLE") {
    const count = Number(contestCount);
    const label = Number.isFinite(count) && count > 0 ? count : "Available";
    return { key: announcementKey(match, "contests-available", eventKey), text: renderAnnouncement({ heading: "CONTESTS OPEN", match, status: "Entries are open", extra: [`${label} contests are ready to join.`] }) };
  }
  if (event === "VERIFIED_RESULT") {
    if (!match.result || match.pendingResultCorrection) return null;
    const winner = match.result === "teamA" ? cleanText(match.teamA, 100) : match.result === "teamB" ? cleanText(match.teamB, 100) : "";
    const status = match.result === "tie" ? "Match tied" : match.result === "no_result" ? "No result" : match.result === "abandoned" ? "Match abandoned" : match.result === "cancelled" ? "Match cancelled" : "Final result confirmed";
    return { key: announcementKey(match, `verified-result:${match.resultRevision || 0}`, eventKey), text: renderAnnouncement({ heading: "OFFICIAL MATCH RESULT", emoji: "🏆", match, status, winner, scores: true, result: true }) };
  }
  if (event === "UPCOMING_REMINDER") {
    return { key: announcementKey(match, `starting-soon:${startKey}`, eventKey), text: renderAnnouncement({ heading: "MATCH ALERT", emoji: "⏰", match, status: "MATCH STARTING SOON" }) };
  }
  if (event === "MATCH_RESCHEDULED") {
    const previous = formatIstDate(match.previousStartTime);
    const extra = [];
    if (previous) extra.push(`Previous schedule: ${previous}`);
    if (start) extra.push(`Updated schedule: ${start}`);
    return { key: announcementKey(match, `rescheduled:${startKey}`, eventKey), text: renderAnnouncement({ heading: "MATCH RESCHEDULED", emoji: "🔄", match, status: "Match rescheduled", extra }) };
  }
  if (event === "MATCH_STATUS") {
    const status = match.status === "cancelled" ? "Match cancelled" : match.status === "abandoned" ? "Match abandoned" : cleanText(match.status, 60) || "Status updated";
    const updated = new Date(match.updatedAt || match.createdAt || 0);
    const stamp = Number.isFinite(updated.getTime()) ? updated.toISOString() : "unknown-time";
    const emoji = match.status === "cancelled" ? "❌" : match.status === "abandoned" ? "⚠️" : "📢";
    return { key: announcementKey(match, `status:${match.status || "updated"}:${stamp}`, eventKey), text: renderAnnouncement({ heading: "MATCH STATUS", emoji, match, status }) };
  }
  if (event === "PROVIDER_MATCH_STATUS") {
    const status = cleanText(match.providerStatus, 240) || "Status update received from match provider";
    const scheduleChanged = /schedule (?:has been )?updated|rescheduled/i.test(status);
    const extra = scheduleChanged ? [
      formatIstDate(match.previousStartTime) ? `Previous schedule: ${formatIstDate(match.previousStartTime)}` : "",
      formatIstDate(match.startTime || match.providerStartTime) ? `Updated schedule: ${formatIstDate(match.startTime || match.providerStartTime)}` : "",
    ] : [];
    const emoji = /stumps|end of day/i.test(status) ? "🌙" : /delay|interrupt/i.test(status) ? "⏸️" : /weather|rain/i.test(status) ? "🌧️" : /reschedul/i.test(status) ? "🔄" : /live|in progress/i.test(status) ? "🔴" : "📢";
    return { key: announcementKey(match, "provider-status", eventKey), text: renderAnnouncement({ heading: "OFFICIAL MATCH STATUS", emoji, match, status, scores: true, extra }) };
  }
  if (event === "PROVIDER_FINAL_RESULT") {
    const providerStatus = cleanText(match.providerStatus, 240) || "Final result confirmed by match provider";
    return { key: announcementKey(match, "provider-final-result", eventKey), text: renderAnnouncement({ heading: "OFFICIAL MATCH RESULT", emoji: "🏆", match, status: providerStatus, scores: true, winner: confirmedProviderWinner(providerStatus, match), result: true }) };
  }
  if (event === "UPCOMING_FIXTURE") {
    return { key: announcementKey(match, `fixture:${startKey}`, eventKey), text: renderAnnouncement({ heading: "UPCOMING FIXTURE", match, status: "Scheduled" }) };
  }
  return null;
}
export async function announceMatchEvent(event, match, options) {
  if (match?.published !== true) return { sent: false, skipped: true, reason: "match-unpublished" };
  const announcement = formatMatchAnnouncement(event, match, options);
  if (!announcement) return { sent: false, skipped: true };
  return sendTelegramNotification(announcement);
}
