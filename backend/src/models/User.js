
import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 24,
      match: /^[a-zA-Z0-9_.-]+$/,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    // Regular users are the default. Admins are created separately.
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      required: true,
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    otpHash: {
      type: String,
      select: false,
    },

    otpExpiresAt: {
      type: Date,
      select: false,
    },

    otpLastSentAt: {
      type: Date,
      select: false,
    },

    otpAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    otpBlockedUntil: {
      type: Date,
      select: false,
    },

    passwordResetOtpHash: {
      type: String,
      select: false,
    },

    passwordResetOtpExpiresAt: {
      type: Date,
      select: false,
    },

    passwordResetOtpLastSentAt: {
      type: Date,
      select: false,
    },

    passwordResetOtpAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    passwordResetOtpBlockedUntil: {
      type: Date,
      select: false,
    },

    passwordResetOtpSendWindowStartedAt: {
      type: Date,
      select: false,
    },

    passwordResetOtpSendCount: {
      type: Number,
      default: 0,
      select: false,
    },

    passwordResetTokenHash: {
      type: String,
      select: false,
    },

    passwordResetTokenExpiresAt: {
      type: Date,
      select: false,
    },

    adminPasswordResetOtpHash: { type: String, select: false },
    adminPasswordResetOtpExpiresAt: { type: Date, select: false },
    adminPasswordResetOtpLastSentAt: { type: Date, select: false },
    adminPasswordResetOtpAttempts: { type: Number, default: 0, select: false },
    adminPasswordResetOtpBlockedUntil: { type: Date, select: false },
    adminPasswordResetOtpSendWindowStartedAt: { type: Date, select: false },
    adminPasswordResetOtpSendCount: { type: Number, default: 0, select: false },

    authVersion: {
      type: Number,
      default: 0,
      select: false,
    },

    lastActivityAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const User =
  mongoose.models.User || mongoose.model("User", userSchema);

export default User;
