import "dotenv/config";
import mongoose from "mongoose";
import { startMatchTelegramScheduler } from "./services/matchTelegramScheduler.js";
import { startCricketFeedScheduler } from "./services/cricketFeedService.js";
import Match from "./models/Match.js";
import Contest from "./models/Contest.js";
import Wallet from "./models/Wallet.js";
import WalletTransaction from "./models/WalletTransaction.js";
import PlatformLedgerEntry from "./models/PlatformLedgerEntry.js";
import Notification from "./models/Notification.js";
import { migrateContestQueueIndex } from "./services/contestQueueIndexService.js";

let stopScheduler;
let stopCricketFeedScheduler;
let stopping = false;

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.info("Match notification worker shutting down.", { signal });
  stopScheduler?.();
  stopCricketFeedScheduler?.();
  await mongoose.disconnect();
  process.exit(0);
}

async function start() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required for the match notification worker.");
  await mongoose.connect(process.env.MONGODB_URI);
  await Match.createIndexes();
  const queueIndexMigration = await migrateContestQueueIndex(Contest);
  await Contest.createIndexes();
  await Wallet.createIndexes();
  await WalletTransaction.createIndexes();
  await PlatformLedgerEntry.createIndexes();
  await Notification.createIndexes();
  const { default: TelegramAnnouncement } = await import("./models/TelegramAnnouncement.js");
  await TelegramAnnouncement.createIndexes();
  console.info("Match notification worker connected to MongoDB.");
  console.info("Contest queue index initialization complete.", queueIndexMigration);
  console.info("Match worker integrations configured.", {
    cricketApiKeyPresent: Boolean(process.env.CRICKET_API_KEY),
    telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  });
  stopScheduler = startMatchTelegramScheduler();
  stopCricketFeedScheduler = startCricketFeedScheduler();
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

start().catch(async (error) => {
  console.error("Match notification worker failed to start:", error);

  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
