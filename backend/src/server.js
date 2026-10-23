import dotenv from "dotenv";
import mongoose from "mongoose";
import app from "./app.js";
import { startContestDeadlineProcessor } from "./modules/contests/contestDeadlineService.js";
import { retryDueAdminRequestNotifications } from "./services/adminRequestEmailService.js";
import { seedTeamCatalog } from "./services/teamCatalogSeed.js";
import { startCricketFeedScheduler } from "./services/cricketFeedService.js";

dotenv.config();

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from backend/.env");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB connected successfully.");
    await seedTeamCatalog();
    console.log("Cricket team catalog is ready.");
    startContestDeadlineProcessor();
    startCricketFeedScheduler();
    const retryEmails = () => {
      void retryDueAdminRequestNotifications().catch((error) => {
        console.error("Admin request email retry job failed.", {
          code: String(error?.code || "RETRY_JOB_FAILED").slice(0, 80),
        });
      });
    };
    retryEmails();
    const emailRetryTimer = setInterval(retryEmails, 60_000);
    emailRetryTimer.unref();

    app.listen(PORT, () => {
      console.log(
        `CricketClash API running on http://localhost:${PORT}`
      );

      console.log(
        `Health check: http://localhost:${PORT}/api/health`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start CricketClash:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
