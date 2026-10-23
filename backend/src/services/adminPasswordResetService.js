import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const OTP_TTL_MS = 5 * 60 * 1000;
const SEND_COOLDOWN_MS = 60 * 1000;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_OTP_ATTEMPTS = 5;
const OTP_BLOCK_MS = 15 * 60 * 1000;
const GENERIC_REQUEST_MESSAGE =
  "If an eligible account exists, password reset instructions will be sent.";
const INVALID_OTP_MESSAGE = "Invalid or expired code. Request a new code and try again.";

export function isStrongPassword(password) {
  return typeof password === "string" &&
    Buffer.byteLength(password, "utf8") >= 8 &&
    Buffer.byteLength(password, "utf8") <= 72 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);
}

export function createAdminPasswordResetService({
  User,
  LoginSession,
  sendOtpEmail,
  otpHashKey,
  hashPassword = (password) => bcrypt.hash(password, 12),
  makeOtp = () => crypto.randomInt(100000, 1000000).toString(),
  now = () => new Date(),
}) {
  const hashOtp = (otp) => crypto.createHmac("sha256", otpHashKey).update(otp).digest("hex");
  const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
  const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  async function requestReset(rawEmail) {
    const email = normalizeEmail(rawEmail);
    if (!validEmail(email)) return { message: GENERIC_REQUEST_MESSAGE };
    const user = await User.findOne({ email, role: "admin", isEmailVerified: true })
      .select("+adminPasswordResetOtpLastSentAt +adminPasswordResetOtpBlockedUntil +adminPasswordResetOtpSendWindowStartedAt +adminPasswordResetOtpSendCount");
    if (!user) return { message: GENERIC_REQUEST_MESSAGE };

    const currentTime = now();
    const windowCutoff = new Date(currentTime.getTime() - SEND_WINDOW_MS);
    const cooldownCutoff = new Date(currentTime.getTime() - SEND_COOLDOWN_MS);
    const inWindow = user.adminPasswordResetOtpSendWindowStartedAt && user.adminPasswordResetOtpSendWindowStartedAt > windowCutoff;
    const sendCount = inWindow ? (user.adminPasswordResetOtpSendCount || 0) : 0;
    if ((user.adminPasswordResetOtpBlockedUntil && user.adminPasswordResetOtpBlockedUntil > currentTime) ||
        (user.adminPasswordResetOtpLastSentAt && user.adminPasswordResetOtpLastSentAt > cooldownCutoff) ||
        sendCount >= MAX_SENDS_PER_HOUR) {
      return { message: GENERIC_REQUEST_MESSAGE };
    }

    const otp = makeOtp();
    const otpHash = hashOtp(otp);
    const filter = {
      _id: user._id,
      role: "admin",
      isEmailVerified: true,
      $and: [
        { $or: [
          { adminPasswordResetOtpLastSentAt: { $exists: false } },
          { adminPasswordResetOtpLastSentAt: null },
          { adminPasswordResetOtpLastSentAt: { $lte: cooldownCutoff } },
        ] },
        { $or: [
          { adminPasswordResetOtpSendWindowStartedAt: { $exists: false } },
          { adminPasswordResetOtpSendWindowStartedAt: { $lte: windowCutoff } },
          { adminPasswordResetOtpSendCount: { $lt: MAX_SENDS_PER_HOUR } },
        ] },
        { $or: [
          { adminPasswordResetOtpBlockedUntil: { $exists: false } },
          { adminPasswordResetOtpBlockedUntil: null },
          { adminPasswordResetOtpBlockedUntil: { $lte: currentTime } },
        ] },
      ],
    };
    const reserved = await User.findOneAndUpdate(filter, {
      $set: {
        adminPasswordResetOtpHash: otpHash,
        adminPasswordResetOtpExpiresAt: new Date(currentTime.getTime() + OTP_TTL_MS),
        adminPasswordResetOtpLastSentAt: currentTime,
        adminPasswordResetOtpAttempts: 0,
        adminPasswordResetOtpSendWindowStartedAt: inWindow ? user.adminPasswordResetOtpSendWindowStartedAt : currentTime,
        adminPasswordResetOtpSendCount: sendCount + 1,
      },
      $unset: { adminPasswordResetOtpBlockedUntil: 1 },
    }, { new: true });
    if (!reserved) return { message: GENERIC_REQUEST_MESSAGE };

    try {
      await sendOtpEmail(user.email, user.username, otp);
    } catch (error) {
      await User.updateOne(
        { _id: user._id, role: "admin", adminPasswordResetOtpHash: otpHash },
        { $unset: {
          adminPasswordResetOtpHash: 1,
          adminPasswordResetOtpExpiresAt: 1,
          adminPasswordResetOtpLastSentAt: 1,
        } }
      );
      return { message: GENERIC_REQUEST_MESSAGE, deliveryFailed: true, errorCode: error?.code || "EMAIL_FAILED" };
    }
    return { message: GENERIC_REQUEST_MESSAGE };
  }

  async function resetPassword({ email: rawEmail, otp, password, confirmPassword }) {
    const email = normalizeEmail(rawEmail);
    if (!validEmail(email) || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return { ok: false, status: 400, message: INVALID_OTP_MESSAGE };
    }
    if (password !== confirmPassword) return { ok: false, status: 400, message: "Passwords do not match." };
    if (!isStrongPassword(password)) {
      return { ok: false, status: 400, message: "Use 8–72 bytes with uppercase and lowercase letters, a number, and a special character." };
    }

    const currentTime = now();
    const user = await User.findOne({ email, role: "admin", isEmailVerified: true })
      .select("+adminPasswordResetOtpHash +adminPasswordResetOtpExpiresAt +adminPasswordResetOtpAttempts +adminPasswordResetOtpBlockedUntil");
    const submittedHash = hashOtp(otp);
    const storedHash = user?.adminPasswordResetOtpHash;
    const hashMatches = typeof storedHash === "string" && /^[a-f\d]{64}$/i.test(storedHash) &&
      crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(submittedHash, "hex"));
    const attempts = user?.adminPasswordResetOtpAttempts || 0;
    const usable = user && user.adminPasswordResetOtpExpiresAt > currentTime &&
      (!user.adminPasswordResetOtpBlockedUntil || user.adminPasswordResetOtpBlockedUntil <= currentTime) &&
      attempts < MAX_OTP_ATTEMPTS;

    if (!usable || !hashMatches) {
      if (usable && !hashMatches) {
        const nextAttempts = attempts + 1;
        const failedFilter = {
          _id: user._id,
          role: "admin",
          adminPasswordResetOtpHash: storedHash,
          adminPasswordResetOtpAttempts: attempts,
          adminPasswordResetOtpExpiresAt: { $gt: currentTime },
        };
        const update = nextAttempts >= MAX_OTP_ATTEMPTS
          ? { $set: { adminPasswordResetOtpAttempts: nextAttempts, adminPasswordResetOtpBlockedUntil: new Date(currentTime.getTime() + OTP_BLOCK_MS) }, $unset: { adminPasswordResetOtpHash: 1, adminPasswordResetOtpExpiresAt: 1 } }
          : { $set: { adminPasswordResetOtpAttempts: nextAttempts } };
        await User.updateOne(failedFilter, update);
      }
      return { ok: false, status: 400, message: INVALID_OTP_MESSAGE };
    }

    const passwordHash = await hashPassword(password);
    const updated = await User.findOneAndUpdate({
      _id: user._id,
      email,
      role: "admin",
      isEmailVerified: true,
      adminPasswordResetOtpHash: storedHash,
      adminPasswordResetOtpExpiresAt: { $gt: now() },
      adminPasswordResetOtpAttempts: { $lt: MAX_OTP_ATTEMPTS },
      $or: [
        { adminPasswordResetOtpBlockedUntil: { $exists: false } },
        { adminPasswordResetOtpBlockedUntil: null },
        { adminPasswordResetOtpBlockedUntil: { $lte: now() } },
      ],
    }, {
      $set: { passwordHash },
      $inc: { authVersion: 1 },
      $unset: {
        adminPasswordResetOtpHash: 1,
        adminPasswordResetOtpExpiresAt: 1,
        adminPasswordResetOtpLastSentAt: 1,
        adminPasswordResetOtpAttempts: 1,
        adminPasswordResetOtpBlockedUntil: 1,
      },
    }, { new: true }).select("+authVersion");
    if (!updated) return { ok: false, status: 400, message: INVALID_OTP_MESSAGE };

    // authVersion increment already invalidates outstanding sessions at validation;
    // revocation also removes them from the active session set immediately.
    await LoginSession.updateMany(
      { userId: updated._id, sessionType: "admin", revokedAt: null },
      { $set: { revokedAt: now() } }
    );
    return { ok: true, message: "Admin password reset successfully. Sign in with your new password." };
  }

  return { requestReset, resetPassword };
}
