import Match from "../models/Match.js";
import TelegramAnnouncement from "../models/TelegramAnnouncement.js";
import { announceMatchEvent, retryDueMatchTelegramNotifications } from "./telegramNotificationService.js";
import { closeDueContestEntries } from "../modules/contests/contestEntryClosureService.js";
import { processProviderContestOutcomes } from "../modules/contests/contestOutcomeService.js";
import { settleProviderContestOutcomes } from "../modules/contests/providerContestSettlementService.js";
import { processAutomaticContestRefunds } from "../modules/contests/automaticContestRefundService.js";

const CHECK_INTERVAL_MS = Math.max(15_000, Number(process.env.MATCH_NOTIFICATION_INTERVAL_MS) || 60_000);
const UPCOMING_LEAD_MS = Math.max(0, Number(process.env.MATCH_NOTIFICATION_LEAD_MINUTES ?? 60)) * 60_000;

function statusEventKey(match) {
  return `match:${match._id}:status:${match.status}:${new Date(match.updatedAt || match.createdAt || 0).toISOString()}`;
}

export function getMatchNotificationEvents(match, now = new Date(), leadMs = UPCOMING_LEAD_MS) {
  if (match.published !== true) return [];
  const events = [];
  const start = match.startTime ? new Date(match.startTime).getTime() : NaN;
  if (match.status === "upcoming" && Number.isFinite(start) && start >= now.getTime() && start - now.getTime() <= leadMs) {
    events.push({ name: "UPCOMING_REMINDER", key: `match:${match._id}:starting-soon:${new Date(start).toISOString()}` });
  }
  if (match.status === "upcoming" && match.previousStartTime && Number.isFinite(start)) {
    events.push({ name: "MATCH_RESCHEDULED", key: `match:${match._id}:rescheduled:${new Date(start).toISOString()}` });
  }
  if (match.status === "live") events.push({ name: "MATCH_STARTED", key: `match:${match._id}:started` });
  if (match.status === "completed" && match.result && !match.pendingResultCorrection) {
    events.push({ name: "VERIFIED_RESULT", key: `match:${match._id}:verified-result:${match.resultRevision || 0}` });
  }
  if (["cancelled", "abandoned"].includes(match.status)) {
    events.push({ name: "MATCH_STATUS", key: statusEventKey(match) });
  }
  return events;
}

export async function processMatchNotifications({ MatchModel = Match, now = new Date(), announce = announceMatchEvent, announcementModel = TelegramAnnouncement, closeEntries = closeDueContestEntries, processOutcomes = processProviderContestOutcomes, settleOutcomes = settleProviderContestOutcomes, processRefunds = processAutomaticContestRefunds, retryQueued = retryDueMatchTelegramNotifications } = {}) {
  await closeEntries({ now }).catch((error) => {
    console.warn("Contest entry closure check failed.", { code: String(error?.code || "CONTEST_ENTRY_CLOSURE_FAILED").slice(0, 80) });
  });
  await processOutcomes({ now }).catch((error) => {
    console.warn("Provider contest outcome check failed.", { code: String(error?.code || "CONTEST_OUTCOME_FAILED").slice(0, 80) });
  });
  await settleOutcomes({ now }).catch((error) => {
    console.warn("Provider contest settlement check failed; it will be retried on a later worker check.", {
      code: String(error?.code || "CONTEST_SETTLEMENT_FAILED").slice(0, 80),
    });
  });
  await processRefunds({ now }).catch((error) => {
    console.warn("Automatic contest refund check failed; it will be retried on a later worker check.", {
      code: String(error?.code || "CONTEST_REFUND_FAILED").slice(0, 80),
    });
  });
  const matches = await MatchModel.find({
    published: true,
    $or: [
      { status: { $in: ["live", "completed", "cancelled", "abandoned"] } },
      { status: "upcoming", $or: [
        { startTime: { $gte: now, $lte: new Date(now.getTime() + UPCOMING_LEAD_MS) } },
        { previousStartTime: { $ne: null } },
      ] },
    ],
  })
    .select("_id published competition teamA teamB status result resultRevision pendingResultCorrection startTime previousStartTime venue updatedAt createdAt")
    .lean();
  console.info("Match notification check started.", { matches: matches.length });
  let detected = 0;
  for (const match of matches) {
    // Keep a second guard even though the database query filters publication;
    // this also protects injected/test models and stale query adapters.
    if (match.published !== true) continue;
    for (const event of getMatchNotificationEvents(match, now)) {
      // A key already recorded as SENT, PROCESSING, or UNKNOWN needs no work.
      // FAILED is eligible for retry through the sender's atomic reservation.
      const prior = await announcementModel.findOne({ key: event.key }).select("status").lean();
      if (prior && prior.status !== "FAILED") continue;
      detected += 1;
      console.info("Match notification event detected.", { matchId: String(match._id), event: event.name });
      try {
        const result = await announce(event.name, match, { key: event.key });
        console.info("Match notification delivery complete.", { matchId: String(match._id), event: event.name, sent: result?.sent === true, duplicate: result?.duplicate === true });
      } catch (error) {
        console.warn("Match notification delivery failed; it will be retried on a later check when safe.", {
          matchId: String(match._id), event: event.name, code: String(error?.code || "TELEGRAM_DELIVERY_FAILED").slice(0, 80),
        });
      }
    }
  }
  await retryQueued({ MatchModel }).catch((error) => {
    console.warn("Queued Telegram match notification scan failed.", { code: String(error?.code || "TELEGRAM_RETRY_SCAN_FAILED").slice(0, 80) });
  });
  console.info("Match notification check finished.", { matches: matches.length, detected });
  return { matches: matches.length, detected };
}

export function startMatchTelegramScheduler() {
  console.info("Match Telegram scheduler started.", { intervalMs: CHECK_INTERVAL_MS, upcomingLeadMinutes: UPCOMING_LEAD_MS / 60_000 });
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await processMatchNotifications(); }
    catch (error) { console.error("Match notification scheduler check failed.", { code: String(error?.code || "SCHEDULER_CHECK_FAILED").slice(0, 80) }); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(run, CHECK_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
