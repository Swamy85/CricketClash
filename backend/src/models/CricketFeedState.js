import mongoose from "mongoose";

const cricketFeedStateSchema = new mongoose.Schema({
  _id: { type: String, default: "shared-live-feed" },
  matches: { type: [mongoose.Schema.Types.Mixed], default: [] },
  lastAttemptAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  nextRefreshAt: { type: Date, default: null },
  lastOutcome: { type: String, default: "never" },
  requestCount: { type: Number, default: 0 },
  quotaDay: { type: String, default: "" },
  quotaCount: { type: Number, default: 0 },
  leaseUntil: { type: Date, default: null },
  leaseToken: { type: String, default: null },
}, { timestamps: true, versionKey: false });

export default mongoose.models.CricketFeedState || mongoose.model("CricketFeedState", cricketFeedStateSchema);
