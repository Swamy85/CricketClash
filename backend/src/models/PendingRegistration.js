import mongoose from "mongoose";

const pendingRegistrationSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, minlength: 3, maxlength: 24, match: /^[a-zA-Z0-9_.-]+$/ },
  usernameKey: { type: String, required: true, trim: true, lowercase: true, unique: true },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
  passwordHash: { type: String, required: true, select: false },
  otpHash: { type: String, select: false },
  otpExpiresAt: { type: Date, select: false },
  otpLastSentAt: { type: Date, select: false },
  otpAttempts: { type: Number, default: 0, select: false },
  otpBlockedUntil: { type: Date, select: false },
  verificationClaimId: { type: String, select: false },
  legacyUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", select: false },
}, { timestamps: true });

const PendingRegistration = mongoose.models.PendingRegistration
  || mongoose.model("PendingRegistration", pendingRegistrationSchema);

export default PendingRegistration;
