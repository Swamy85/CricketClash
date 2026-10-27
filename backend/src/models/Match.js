import mongoose from "mongoose";

const CONTEST_TIERS = ["FREE", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "ELITE", "CHAMPION"];

const matchSchema = new mongoose.Schema(
  {
    competition: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    title: {
      type: String,
      trim: true,
      maxlength: 140,
      default: "",
    },

    imageUrl: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    creationRequestId: {
      type: String,
      trim: true,
      maxlength: 100,
      default: undefined,
    },

    providerId: { type: String, trim: true, maxlength: 100, default: null },
    providerSource: { type: String, enum: ["CRICAPI", "MANUAL"], default: "MANUAL" },
    providerStatus: { type: String, trim: true, maxlength: 200, default: "" },
    providerState: { type: String, trim: true, maxlength: 30, default: "" },
    providerTeamA: { type: String, trim: true, maxlength: 80, default: "" },
    providerTeamB: { type: String, trim: true, maxlength: 80, default: "" },
    providerScoreA: { type: String, trim: true, maxlength: 80, default: "" },
    providerScoreB: { type: String, trim: true, maxlength: 80, default: "" },
    providerScoreSummary: { type: String, trim: true, maxlength: 500, default: "" },
    providerVenue: { type: String, trim: true, maxlength: 200, default: "" },
    providerStartTime: { type: Date, default: null },
    providerLastSyncedAt: { type: Date, default: null },
    providerAdminOverride: { type: Boolean, default: false },
    published: { type: Boolean, default: true },

    automaticContestGeneration: {
      type: Boolean,
      default: true,
    },

    automaticContestTiers: {
      type: [{ type: String, enum: CONTEST_TIERS }],
      default: () => [...CONTEST_TIERS],
      validate: {
        validator: (tiers) => Array.isArray(tiers) && new Set(tiers).size === tiers.length,
        message: "Automatic contest templates must be unique.",
      },
    },

    teamA: {
      type: String,
      required: true,
      trim: true,
    },

    teamB: {
      type: String,
      required: true,
      trim: true,
    },

    format: {
      type: String,
      enum: ["T10", "T20", "ODI", "TEST", "HUNDRED"],
      default: "T20",
    },

    status: {
      type: String,
      enum: ["upcoming", "live", "completed", "cancelled", "abandoned"],
      default: "upcoming",
    },

    result: {
      type: String,
      enum: ["teamA", "teamB", "tie", "no_result", "abandoned", "cancelled", null],
      default: null,
    },

    resultRevision: {
      type: Number,
      default: 0,
      min: 0,
    },

    pendingResultCorrection: {
      type: new mongoose.Schema(
        {
          result: {
            type: String,
            enum: ["teamA", "teamB", "tie", "no_result"],
            required: true,
          },
          reason: { type: String, required: true, maxlength: 500 },
          reference: { type: String, required: true, maxlength: 120 },
          admin: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
          revision: { type: Number, required: true },
          startedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    startTime: {
      type: Date,
      required: true,
    },

    // Retained so the notification worker can announce a confirmed reschedule.
    previousStartTime: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

matchSchema.index({ status: 1, startTime: 1 });
matchSchema.index({ providerId: 1 }, { unique: true, partialFilterExpression: { providerId: { $type: "string" } } });
matchSchema.index(
  { creationRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { creationRequestId: { $type: "string" } },
  }
);

const Match = mongoose.model("Match", matchSchema);

export default Match;
