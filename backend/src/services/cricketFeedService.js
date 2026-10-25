import crypto from "node:crypto";
import CricketFeedState from "../models/CricketFeedState.js";

const REFRESH_MS = 15 * 60 * 1000;
const MAX_DAILY_REQUESTS = 96;
const REQUEST_TIMEOUT_MS = 12_000;
const LEASE_MS = 30_000;

function parseProviderGMTDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  // CricAPI's dateTimeGMT commonly omits the trailing Z even though the
  // field is explicitly GMT. Parse that clock time as UTC on every server.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasZone ? text : `${text}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeProviderMatch(row) {
  if (!row || typeof row !== "object") return null;
  const teams = Array.isArray(row.teams) ? row.teams : [];
  const scores = Array.isArray(row.score) ? row.score : [];
  const teamA = String(row.t1 || teams[0] || "").trim();
  const teamB = String(row.t2 || teams[1] || "").trim();
  if (!row.id || !teamA || !teamB) return null;

  const providerStatus = String(row.ms || "").trim().toLowerCase();
  const description = String(row.status || "");
  const lowerDescription = description.toLowerCase();
  const looksFinished = /(won by|match over|completed|result|abandoned|cancelled|no result|draw|tied)/i.test(lowerDescription);
  const looksInProgress = /(in progress|live|innings|stumps|day \d+)/i.test(lowerDescription);
  const looksNotStarted = /(not started|upcoming|scheduled|fixture|starts at)/i.test(lowerDescription);
  const startsAt = parseProviderGMTDate(row.dateTimeGMT);
  const validStart = startsAt && Number.isFinite(startsAt.getTime());
  let category = "uncertain";
  if (providerStatus === "result" && !looksNotStarted && !looksInProgress) category = "completed";
  else if (providerStatus === "live" && !looksNotStarted && !looksFinished) category = "live";
  else if (["fixture", "upcoming"].includes(providerStatus) && validStart && startsAt > new Date() && !looksFinished && !looksInProgress) category = "upcoming";

  const scoreText = (value) => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (!value || typeof value !== "object") return null;
    const runs = value.r ?? value.runs;
    if (runs === undefined || runs === null) return null;
    const wickets = value.w ?? value.wickets;
    const overs = value.o ?? value.overs;
    return `${runs}${wickets === undefined ? "" : `/${wickets}`}${overs === undefined ? "" : ` (${overs})`}`;
  };
  const innings = Array.isArray(row.scorecard) ? row.scorecard.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const totals = entry.totals && typeof entry.totals === "object" ? entry.totals : {};
    return {
      innings: typeof entry.inning === "string" ? entry.inning : null,
      runs: totals.R ?? totals.runs ?? null,
      wickets: totals.W ?? totals.wickets ?? null,
      overs: totals.O ?? totals.overs ?? null,
      extras: entry.extras && typeof entry.extras === "object" ? entry.extras : null,
      batting: Array.isArray(entry.batting) ? entry.batting.map((player) => ({
        name: String(player?.batsman?.name || player?.name || "").trim(),
        runs: player?.r ?? null,
        balls: player?.b ?? null,
        fours: player?.["4s"] ?? null,
        sixes: player?.["6s"] ?? null,
        strikeRate: player?.sr ?? null,
        dismissal: player?.["dismissal-text"] || player?.dismissal || null,
      })).filter((player) => player.name) : [],
      bowling: Array.isArray(entry.bowling) ? entry.bowling.map((player) => ({
        name: String(player?.bowler?.name || player?.name || "").trim(),
        overs: player?.o ?? null,
        maidens: player?.m ?? null,
        runs: player?.r ?? null,
        wickets: player?.w ?? null,
        economy: player?.eco ?? null,
      })).filter((player) => player.name) : [],
    };
  }).filter(Boolean) : [];
  return {
    externalId: String(row.id), teamA, teamB,
    teamALogo: typeof row.t1img === "string" ? row.t1img : null,
    teamBLogo: typeof row.t2img === "string" ? row.t2img : null,
    scoreA: scoreText(row.t1s ?? scores[0]),
    scoreB: scoreText(row.t2s ?? scores[1]),
    scoreSummary: typeof row.score === "string" ? row.score : null,
    innings,
    format: String(row.matchType || "").toUpperCase() || null,
    series: String(row.series || row.name || "").trim() || null,
    venue: String(row.venue || row.venueName || row.ground || "").trim() || null,
    status: description || providerStatus || "Status unavailable",
    category,
    startTime: validStart ? startsAt.toISOString() : null,
  };
}

function utcDay(date) { return date.toISOString().slice(0, 10); }

export async function getCricketFeed() {
  const state = await CricketFeedState.findById("shared-live-feed").lean();
  return {
    matches: state?.matches || [],
    lastUpdatedAt: state?.lastSuccessAt || null,
    lastAttemptAt: state?.lastAttemptAt || null,
    nextRefreshAt: state?.nextRefreshAt || null,
    outcome: state?.lastOutcome || "never",
    requestCountToday: state?.quotaCount || 0,
  };
}

export async function refreshCricketFeed() {
  const key = process.env.CRICKET_API_KEY;
  if (!key || key === "PASTE_YOUR_ACTUAL_API_KEY_HERE") {
    return { refreshed: false, reason: "not-configured" };
  }
  const now = new Date();
  const today = utcDay(now);
  await CricketFeedState.updateOne({ _id: "shared-live-feed" }, { $setOnInsert: { _id: "shared-live-feed" } }, { upsert: true });
  const token = crypto.randomUUID();
  const state = await CricketFeedState.findOneAndUpdate(
    { _id: "shared-live-feed", $and: [
      { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
      { $or: [{ quotaDay: { $ne: today } }, { quotaCount: { $lt: MAX_DAILY_REQUESTS } }] },
      { $or: [{ lastAttemptAt: null }, { lastAttemptAt: { $lte: new Date(now.getTime() - REFRESH_MS) } }] },
      { $or: [{ lastSuccessAt: null }, { lastSuccessAt: { $lte: new Date(now.getTime() - REFRESH_MS) } }] },
    ] },
    [{ $set: {
      quotaCount: { $cond: [{ $eq: ["$quotaDay", today] }, { $add: [{ $ifNull: ["$quotaCount", 0] }, 1] }, 1] },
      quotaDay: today,
      requestCount: { $add: [{ $ifNull: ["$requestCount", 0] }, 1] },
      lastAttemptAt: now,
      nextRefreshAt: new Date(now.getTime() + REFRESH_MS),
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      leaseToken: token,
      lastOutcome: "requesting",
    } }],
    { new: true }
  );
  if (!state) return { refreshed: false, reason: "not-due-or-quota-guarded" };

  try {
    const url = new URL("https://api.cricapi.com/v1/cricScore");
    url.searchParams.set("apikey", key);
    url.searchParams.set("offset", "0");
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`provider-http-${response.status}`);
    const payload = await response.json();
    if (payload?.status !== "success" || !Array.isArray(payload.data)) throw new Error("provider-invalid-response");
    if (payload.data.length === 0 && state.matches.length > 0) throw new Error("provider-empty-response");
    const matches = [...new Map(payload.data.map(normalizeProviderMatch).filter(Boolean).map((match) => [match.externalId, match])).values()];
    if (payload.data.length > 0 && matches.length === 0) throw new Error("provider-data-unusable");
    await CricketFeedState.updateOne({ _id: "shared-live-feed", leaseToken: token }, { $set: {
      matches, lastSuccessAt: new Date(), lastOutcome: "success", nextRefreshAt: new Date(Date.now() + REFRESH_MS), leaseUntil: null, leaseToken: null,
    } });
    return { refreshed: true, count: matches.length };
  } catch (error) {
    const outcome = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : String(error?.message || "refresh-failed").startsWith("provider-http-429") ? "rate-limited" : "failed";
    console.warn("Cricket feed refresh failed; retaining cached data.", { outcome });
    await CricketFeedState.updateOne({ _id: "shared-live-feed", leaseToken: token }, { $set: {
      lastOutcome: outcome, nextRefreshAt: new Date(Date.now() + REFRESH_MS), leaseUntil: null, leaseToken: null,
    } });
    return { refreshed: false, reason: outcome };
  }
}

export function startCricketFeedScheduler() {
  const run = async () => {
    try { await refreshCricketFeed(); }
    catch (error) { console.warn("Cricket feed scheduler could not refresh.", { code: String(error?.code || "database-error").slice(0, 60) }); }
  };
  void run();
  const timer = setInterval(run, REFRESH_MS);
  timer.unref();
}
