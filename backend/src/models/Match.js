import mongoose from "mongoose";

const matchSchema = new mongoose.Schema(
  {
    competition: {
      type: String,
      trim: true,
      maxlength: 100,
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
  },
  {
    timestamps: true,
  }
);

matchSchema.index({ status: 1, startTime: 1 });

const Match = mongoose.model("Match", matchSchema);

export default Match;