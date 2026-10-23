import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    authVersion: {
      type: Number,
      default: 0,
    },

    sessionType: {
      type: String,
      enum: ["player", "admin"],
      required: false,
    },

    lastActivityAt: {
      type: Date,
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    absoluteExpiresAt: {
      type: Date,
      required: false,
    },

    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

sessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

const LoginSession = mongoose.model(
  "LoginSession",
  sessionSchema
);

export default LoginSession;
