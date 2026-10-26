import { randomInt, createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const GENERIC_RESEND_MESSAGE = "If an unverified account matches this address, a verification code will be sent.";

export function createRegistrationService({
  User,
  PendingRegistration,
  UsernameClaim,
  sendOtpEmail,
  sendRegistrationNotification = async () => {},
  logNotificationFailure = () => {},
  hashOtp,
  makeUserId,
  otpExpiryMs = 300_000,
  resendCooldownMs = 60_000,
  maxOtpAttempts = 5,
  otpBlockMs = 900_000,
  now = () => new Date(),
}) {
  const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
  const normalizeUsername = (value) => String(value || "").trim().toLowerCase();
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  async function findOne(Model, filter, select = "") {
    let query = Model.findOne(filter);
    if (select && typeof query.select === "function") query = query.select(select);
    return query;
  }

  async function findUser({ email, username } = {}, select = "") {
    let user = email ? await findOne(User, { email }, select) : null;
    if (!user && email) user = await findOne(User, { email: new RegExp(`^\\s*${escapeRegex(email)}\\s*$`, "i") }, select);
    if (!user && username) user = await findOne(User, { username }, select);
    if (!user && username) user = await findOne(User, { username: new RegExp(`^${escapeRegex(username.trim())}$`, "i") }, select);
    return user;
  }

  async function findPending(email, select = "") {
    return findOne(PendingRegistration, { email }, select);
  }

  async function ensureUsernameClaim(username, email, hasMatchingLegacyUser) {
    const usernameKey = normalizeUsername(username);
    try {
      await UsernameClaim.updateOne(
        { usernameKey },
        { $setOnInsert: { usernameKey, email, legacy: false } },
        { upsert: true },
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const claim = await UsernameClaim.findOne({ usernameKey });
    if ((claim?.email && normalizeEmail(claim.email) !== email) || (claim?.legacy && !hasMatchingLegacyUser)) return false;
    return true;
  }

  async function findPendingUsername(usernameKey) {
    return findOne(PendingRegistration, { usernameKey });
  }

  async function sendAndStoreOtp(pending, otp, passwordHash, username) {
    try {
      await sendOtpEmail(pending.email, pending.username, otp);
    } catch {
      throw Object.assign(new Error("Verification email delivery failed."), { code: "EMAIL_DELIVERY_FAILED" });
    }
    pending.otpHash = hashOtp(otp);
    pending.otpExpiresAt = new Date(now().getTime() + otpExpiryMs);
    pending.otpLastSentAt = now();
    pending.otpAttempts = 0;
    pending.otpBlockedUntil = undefined;
    if (passwordHash) pending.passwordHash = passwordHash;
    if (username) {
      pending.username = username;
      pending.usernameKey = normalizeUsername(username);
    }
    pending.verificationClaimId = undefined;
    await pending.save();
  }

  async function migrateLegacyUser(user) {
    const legacy = new PendingRegistration({
      username: user.username,
      usernameKey: normalizeUsername(user.username),
      email: normalizeEmail(user.email),
      passwordHash: user.passwordHash,
      otpHash: user.otpHash,
      otpExpiresAt: user.otpExpiresAt,
      otpLastSentAt: user.otpLastSentAt,
      otpAttempts: user.otpAttempts || 0,
      otpBlockedUntil: user.otpBlockedUntil,
      legacyUserId: user._id,
    });
    await legacy.save();
    return legacy;
  }

  async function issueFreshOtp(pending, otp) {
    await sendOtpEmail(pending.email, pending.username, otp);
    const updated = await PendingRegistration.findOneAndUpdate(
      { _id: pending._id, verificationClaimId: { $exists: false } },
      { $set: {
        otpHash: hashOtp(otp),
        otpExpiresAt: new Date(now().getTime() + otpExpiryMs),
        otpLastSentAt: now(),
        otpAttempts: 0,
      }, $unset: { otpBlockedUntil: 1 } },
      { new: true },
    );
    return updated;
  }

  async function notifyNewAccountOnce(user) {
    const reportFailure = (error) => {
      try { logNotificationFailure(error); } catch { /* logging cannot interrupt verification */ }
    };
    try {
      const claim = await User.updateOne(
        { _id: user._id, registrationNotificationAttemptedAt: { $exists: false } },
        { $set: { registrationNotificationAttemptedAt: now() } },
      );
      if (claim.modifiedCount !== 1) return;
      try {
        await sendRegistrationNotification(user);
      } catch (error) {
        reportFailure(error);
      }
    } catch (error) {
      // Account creation and OTP verification must succeed even if the
      // notification claim or SMTP provider is unavailable.
      reportFailure(error);
    }
  }

  async function register({ username, email: rawEmail, passwordHash, otp }) {
    const email = normalizeEmail(rawEmail);
    const usernameKey = normalizeUsername(username);
    const existingUser = await findUser({ email }, "+passwordHash +otpHash +otpExpiresAt +otpLastSentAt +otpAttempts +otpBlockedUntil");

    if (existingUser && normalizeEmail(existingUser.email) === email && existingUser.isEmailVerified) {
      return { status: 409, code: "ACCOUNT_ALREADY_VERIFIED", message: "An account with this email is already verified. Please sign in." };
    }
    if (existingUser && existingUser.role !== "user") {
      return { status: 409, code: "REGISTRATION_CONFLICT", message: "This email cannot be used for player registration. Please sign in to the correct account." };
    }
    if (existingUser && !existingUser.isEmailVerified) {
      return { status: 409, code: "LEGACY_VERIFICATION_REQUIRED", message: "This account already exists and needs email verification. Sign in, then choose Verify Email / Resend OTP." };
    }
    if (existingUser && (normalizeEmail(existingUser.email) !== email || normalizeUsername(existingUser.username) !== usernameKey)) {
      return { status: 409, code: "REGISTRATION_CONFLICT", message: "This email is associated with a different username. Use the original username or sign in." };
    }

    let pending = await findPending(email, "+passwordHash +otpHash +otpExpiresAt +otpLastSentAt +otpAttempts +otpBlockedUntil +verificationClaimId");
    if (!pending && existingUser && !existingUser.isEmailVerified) pending = await migrateLegacyUser(existingUser);

    const pendingForUsername = await findPendingUsername(usernameKey);
    if (pendingForUsername && normalizeEmail(pendingForUsername.email) !== email) {
      return { status: 409, code: "REGISTRATION_CONFLICT", message: "That username is already in use. Please choose another." };
    }
    const usernameOwner = await findUser({ username });
    if (usernameOwner && normalizeEmail(usernameOwner.email) !== email) {
      return { status: 409, code: "REGISTRATION_CONFLICT", message: "That username is already in use. Please choose another." };
    }
    if (!await ensureUsernameClaim(username, email, Boolean(existingUser && !existingUser.isEmailVerified))) {
      return { status: 409, code: "REGISTRATION_CONFLICT", message: "That username is already in use. Please choose another." };
    }

    if (pending?.verificationClaimId) return { status: 202, email, sent: false, message: "Your email verification is being completed. Please wait a moment." };
    if (pending?.otpBlockedUntil && pending.otpBlockedUntil > now()) {
      return { status: 429, code: "OTP_COOLDOWN", message: "Too many incorrect attempts. Please try again later." };
    }
    if (pending?.otpLastSentAt && now().getTime() - new Date(pending.otpLastSentAt).getTime() < resendCooldownMs && pending.otpHash) {
      const oldUsernameKey = pending.usernameKey;
      pending.username = username;
      pending.usernameKey = usernameKey;
      pending.passwordHash = passwordHash;
      await pending.save();
      if (oldUsernameKey !== usernameKey) await UsernameClaim.deleteOne?.({ usernameKey: oldUsernameKey, email });
      return { status: 202, email, sent: false };
    }

    const isNewPending = !pending;
    if (!pending) pending = new PendingRegistration({ username, usernameKey, email, passwordHash });
    const oldUsernameKey = pending.usernameKey;
    try {
      await sendAndStoreOtp(pending, otp, passwordHash, username);
      if (oldUsernameKey && oldUsernameKey !== usernameKey) await UsernameClaim.deleteOne?.({ usernameKey: oldUsernameKey, email });
      return { status: 202, email, sent: true };
    } catch (error) {
      if (error.code !== 11000) {
        if (error.code === "EMAIL_CONFIGURATION" || error.code === "EMAIL_DELIVERY_FAILED") {
          if (isNewPending) await UsernameClaim.deleteOne?.({ usernameKey, email });
          return { status: 502, code: "EMAIL_DELIVERY_FAILED", message: "We could not send your verification email. Your account details are safe; retry registration with the same username and email." };
        }
        throw error;
      }
      const winner = await findPending(email, "+otpHash +otpExpiresAt +otpLastSentAt +otpAttempts +otpBlockedUntil +verificationClaimId");
      if (!winner || winner.usernameKey !== usernameKey || winner.verificationClaimId) {
        return { status: 409, code: "REGISTRATION_CONFLICT", message: "That email or username is already in use by another account." };
      }
      winner.passwordHash = passwordHash;
      const winnerUsernameKey = winner.usernameKey;
      await sendAndStoreOtp(winner, otp, passwordHash, username);
      if (winnerUsernameKey !== usernameKey) await UsernameClaim.deleteOne?.({ usernameKey: winnerUsernameKey, email });
      return { status: 202, email, sent: true };
    }
  }

  async function resend(emailInput, otp) {
    const email = normalizeEmail(emailInput);
    let pending = await findPending(email, "+passwordHash +otpHash +otpExpiresAt +otpLastSentAt +otpAttempts +otpBlockedUntil +verificationClaimId +legacyUserId");
    if (!pending) {
      const legacyUser = await findUser({ email }, "+passwordHash +otpHash +otpExpiresAt +otpLastSentAt +otpAttempts +otpBlockedUntil");
      if (!legacyUser || legacyUser.isEmailVerified) return { status: 200, message: GENERIC_RESEND_MESSAGE, sent: false };
      try {
        pending = await migrateLegacyUser(legacyUser);
      } catch (error) {
        if (error.code !== 11000) throw error;
        pending = await findPending(email, "+passwordHash +otpHash +otpExpiresAt +otpLastSentAt +otpAttempts +otpBlockedUntil +verificationClaimId +legacyUserId");
        if (!pending) return { status: 200, message: GENERIC_RESEND_MESSAGE, sent: false };
      }
    }
    if (pending.verificationClaimId || (pending.otpBlockedUntil && pending.otpBlockedUntil > now())) {
      return { status: 200, message: GENERIC_RESEND_MESSAGE, sent: false };
    }
    if (pending.otpLastSentAt && now().getTime() - new Date(pending.otpLastSentAt).getTime() < resendCooldownMs) {
      return { status: 200, message: GENERIC_RESEND_MESSAGE, sent: false };
    }
    try {
      const updated = await issueFreshOtp(pending, otp);
      return { status: 200, message: GENERIC_RESEND_MESSAGE, sent: Boolean(updated) };
    } catch {
      return { status: 502, code: "EMAIL_DELIVERY_FAILED", message: "We could not send your verification email. Please retry after a moment." };
    }
  }

  async function verify(emailInput, otp, { maxAttempts = maxOtpAttempts, blockMs = otpBlockMs } = {}) {
    const email = normalizeEmail(emailInput);
    const pending = await findPending(email, "+passwordHash +otpHash +otpExpiresAt +otpAttempts +otpBlockedUntil +verificationClaimId +legacyUserId");
    if (!pending) return { status: 400, code: "OTP_UNAVAILABLE", message: "No pending verification was found. Please register again." };
    if (pending.verificationClaimId) return { status: 409, code: "OTP_PROCESSING", message: "Verification is already being completed. Please try signing in shortly." };
    if (pending.otpBlockedUntil && pending.otpBlockedUntil > now()) {
      return { status: 429, code: "OTP_COOLDOWN", message: "Too many incorrect attempts. Please try again later." };
    }
    if (!pending.otpHash || isOtpExpired(pending.otpExpiresAt, now())) {
      return { status: 400, code: "OTP_EXPIRED", message: "Your verification code has expired. Request a new code." };
    }
    if (!otpMatches(hashOtp, otp, pending.otpHash)) {
      const attempt = await PendingRegistration.findOneAndUpdate(
        { _id: pending._id, otpHash: pending.otpHash, otpAttempts: { $lt: maxAttempts } },
        { $inc: { otpAttempts: 1 } },
        { new: true },
      ).select("+otpAttempts");
      if (!attempt) return { status: 400, code: "OTP_INVALID", message: "Invalid verification code. Request a new code." };
      if (attempt.otpAttempts >= maxAttempts) {
        await PendingRegistration.updateOne(
          { _id: pending._id, otpHash: pending.otpHash, otpAttempts: { $gte: maxAttempts } },
          { $set: { otpBlockedUntil: new Date(now().getTime() + blockMs) }, $unset: { otpHash: 1, otpExpiresAt: 1 } },
        );
        return { status: 429, code: "OTP_COOLDOWN", message: "Too many incorrect attempts. Verification is temporarily blocked." };
      }
      return { status: 400, code: "OTP_INVALID", message: "Invalid verification code. Please try again." };
    }

    const claimId = randomUUID();
    const originalExpiry = pending.otpExpiresAt;
    const originalLastSentAt = pending.otpLastSentAt;
    const claimed = await PendingRegistration.findOneAndUpdate(
      { _id: pending._id, otpHash: pending.otpHash, otpExpiresAt: { $gt: now() }, otpAttempts: { $lt: maxAttempts }, verificationClaimId: { $exists: false } },
      { $set: { verificationClaimId: claimId }, $unset: { otpHash: 1, otpExpiresAt: 1 } },
      { new: true },
    ).select("+passwordHash +legacyUserId");
    if (!claimed) return { status: 400, code: "OTP_INVALID", message: "This verification code is no longer active. Request a new code." };

    let createdUser;
    try {
      if (claimed.legacyUserId) {
        const legacyAccount = await findOne(
          User,
          { _id: claimed.legacyUserId, role: "user", isEmailVerified: false },
          "+userId",
        );
        if (!legacyAccount) throw Object.assign(new Error("Legacy pending account was not found."), { code: "LEGACY_ACCOUNT_MISSING" });
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            createdUser = await User.findOneAndUpdate(
              { _id: claimed.legacyUserId, role: "user", isEmailVerified: false },
              { $set: {
                username: claimed.username,
                email: claimed.email,
                passwordHash: claimed.passwordHash,
                role: "user",
                isEmailVerified: true,
                userId: legacyAccount.userId || makeUserId(),
              }, $unset: {
                otpHash: 1, otpExpiresAt: 1, otpLastSentAt: 1, otpAttempts: 1, otpBlockedUntil: 1,
              } },
              { new: true, runValidators: true },
            );
            break;
          } catch (error) {
            if (error.code !== 11000 || attempt === 4) throw error;
          }
        }
        if (!createdUser) throw Object.assign(new Error("Legacy pending account was not found."), { code: "LEGACY_ACCOUNT_MISSING" });
      } else {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          createdUser = new User({
            username: claimed.username,
            email: claimed.email,
            passwordHash: claimed.passwordHash,
            role: "user",
            isEmailVerified: true,
            userId: makeUserId(),
          });
          try {
            await createdUser.save();
            break;
          } catch (error) {
            if (error.code !== 11000 || attempt === 4) throw error;
            if (Object.keys(error.keyPattern || {})[0] !== "userId") throw error;
            createdUser = null;
          }
        }
        if (createdUser) await notifyNewAccountOnce(createdUser);
      }
      await PendingRegistration.deleteOne({ _id: claimed._id, verificationClaimId: claimId });
      return { status: 200, user: createdUser };
    } catch (error) {
      await PendingRegistration.updateOne(
        { _id: claimed._id, verificationClaimId: claimId },
        { $set: { otpHash: hashOtp(otp), otpExpiresAt: originalExpiry, otpLastSentAt: originalLastSentAt }, $unset: { verificationClaimId: 1 } },
      );
      throw error;
    }
  }

  return { register, resend, verify };
}

export function makeOtp() {
  return randomInt(100000, 1000000).toString();
}

export function hashOtp(key, otp) {
  return createHmac("sha256", key).update(otp).digest("hex");
}

export function otpMatches(hashFunction, otp, expectedHex) {
  if (!/^[a-f\d]{64}$/i.test(expectedHex || "")) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(hashFunction(otp), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function isOtpExpired(expiresAt, now = new Date()) {
  return !expiresAt || new Date(expiresAt).getTime() <= new Date(now).getTime();
}

export async function initializeUsernameClaims({ User, UsernameClaim }) {
  await UsernameClaim.createIndexes();
  const existingUsernames = await User.distinct("username");
  for (const username of existingUsernames) {
    const usernameKey = String(username || "").trim().toLowerCase();
    if (!usernameKey) continue;
    try {
      await UsernameClaim.updateOne(
        { usernameKey },
        { $setOnInsert: { usernameKey, legacy: true, email: null } },
        { upsert: true },
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
}
