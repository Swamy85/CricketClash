import crypto from "node:crypto";
import CricketFeedState from "../models/CricketFeedState.js";
import Match from "../models/Match.js";
import { enqueueTelegramNotification, formatMatchAnnouncement } from "./telegramNotificationService.js";
import { deriveProviderMatchOutcome } from "../modules/contests/contestOutcomeService.js";

const REFRESH_MS = 15 * 60 * 1000;
const MAX_DAILY_REQUESTS = 96;
const REQUEST_TIMEOUT_MS = 12_000;
const LEASE_MS = 120_000;

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
  const providerState = providerStatus;
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
    format: ["T10", "T20", "ODI", "TEST", "HUNDRED"].includes(String(row.matchType || "").toUpperCase()) ? String(row.matchType).toUpperCase() : "T20",
    series: String(row.series || row.name || "").trim() || null,
    venue: String(row.venue || row.venueName || row.ground || "").trim() || null,
    status: description || providerStatus || "Status unavailable",
    providerState,
    category,
    startTime: validStart ? startsAt.toISOString() : null,
  };
}

export async function synchronizeProviderMatches(matches, { MatchModel = Match, now = new Date(), enqueueNotification = enqueueTelegramNotification } = {}) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let notificationFailures = 0;
  for (const providerMatch of matches) {
    if (!providerMatch?.externalId || !providerMatch.teamA || !providerMatch.teamB) {
      skipped += 1;
      console.warn("CricAPI match row skipped: provider ID or team mapping is missing.", {
        hasProviderId: Boolean(providerMatch?.externalId), hasTeamA: Boolean(providerMatch?.teamA), hasTeamB: Boolean(providerMatch?.teamB),
      });
      continue;
    }
    const validStartTime = providerMatch.startTime && Number.isFinite(new Date(providerMatch.startTime).getTime())
      ? new Date(providerMatch.startTime) : null;
    const providerState = String(providerMatch.providerState || "").trim().toLowerCase();
    const providerFields = {
      providerStatus: String(providerMatch.status || "Status unavailable").slice(0, 200),
      providerState: providerState.slice(0, 30),
      providerTeamA: String(providerMatch.teamA || "").slice(0, 80),
      providerTeamB: String(providerMatch.teamB || "").slice(0, 80),
      providerScoreA: String(providerMatch.scoreA || "").slice(0, 80),
      providerScoreB: String(providerMatch.scoreB || "").slice(0, 80),
      providerScoreSummary: String(providerMatch.scoreSummary || "").slice(0, 500),
      providerVenue: String(providerMatch.venue || "").slice(0, 200),
      providerLastSyncedAt: now,
    };
    if (validStartTime) providerFields.providerStartTime = validStartTime;
    const coreFields = {
      competition: String(providerMatch.series || "Cricket").trim().slice(0, 100),
      title: `${providerMatch.teamA} vs ${providerMatch.teamB}`.slice(0, 140),
      teamA: providerMatch.teamA.slice(0, 80),
      teamB: providerMatch.teamB.slice(0, 80),
      format: providerMatch.format || "T20",
      ...(validStartTime ? { startTime: validStartTime } : {}),
    };
    try {
      const prior = await MatchModel.findOne({ providerId: providerMatch.externalId })
        .select("_id published providerAdminOverride providerSource providerStartTime providerTeamA providerTeamB teamA teamB competition format startTime venue status result")
        .lean();
      if (!prior && !validStartTime) {
        skipped += 1;
        console.warn("CricAPI match row not inserted: no valid start time for required Match field.", {
          hasProviderId: true, providerState,
        });
        continue;
      }

      // Provider state is independent of admin publication and team/schedule overrides.
      // Only a verified final outcome can move the app-facing match status to completed.
      let syncedStatus;
      const adminFinalized = prior && (prior.result != null || ["completed", "cancelled", "abandoned"].includes(prior.status));
      if (!adminFinalized && providerState === "live" && providerMatch.category === "live") syncedStatus = "live";
      if (!adminFinalized && providerState === "result") {
        const outcome = deriveProviderMatchOutcome({
          providerSource: "CRICAPI", providerState, providerStatus: providerMatch.status,
          providerTeamA: providerMatch.teamA, providerTeamB: providerMatch.teamB,
          teamA: prior?.teamA || providerMatch.teamA, teamB: prior?.teamB || providerMatch.teamB,
        });
        if (outcome && outcome.type !== "AMBIGUOUS") {
          syncedStatus = outcome.type === "ABANDONED" ? "abandoned" : "completed";
        }
      }
      if (!adminFinalized && providerState === "fixture") syncedStatus = "upcoming";
      if (!adminFinalized && providerState === "result" && /\b(cancelled|canceled)\b/i.test(String(providerMatch.status || ""))) syncedStatus = "cancelled";

      // Persist provider state before any Telegram enqueue. Notification failures must not
      // prevent the result/outcome worker from seeing this synchronization.
      const setFields = { ...providerFields, ...(prior && syncedStatus ? { status: syncedStatus } : {}) };
      const update = {
        $set: setFields,
        ...(!prior ? { $setOnInsert: { ...coreFields, status: syncedStatus || "upcoming", result: null, providerId: providerMatch.externalId, providerSource: "CRICAPI", providerAdminOverride: false, published: false, automaticContestGeneration: false, automaticContestTiers: [] } } : {}),
      };
      const result = await MatchModel.updateOne({ providerId: providerMatch.externalId }, update, { upsert: !prior, runValidators: true, setDefaultsOnInsert: false });
      if (prior) {
        updated += 1;
        if (!prior.providerAdminOverride && validStartTime) {
          await MatchModel.updateOne({ _id: prior._id, providerAdminOverride: { $ne: true } }, { $set: coreFields }, { runValidators: true });
        }
      } else if (result.upsertedCount === 1) inserted += 1;

      if (prior?.published === true) {
        const notificationMatch = {
          ...prior,
          providerStatus: providerMatch.status || "Status unavailable",
          providerScoreA: providerMatch.scoreA || "",
          providerScoreB: providerMatch.scoreB || "",
          providerScoreSummary: providerMatch.scoreSummary || "",
          providerTeamA: providerMatch.teamA || prior.providerTeamA || "",
          providerTeamB: providerMatch.teamB || prior.providerTeamB || "",
          startTime: validStartTime || prior.startTime,
          providerStartTime: validStartTime || prior.providerStartTime,
          providerVenue: providerMatch.venue || prior.venue || "",
          previousStartTime: prior.providerStartTime || prior.startTime || null,
        };
        for (const event of getProviderNotificationEvents(providerMatch, String(prior._id), prior.providerStartTime)) {
          const announcement = formatMatchAnnouncement(event.name, {
            ...notificationMatch,
            providerStatus: event.statusText || notificationMatch.providerStatus,
          }, { key: event.key });
          if (!announcement) continue;
          console.info("Published CricAPI match event detected.", { matchId: String(prior._id), event: event.name });
          try { await enqueueNotification(announcement); }
          catch (error) {
            notificationFailures += 1;
            console.warn("CricAPI Telegram event enqueue failed.", { matchId: String(prior._id), event: event.name, code: String(error?.code || "TELEGRAM_ENQUEUE_FAILED").slice(0, 80) });
          }
        }
      }
    } catch (error) {
      if (error?.code !== 11000) throw error;
      // A concurrent sync may have inserted the same provider ID after our read.
      const raced = await MatchModel.findOne({ providerId: providerMatch.externalId }).select("_id providerAdminOverride published").lean();
      if (!raced) throw error;
      await MatchModel.updateOne({ _id: raced._id }, { $set: { ...providerFields, ...(raced.providerAdminOverride ? {} : coreFields) } }, { runValidators: true });
      updated += 1;
    }
  }
  console.info("CricAPI matches synchronized.", { received: matches.length, inserted, updated, skipped, notificationFailures });
  return { inserted, updated };
}

export function getProviderNotificationEvents(providerMatch, matchId, previousStartTime = null) {
  const events = [];
  const status = String(providerMatch?.status || "").trim();
  const lower = status.toLowerCase();
  const providerState = String(providerMatch?.providerState || providerMatch?.ms || "").trim().toLowerCase();
  const notFinal = /\b(stumps|day\s*\d+|innings?\s*break|in progress|live|abandoned|cancelled|canceled|postponed|no result|no-result|draw|tied)\b/i.test(status);
  if (providerState === "live" && !/\b(won by|match over|completed|abandoned|cancelled|canceled|no result|no-result|draw|tied)\b/i.test(status)) {
    events.push({ name: "MATCH_STARTED", key: `match:${matchId}:started` });
  }
  if (providerState === "result" && providerMatch.category === "completed" && !notFinal) {
    events.push({ name: "PROVIDER_FINAL_RESULT", key: `match:${matchId}:provider-final-result` });
  }
  if (/\b(stumps|postponed|abandoned|cancelled|canceled|delayed|delay|rain|no result|no-result)\b/i.test(lower)) {
    const fingerprint = crypto.createHash("sha256").update(lower.replace(/\s+/g, " ")).digest("hex").slice(0, 16);
    events.push({ name: "PROVIDER_MATCH_STATUS", key: `match:${matchId}:provider-status:${fingerprint}` });
  }
  const previousStart = previousStartTime ? new Date(previousStartTime).getTime() : NaN;
  const currentStart = providerMatch?.startTime ? new Date(providerMatch.startTime).getTime() : NaN;
  if (Number.isFinite(previousStart) && Number.isFinite(currentStart) && previousStart !== currentStart) {
    const fingerprint = crypto.createHash("sha256").update(`${previousStart}:${currentStart}`).digest("hex").slice(0, 16);
    events.push({ name: "PROVIDER_MATCH_STATUS", key: `match:${matchId}:provider-schedule:${fingerprint}`, statusText: "Match rescheduled - provider schedule updated" });
  }
  return events;
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
    const sync = await synchronizeProviderMatches(matches);
    await CricketFeedState.updateOne({ _id: "shared-live-feed", leaseToken: token }, { $set: {
      matches, lastSuccessAt: new Date(), lastOutcome: "success", nextRefreshAt: new Date(Date.now() + REFRESH_MS), leaseUntil: null, leaseToken: null,
    } });
    return { refreshed: true, count: matches.length, ...sync };
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
  console.info("CricAPI match synchronization scheduler started.", { intervalMs: REFRESH_MS });
  const run = async () => {
    try {
      const result = await refreshCricketFeed();
      if (result.refreshed) console.info("CricAPI scheduled synchronization completed.", { matches: result.count, inserted: result.inserted, updated: result.updated });
      else console.info("CricAPI scheduled synchronization skipped.", { reason: result.reason });
    }
    catch (error) { console.warn("Cricket feed scheduler could not refresh.", { code: String(error?.code || "database-error").slice(0, 60) }); }
  };
  void run();
  const timer = setInterval(run, REFRESH_MS);
  timer.unref();
  return () => clearInterval(timer);
}
