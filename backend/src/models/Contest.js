
import mongoose from "mongoose";

const { Schema } = mongoose;

// Each contest has a maximum of two players.
const contestPlayerSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Client generated request key; makes retries resolve to this same entry.
    joinRequestId: {
      type: String,
      trim: true,
      maxlength: 100,
      default: undefined,
    },

    // A = Match.teamA, B = Match.teamB
    selectedTeam: {
      type: String,
      enum: ["A", "B"],
      required: true,
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },

    // Payment state for the player's contest entry.
    entryPaymentStatus: {
      type: String,
      enum: ["NOT_REQUIRED", "PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "NOT_REQUIRED",
      required: true,
    },

    // Refund state for the player's entry fee.
    refundStatus: {
      type: String,
      enum: [
        "NOT_REQUIRED",
        "PENDING",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
      ],
      default: "NOT_REQUIRED",
      required: true,
    },

    refundedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const contestSchema = new Schema(
  {
    // Existing cricket match.
    match: {
      type: Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },

    // Separate matchmaking queue for each tier.
    tier: {
      type: String,
      enum: [
        "FREE",
        "BRONZE",
        "SILVER",
        "GOLD",
        "PLATINUM",
        "DIAMOND",
        "ELITE",
        "CHAMPION",
      ],
      required: true,
      default: "FREE",
    },

    name: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
    },

    creationMethod: {
      type: String,
      enum: ["AUTOMATIC", "MANUAL"],
      default: "MANUAL",
      required: true,
      index: true,
    },

    // Entry fee per player. Amounts are configuration values.
    entryFee: {
      type: Number,
      required: true,
      min: 0,
    },

    // Total configured prize pool for two players.
    prizePool: {
      type: Number,
      required: true,
      min: 0,
    },

    platformFeePercentage: {
      type: Number,
      required: true,
      default: 10,
      min: 0,
      max: 100,
    },

    // Calculated settlement values.
    platformFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    winnerPayout: {
      type: Number,
      default: 0,
      min: 0,
    },

    players: {
      type: [contestPlayerSchema],
      default: [],

      validate: [
        {
          validator(players) {
            return Array.isArray(players) && players.length <= 2;
          },
          message: "A contest cannot contain more than two players.",
        },
        {
          validator(players) {
            if (!Array.isArray(players)) return false;

            const userIds = players.map((player) => String(player.user));
            return new Set(userIds).size === userIds.length;
          },
          message: "A user cannot join the same contest twice.",
        },
        {
          validator(players) {
            if (!Array.isArray(players) || players.length < 2) {
              return true;
            }

            return players[0].selectedTeam !== players[1].selectedTeam;
          },
          message: "Players must select opposing teams.",
        },
      ],
    },

    status: {
      type: String,
      enum: [
        "OPEN",
        "WAITING",
        "FULL",
        "LOCKED",
        "COMPLETED",
        "CANCELLED",
        "REFUNDED",
      ],
      default: "OPEN",
      required: true,
    },

    // Derived from Match.startTime by the contest service.
    expiresAt: {
      type: Date,
      required: true,
    },

    lockedAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      enum: [
        "MATCH_STARTED",
        "MATCH_CANCELLED",
        "MATCH_NO_RESULT",
        "MATCH_ABANDONED",
        "NO_OPPONENT",
        "ADMIN_CANCELLED",
        null,
      ],
      default: null,
    },

    winnerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    settlementStatus: {
      type: String,
      enum: [
        "NOT_READY",
        "PENDING",
        "SETTLED",
        "REFUND_REQUIRED",
        "REFUND_PROCESSING",
        "REFUNDED",
        "FAILED",
      ],
      default: "NOT_READY",
      required: true,
    },

    settledAt: {
      type: Date,
      default: null,
    },

    settlementRevision: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Admin who created/configured this contest.
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Tracks the replacement contest created after this contest fills.
    // Prevents multiple replacement contests being linked to one contest.
    replacementContestId: {
      type: Schema.Types.ObjectId,
      ref: "Contest",
      default: null,
    },

    activeQueueKey: {
      type: String,
      default: undefined,
    },
  },
  { timestamps: true }
);

// Matchmaking queries: same match, tier and joinable status.
contestSchema.index({
  match: 1,
  tier: 1,
  status: 1,
  expiresAt: 1,
});

contestSchema.index(
  { activeQueueKey: 1 },
  {
    unique: true,
    partialFilterExpression: { activeQueueKey: { $type: "string" } },
  }
);

contestSchema.index({ status: 1, expiresAt: 1 });
contestSchema.index({ status: 1, settlementStatus: 1 });
contestSchema.index({ "players.user": 1, createdAt: -1 });
contestSchema.index(
  { "players.joinRequestId": 1 },
  {
    unique: true,
    partialFilterExpression: { "players.joinRequestId": { $type: "string" } },
  }
);

// Find contests in creation order for a matchmaking queue.
contestSchema.index({
  match: 1,
  tier: 1,
  createdAt: 1,
});

// Reuse the model during development without OverwriteModelError.
const Contest =
  mongoose.models.Contest ||
  mongoose.model("Contest", contestSchema);

export default Contest;
