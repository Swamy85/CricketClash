
//backend/src/app.js

import express from "express";

import mongoose from "mongoose";

import dotenv from "dotenv";

import cors from "cors";

import helmet from "helmet";

import hpp from "hpp";

import bcrypt from "bcryptjs";

import jwt from "jsonwebtoken";

import cookieParser from "cookie-parser";

import crypto from "node:crypto";

import { sendGmailEmail } from "./services/gmailService.js";

import User from "./models/User.js";
import PendingRegistration from "./models/PendingRegistration.js";
import UsernameClaim from "./models/UsernameClaim.js";

import LoginSession from "./models/LoginSession.js";
import Match from "./models/Match.js";
import Contest from "./models/Contest.js";
import WalletTransaction from "./models/WalletTransaction.js";
import { sendPasswordResetOtpEmail } from "./services/passwordResetEmailService.js";
import { sendAdminPasswordResetOtpEmail } from "./services/adminPasswordResetEmailService.js";
import { createAdminPasswordResetService } from "./services/adminPasswordResetService.js";
import { createRegistrationService, makeOtp, hashOtp } from "./services/registrationService.js";
import { sendRegistrationNotificationEmail } from "./services/registrationNotificationEmailService.js";
import { findPlayerWithValidPassword } from "./services/playerCredentialService.js";
import { changeAccountPassword, normalizeNotificationPreferences, updateNotificationPreferences } from "./services/accountSettingsService.js";

import requireAdmin from "./middleware/requireAdmin.js";
import { jsonBodyParser, urlencodedBodyParser, rejectUnsafeRequestKeys, unexpectedFields } from "./middleware/requestSafety.js";
import { mongoSanitize } from "./middleware/mongoSanitize.js";
import { globalLimiter } from "./middleware/rateLimiter.js";
import { corsOptions } from "./config/corsOptions.js";
import { createRateLimiter, createFailedAttemptTracker, nextOtpFailure } from "./middleware/authSecurity.js";
import { createAuthenticateMiddleware, createLogoutHandler } from "./middleware/sessionAuth.js";

import supportRoutes from "./routes/supportRoutes.js";


import matchRoutes from "./modules/matches/matchRoutes.js";
import adminMatchRoutes from "./modules/matches/adminMatchRoutes.js";

import walletRoutes from "./modules/wallet/walletRoutes.js";
import adminWithdrawalRoutes from "./modules/wallet/adminWithdrawalRoutes.js";
import adminDepositRoutes from "./modules/wallet/adminDepositRoutes.js";
import adminWalletRoutes from "./modules/wallet/adminWalletRoutes.js";


import contestRoutes from "./modules/contests/contestRoutes.js";
import adminContestRoutes from "./modules/contests/adminContestRoutes.js";
import adminReportRoutes from "./routes/adminReportRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import teamRoutes from "./modules/teams/teamRoutes.js";
import publicTeamRoutes from "./modules/teams/publicTeamRoutes.js";
import cricketFeedRoutes from "./routes/cricketFeedRoutes.js";
import adminTelegramRoutes from "./routes/adminTelegramRoutes.js";

import {
  createLoginSession,
  hashSessionId,
  IDLE_TIMEOUT_MS,
  SESSION_MAX_LIFETIME_MS,
} from "./services/sessionService.js";

dotenv.config();



const app = express();

const PORT = process.env.PORT || 5000;

// Express must know how many reverse proxies sit in front of it so req.ip
// reflects the client address (used by rate limiting and security logging).
const TRUST_PROXY = String(process.env.TRUST_PROXY || "").trim();
if (TRUST_PROXY === "true") {
  app.set("trust proxy", true);
} else if (/^\d+$/.test(TRUST_PROXY)) {
  app.set("trust proxy", Number(TRUST_PROXY));
} else if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");

const JWT_SECRET = process.env.JWT_SECRET;



const OTP_EXPIRY_MS = 5 * 60 * 1000;

const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

const MAX_OTP_ATTEMPTS = 5;

const OTP_BLOCK_MS = 15 * 60 * 1000;

const PASSWORD_RESET_SEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_RESET_SEND_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_MAX_SENDS_PER_HOUR = 5;
const PASSWORD_RESET_TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const PASSWORD_RESET_GENERIC_MESSAGE =
  "If an account with that email exists, a password reset code has been sent.";
const REGISTRATION_GENERIC_MESSAGE =
  "If you can register with this address, a verification code will be sent. If you already have an account, please sign in.";
const loginFailureCooldownMs = 15 * 60 * 1000;
const playerLoginFailures = createFailedAttemptTracker({ maxAttempts: 5, cooldownMs: loginFailureCooldownMs });
const adminLoginFailures = createFailedAttemptTracker({ maxAttempts: 5, cooldownMs: loginFailureCooldownMs });
const loginRateLimit = createRateLimiter({ limit: 30, windowMs: 15 * 60 * 1000 });
const registrationRateLimit = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
const verificationRateLimit = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });
const otpResendRateLimit = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
const passwordResetRateLimit = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });
const adminPasswordResetRequestRateLimit = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
const adminPasswordResetVerifyRateLimit = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });

const adminPasswordResetService = createAdminPasswordResetService({
  User,
  LoginSession,
  sendOtpEmail: sendAdminPasswordResetOtpEmail,
  otpHashKey: JWT_SECRET,
});



// --------------------------------------------------

// 1. Validate required environment variables

// --------------------------------------------------



if (!process.env.MONGODB_URI) {

  throw new Error("MONGODB_URI is missing from backend/.env");

}



if (!JWT_SECRET || JWT_SECRET.length < 32) {

  throw new Error(

    "JWT_SECRET must be configured with at least 32 characters."

  );

}



// --------------------------------------------------

// 2. Express middleware

// --------------------------------------------------



// 1. Security HTTP headers
app.use(helmet());

// 2. CORS handling (explicit origins only, because cookies are allowed)
app.use(cors(corsOptions));

// 3. Body parsers with payload limits, then cookie parsing
app.use(jsonBodyParser);
app.use(urlencodedBodyParser);
app.use(cookieParser());

// 4. Strip MongoDB operators/dotted keys from untrusted input
app.use(mongoSanitize);

// 5. Reject prototype-pollution and other unsafe object keys
app.use(rejectUnsafeRequestKeys);

// 6. Prevent HTTP parameter pollution
app.use(hpp());

// 7. Global API rate limiting
app.use("/api", globalLimiter);

app.use("/api/support", supportRoutes);



// --------------------------------------------------

// 3. MongoDB User schema

// --------------------------------------------------



// Each login gets its own independent session, including logins in other tabs.

const SESSION_WARNING_MS = 14 * 60 * 1000;






// --------------------------------------------------

// 4. MongoDB Match schema

// --------------------------------------------------










// --------------------------------------------------

// 5. Utility functions

// --------------------------------------------------



function normalizeEmail(email) {

  return String(email || "").trim().toLowerCase();

}

function rejectUnexpectedBodyFields(req, res, allowedFields) {
  const errors = unexpectedFields(req.body ?? {}, allowedFields);
  if (!errors.length) return false;
  res.status(400).json({ success: false, message: errors[0] });
  return true;
}



function generateOTP() {

  // Generates a cryptographically secure six-digit OTP.

  return makeOtp();

}



function hashOTP(otp) {

  return hashOtp(JWT_SECRET, otp);

}



function generatePlayerId() {

  // Example: CC-A1B2C3D4E5F6

  return `CC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

}



function safeUser(user) {

  return {

    userId: user.userId,

    username: user.username,

    email: user.email,

    isEmailVerified: user.isEmailVerified,

    createdAt: user.createdAt,

    lastActivityAt: user.lastActivityAt,
    notificationPreferences: normalizeNotificationPreferences(user.notificationPreferences),

  };

}



function isValidEmail(email) {

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

}

function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPasswordResetOtp(otp) {
  return crypto.createHmac("sha256", JWT_SECRET).update(otp).digest("hex");
}

function safeErrorCode(error) {
  return String(error?.code || "REQUEST_FAILED")
    .replace(/[^A-Z0-9_-]/gi, "")
    .slice(0, 80);
}

function sendLoginFailure(res, tracker, key) {
  const attempt = tracker.fail(key);
  if (attempt.blocked) {
    res.set("Retry-After", String(attempt.retryAfterSeconds));
    return res.status(429).json({
      success: false,
      code: "LOGIN_COOLDOWN",
      message: "Too many unsuccessful sign-in attempts. Please try again in 15 minutes.",
    });
  }
  return res.status(401).json({ success: false, message: "Invalid email or password." });
}

function hasStrongPassword(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password, "utf8") >= 8 &&
    Buffer.byteLength(password, "utf8") <= 72 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}


function escapeHTML(value) {

  return String(value).replace(/[&<>"']/g, (character) => {

    const entities = {

      "&": "&amp;",

      "<": "&lt;",

      ">": "&gt;",

      '"': "&quot;",

      "'": "&#39;",

    };



    return entities[character];

  });

}



function setAuthCookie(res, user) {

  const token = jwt.sign(

    {

      userId: user._id.toString(),

      playerId: user.userId,

    },

    JWT_SECRET,

    {

      expiresIn: "7d",

    }

  );



  res.cookie("cc_token", token, {

    httpOnly: true,

    secure: process.env.NODE_ENV === "production",

    sameSite: "lax",

    maxAge: 7 * 24 * 60 * 60 * 1000,

    path: "/",

  });

}



function clearAuthCookie(res) {

  res.clearCookie("cc_token", {

    httpOnly: true,

    secure: process.env.NODE_ENV === "production",

    sameSite: "lax",

    path: "/",

  });

}



// --------------------------------------------------

// 6. Send OTP using Brevo

// --------------------------------------------------





async function sendOTPEmail(email, username, otp) {
  try {
    const result = await sendGmailEmail({
      to: email,
      subject: "Verify your CricketClash email",
      text: `Hello ${username}, your CricketClash verification code is ${otp}. It expires in 5 minutes.`,
      html: `<div style="font-family:Arial,sans-serif;color:#222;max-width:520px;margin:auto;padding:24px"><h2 style="color:#7d1833">Welcome to CricketClash!</h2><p>Hello ${escapeHTML(username)},</p><p>Use this verification code to activate your account:</p><div style="padding:18px;background:#f8f0f2;color:#7d1833;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center">${otp}</div><p>This code expires in 5 minutes.</p><p>If you did not request this code, ignore this email.</p><p>CricketClash Team</p></div>`,
    });
    console.info("Verification email accepted by SMTP provider.");
    return result;
  } catch (error) {
    console.error("Verification email delivery failed.", {
      code: safeErrorCode(error),
      responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined,
    });
    throw Object.assign(new Error("Could not send verification email."), {
      code: error?.code === "EMAIL_CONFIGURATION" ? "EMAIL_CONFIGURATION" : "EMAIL_DELIVERY_FAILED",
    });
  }
}

const registrationService = createRegistrationService({
  User,
  PendingRegistration,
  UsernameClaim,
  sendOtpEmail: sendOTPEmail,
  sendRegistrationNotification: (user) => sendRegistrationNotificationEmail(user),
  logNotificationFailure: (error) => console.error("New-user notification delivery failed.", { code: safeErrorCode(error) }),
  hashOtp: (otp) => hashOTP(otp),
  makeUserId: generatePlayerId,
  otpExpiryMs: OTP_EXPIRY_MS,
  resendCooldownMs: OTP_RESEND_COOLDOWN_MS,
  maxOtpAttempts: MAX_OTP_ATTEMPTS,
  otpBlockMs: OTP_BLOCK_MS,
});



// --------------------------------------------------

// 7. Authentication middleware

// --------------------------------------------------






const authenticate = createAuthenticateMiddleware({
  LoginSession,
  User,
  hashSessionId,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  maxLifetimeMsByType: SESSION_MAX_LIFETIME_MS,
});

// --------------------------------
//  REQUIRE ADMIN
//----------------------------------------


// --------------------------------------------------

// 8. Health check

// --------------------------------------------------



app.get("/api/health", (req, res) => {

  res.json({

    success: true,

    message: "CricketClash backend is running.",

    database:

      mongoose.connection.readyState === 1 ? "connected" : "disconnected",

  });

});



app.get("/api/admin/dashboard", authenticate, requireAdmin, async (req, res) => {
  const admin = req.user;

  try {
    const now = new Date();
    const [totalUsers, activeContests, upcomingMatches, transactions, recentUsers] = await Promise.all([
      User.countDocuments({ role: "user" }),
      Contest.countDocuments({ status: { $in: ["OPEN", "WAITING", "FULL", "LOCKED"] } }),
      Match.countDocuments({ status: "upcoming", startTime: { $gt: now } }),
      WalletTransaction.countDocuments({}),
      User.find({ role: "user" })
        .select("userId username isEmailVerified createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .lean(),
    ]);

    return res.json({
      success: true,
      message: "Welcome to the CricketClash admin dashboard!",
      admin: {
        id: admin._id?.toString(),
        userId: admin.userId,
        adminId: admin.userId,
        username: admin.username,
        email: admin.email,
        role: admin.role,
        isEmailVerified: admin.isEmailVerified,
        createdAt: admin.createdAt,
        lastActivityAt: admin.lastActivityAt,
      },
      session: {
        expiresAt: req.authSession?.expiresAt,
        absoluteExpiresAt: req.authSession?.absoluteExpiresAt,
      },
      stats: { totalUsers, activeContests, upcomingMatches, transactions },
      recentUsers,
    });
  } catch (error) {
    console.error("Unable to load admin dashboard data:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load admin dashboard data.",
    });
  }
});




// --------------------------------------------------

// 9. Register a new account

// POST /api/auth/register

// --------------------------------------------------
// 9. Register a new account
// POST /api/auth/register
// --------------------------------------------------
app.post("/api/auth/register", registrationRateLimit, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["username", "email", "password", "confirmPassword"])) return;
  try {
    const { username: rawUsername, email: rawEmail, password, confirmPassword } = req.body || {};
    const username = String(rawUsername || "").trim();
    const email = normalizeEmail(rawEmail);

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ success: false, message: "Please fill in all required fields." });
    }
    if (!/^[a-zA-Z0-9\_.-]{3,24}$/.test(username)) {
      return res.status(400).json({ success: false, message: "Username must be 3-24 characters and contain only letters, numbers, dots, underscores, or hyphens." });
    }
    if (!isValidEmail(email)) return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    if (typeof password !== "string" || password.length < 8 || password.length > 72 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ success: false, message: "Password must be between 8 and 72 characters." });
    }
    if (password !== confirmPassword) return res.status(400).json({ success: false, message: "Passwords do not match." });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await registrationService.register({ username, email, passwordHash, otp: generateOTP() });
    if (result.status !== 202) return res.status(result.status).json({ success: false, code: result.code, message: result.message });
    return res.status(202).json({ success: true, message: REGISTRATION_GENERIC_MESSAGE, email: result.email, sent: result.sent === true });
  } catch (error) {
    console.error("Registration request failed.", { code: safeErrorCode(error) });
    if (error.code === 11000) {
      const key = Object.keys(error.keyPattern || {})[0];
      const field = key === "username" || key === "usernameKey" ? "username" : "email address";
      return res.status(409).json({ success: false, code: "REGISTRATION_CONFLICT", message: `That ${field} is already in use. Please choose another.` });
    }
    return res.status(500).json({ success: false, message: "Registration failed. Please try again." });
  }
});


// --------------------------------------------------



app.post("/api/auth/verify-otp", verificationRateLimit, async (req, res) => {

  if (rejectUnexpectedBodyFields(req, res, ["email", "otp"])) return;

  try {

    const email = normalizeEmail(req.body?.email);

    const otp = String(req.body?.otp || "").trim();



    if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {

      return res.status(400).json({

        success: false,

        message: "Enter a valid email address and six-digit OTP.",

      });

    }



    const result = await registrationService.verify(email, otp);
    if (result.status !== 200) {
      if (result.status === 429) res.set("Retry-After", String(Math.ceil(OTP_BLOCK_MS / 1000)));
      return res.status(result.status).json({ success: false, code: result.code, message: result.message });
    }
    return res.json({ success: true, message: "Email verified successfully. Your account is now active.", user: safeUser(result.user) });

  } catch (error) {

    console.error("OTP verification failed.", { code: safeErrorCode(error) });



    return res.status(500).json({

      success: false,

      message: "Could not verify OTP. Please try again.",

    });

  }

});



// --------------------------------------------------

// 11. Resend OTP

// POST /api/auth/resend-otp

// --------------------------------------------------



app.post("/api/auth/resend-otp", otpResendRateLimit, async (req, res) => {

  if (rejectUnexpectedBodyFields(req, res, ["email", "flow"])) return;

  try {

    const email = normalizeEmail(req.body?.email);
    const flow = req.body?.flow;



    if (!isValidEmail(email)) {

      return res.status(400).json({

        success: false,

        message: "Please enter a valid email address.",

      });

    }

    if (flow !== undefined && flow !== "registration" && flow !== "legacy") {
      return res.status(400).json({ success: false, message: "Invalid verification request." });
    }



    const result = await registrationService.resend(email, generateOTP());
    if (result.status >= 400) return res.status(result.status).json({ success: false, code: result.code, message: result.message });
    return res.json({ success: true, message: result.message });

  } catch (error) {

    console.error("Resend OTP request failed.", { code: safeErrorCode(error) });



    return res.status(500).json({

      success: false,

      message: "Could not resend OTP. Please try again.",

    });

  }

});



// --------------------------------------------------
// Player password reset by email OTP
// --------------------------------------------------

async function handlePasswordResetOtpRequest(req, res) {
  if (rejectUnexpectedBodyFields(req, res, ["email"])) return;
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid email address.",
    });
  }

  try {
    const user = await User.findOne({
      email,
      role: "user",
      isEmailVerified: true,
    }).select(
      "+passwordResetOtpLastSentAt +passwordResetOtpBlockedUntil +passwordResetOtpSendWindowStartedAt +passwordResetOtpSendCount"
    );

    if (!user) {
      return res.json({
        success: true,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
      });
    }

    const now = new Date();
    const nowMs = now.getTime();
    const cooldownCutoff = new Date(nowMs - PASSWORD_RESET_SEND_COOLDOWN_MS);
    const sendWindowCutoff = new Date(nowMs - PASSWORD_RESET_SEND_WINDOW_MS);
    const currentWindow =
      user.passwordResetOtpSendWindowStartedAt &&
      user.passwordResetOtpSendWindowStartedAt > sendWindowCutoff;
    const sendCount = currentWindow ? user.passwordResetOtpSendCount || 0 : 0;

    if (
      (user.passwordResetOtpBlockedUntil &&
        user.passwordResetOtpBlockedUntil > now) ||
      (user.passwordResetOtpLastSentAt &&
        user.passwordResetOtpLastSentAt > cooldownCutoff) ||
      sendCount >= PASSWORD_RESET_MAX_SENDS_PER_HOUR
    ) {
      return res.json({
        success: true,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
      });
    }

    const otp = generateOTP();
    const otpHash = hashPasswordResetOtp(otp);
    const sendFilter = {
      _id: user._id,
      role: "user",
      isEmailVerified: true,
      $and: [
        {
          $or: [
            { passwordResetOtpLastSentAt: { $exists: false } },
            { passwordResetOtpLastSentAt: null },
            { passwordResetOtpLastSentAt: { $lte: cooldownCutoff } },
          ],
        },
        {
          $or: [
            { passwordResetOtpSendWindowStartedAt: { $exists: false } },
            { passwordResetOtpSendWindowStartedAt: { $lte: sendWindowCutoff } },
            { passwordResetOtpSendCount: { $lt: PASSWORD_RESET_MAX_SENDS_PER_HOUR } },
          ],
        },
        {
          $or: [
            { passwordResetOtpBlockedUntil: { $exists: false } },
            { passwordResetOtpBlockedUntil: null },
            { passwordResetOtpBlockedUntil: { $lte: now } },
          ],
        },
      ],
    };
    const reservedUser = await User.findOneAndUpdate(
      sendFilter,
      {
        $set: {
          passwordResetOtpHash: otpHash,
          passwordResetOtpExpiresAt: new Date(nowMs + OTP_EXPIRY_MS),
          passwordResetOtpLastSentAt: now,
          passwordResetOtpAttempts: 0,
          passwordResetOtpSendWindowStartedAt: currentWindow
            ? user.passwordResetOtpSendWindowStartedAt
            : now,
          passwordResetOtpSendCount: sendCount + 1,
        },
        $unset: {
          passwordResetOtpBlockedUntil: 1,
          passwordResetTokenHash: 1,
          passwordResetTokenExpiresAt: 1,
        },
      },
      { new: true }
    );

    if (!reservedUser) {
      return res.json({
        success: true,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
      });
    }

    try {
      await sendPasswordResetOtpEmail(user.email, user.username, otp);
    } catch (error) {
      await User.updateOne(
        { _id: user._id, passwordResetOtpHash: otpHash },
        {
          $unset: {
            passwordResetOtpHash: 1,
            passwordResetOtpExpiresAt: 1,
            passwordResetOtpLastSentAt: 1,
          },
          $inc: {
            passwordResetOtpSendCount: -1,
          },
        }
      );
      console.error("Password reset email delivery failed.", {
        userId: String(user._id),
        code: safeErrorCode(error),
      });
    }

    return res.json({
      success: true,
      message: PASSWORD_RESET_GENERIC_MESSAGE,
    });
  } catch (error) {
    console.error("Password reset OTP request failed.", {
      code: safeErrorCode(error),
    });
    return res.status(500).json({
      success: false,
      message: "Unable to process the request. Please try again later.",
    });
  }
}

app.post("/api/auth/forgot-password", passwordResetRateLimit, handlePasswordResetOtpRequest);
app.post("/api/auth/resend-password-reset-otp", passwordResetRateLimit, handlePasswordResetOtpRequest);

app.post("/api/auth/verify-password-reset-otp", passwordResetRateLimit, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["email", "otp"])) return;
  const email = normalizeEmail(req.body?.email);
  const otp = String(req.body?.otp || "").trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address and six-digit code.",
    });
  }

  try {
    const now = new Date();
    const user = await User.findOne({
      email,
      role: "user",
      isEmailVerified: true,
      passwordResetOtpExpiresAt: { $gt: now },
    }).select(
      "+passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetOtpAttempts +passwordResetOtpBlockedUntil"
    );

    const submittedHash = hashPasswordResetOtp(otp);
    const hashMatches =
      user?.passwordResetOtpHash &&
      Buffer.from(user.passwordResetOtpHash, "hex").length === 32 &&
      crypto.timingSafeEqual(
        Buffer.from(user.passwordResetOtpHash, "hex"),
        Buffer.from(submittedHash, "hex")
      );

    if (
      !user ||
      !hashMatches ||
      (user.passwordResetOtpBlockedUntil &&
        user.passwordResetOtpBlockedUntil > now) ||
      (user.passwordResetOtpAttempts || 0) >= MAX_OTP_ATTEMPTS
    ) {
      if (user && !hashMatches) {
        const attempts = user.passwordResetOtpAttempts || 0;
        if (attempts < MAX_OTP_ATTEMPTS) {
          const failure = nextOtpFailure(attempts, MAX_OTP_ATTEMPTS, Date.now(), OTP_BLOCK_MS);
          await User.updateOne(
            {
              _id: user._id,
              passwordResetOtpHash: user.passwordResetOtpHash,
              passwordResetOtpAttempts: attempts,
              passwordResetOtpExpiresAt: { $gt: now },
            },
            {
              $set: {
                passwordResetOtpAttempts: failure.attempts,
                ...(failure.blocked
                  ? { passwordResetOtpBlockedUntil: failure.blockedUntil }
                  : {}),
              },
            }
          );
        }
      }

      return res.status(400).json({
        success: false,
        message: "Invalid or expired code. Request a new code and try again.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("base64url");
    const resetTokenHash = hashPasswordResetToken(resetToken);
    const resetGrant = await User.findOneAndUpdate(
      {
        _id: user._id,
        role: "user",
        passwordResetOtpHash: user.passwordResetOtpHash,
        passwordResetOtpExpiresAt: { $gt: now },
        passwordResetOtpAttempts: { $lt: MAX_OTP_ATTEMPTS },
        $or: [
          { passwordResetOtpBlockedUntil: { $exists: false } },
          { passwordResetOtpBlockedUntil: null },
          { passwordResetOtpBlockedUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          passwordResetTokenHash: resetTokenHash,
          passwordResetTokenExpiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_EXPIRY_MS),
          passwordResetOtpAttempts: 0,
        },
        $unset: {
          passwordResetOtpHash: 1,
          passwordResetOtpExpiresAt: 1,
          passwordResetOtpBlockedUntil: 1,
        },
      },
      { new: true }
    );

    if (!resetGrant) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired code. Request a new code and try again.",
      });
    }

    return res.json({
      success: true,
      message: "Code verified. Choose a new password.",
      resetToken,
    });
  } catch (error) {
    console.error("Password reset OTP verification failed.", {
      code: safeErrorCode(error),
    });
    return res.status(500).json({
      success: false,
      message: "Unable to verify the code. Please try again.",
    });
  }
});

app.post("/api/auth/reset-password", passwordResetRateLimit, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["email", "resetToken", "password", "confirmPassword"])) return;
  const email = normalizeEmail(req.body?.email);
  const { resetToken, password, confirmPassword } = req.body || {};

  if (!isValidEmail(email) || typeof resetToken !== "string" || resetToken.length > 128) {
    return res.status(400).json({
      success: false,
      message: "Your password reset session is invalid or expired. Start again.",
    });
  }

  if (!hasStrongPassword(password)) {
    return res.status(400).json({
      success: false,
      message: "Use 8-72 bytes with uppercase and lowercase letters, a number, and a special character.",
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      success: false,
      message: "Passwords do not match.",
    });
  }

  try {
    const now = new Date();
    const resetTokenHash = hashPasswordResetToken(resetToken);
    const validGrant = await User.findOne({
      email,
      role: "user",
      passwordResetTokenHash: resetTokenHash,
      passwordResetTokenExpiresAt: { $gt: now },
    }).select("_id");

    if (!validGrant) {
      return res.status(400).json({
        success: false,
        message: "Your password reset session is invalid or expired. Start again.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: validGrant._id,
        email,
        role: "user",
        passwordResetTokenHash: resetTokenHash,
        passwordResetTokenExpiresAt: { $gt: new Date() },
      },
      {
        $set: { passwordHash },
        $inc: { authVersion: 1 },
        $unset: {
          passwordResetOtpHash: 1,
          passwordResetOtpExpiresAt: 1,
          passwordResetOtpLastSentAt: 1,
          passwordResetOtpAttempts: 1,
          passwordResetOtpBlockedUntil: 1,
          passwordResetOtpSendWindowStartedAt: 1,
          passwordResetOtpSendCount: 1,
          passwordResetTokenHash: 1,
          passwordResetTokenExpiresAt: 1,
        },
      },
      { new: true }
    ).select("+authVersion");

    if (!updatedUser) {
      return res.status(400).json({
        success: false,
        message: "Your password reset session is invalid or expired. Start again.",
      });
    }

    try {
      await LoginSession.updateMany(
        { userId: updatedUser._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    } catch (error) {
      // authVersion is checked on every authenticated request, so all older
      // sessions are invalid even if physical session cleanup must be retried.
      console.error("Password reset session cleanup failed.", {
        userId: String(updatedUser._id),
        code: safeErrorCode(error),
      });
    }

    return res.json({
      success: true,
      message: "Password reset successfully. Log in with your new password.",
    });
  } catch (error) {
    console.error("Password reset failed.", {
      code: safeErrorCode(error),
    });
    return res.status(500).json({
      success: false,
      message: "Unable to reset your password. Please try again.",
    });
  }
});


// --------------------------------------------------

// 12. Login with email and password

// POST /api/auth/login

// --------------------------------------------------



app.post("/api/auth/login", loginRateLimit, async (req, res) => {

  if (rejectUnexpectedBodyFields(req, res, ["email", "password"])) return;

  try {

    const email = normalizeEmail(req.body?.email);

    const password = req.body?.password;



    if (!isValidEmail(email) || typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 72) {

      return res.status(400).json({

        success: false,

        message: "Enter a valid email address and password.",

      });

    }

    const attemptKey = String(req.ip || req.socket?.remoteAddress || "unknown") + ":" + email;
    const cooldown = playerLoginFailures.check(attemptKey);
    if (cooldown.blocked) {
      res.set("Retry-After", String(cooldown.retryAfterSeconds));
      return res.status(429).json({ success: false, code: "LOGIN_COOLDOWN", message: "Too many unsuccessful sign-in attempts. Please try again in 15 minutes." });
    }



    const user = await findPlayerWithValidPassword({
      User,
      email,
      password,
      comparePassword: bcrypt.compare,
    });
    if (!user) {
      return sendLoginFailure(res, playerLoginFailures, attemptKey);
    }

    playerLoginFailures.clear(attemptKey);



    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before logging in.",
      });
    }

    if (!user.userId) {
      let assigned = false;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        user.userId = generatePlayerId();

        try {
          await user.save();
          assigned = true;
          break;
        } catch (error) {
          if (error.code !== 11000) {
            throw error;
          }

          user.invalidate("userId");
        }
      }

      if (!assigned) {
        return res.status(500).json({
          success: false,
          message: "Could not assign a player ID. Please try again.",
        });
      }
    }

    user.lastActivityAt = new Date();
    await user.save();
    const sessionId = await createLoginSession(user, "player");
    return res.json({
      success: true,
      message: "Login successful.",
      user: safeUser(user),
      sessionId,
    });

  } catch (error) {

    console.error("Login request failed.", { code: safeErrorCode(error) });



    return res.status(500).json({

      success: false,

      message: "Login failed. Please try again.",

    });

  }

});


/* -----------------------------------------------
   ADMIN LOGIN
   POST /api/admin/login
------------------------------------------------ */

app.post("/api/admin/login", loginRateLimit, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["email", "password"])) return;
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;

    if (!isValidEmail(email) || typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email and password.",
      });
    }

    const attemptKey = String(req.ip || req.socket?.remoteAddress || "unknown") + ":" + email;
    const cooldown = adminLoginFailures.check(attemptKey);
    if (cooldown.blocked) {
      res.set("Retry-After", String(cooldown.retryAfterSeconds));
      return res.status(429).json({ success: false, code: "LOGIN_COOLDOWN", message: "Too many unsuccessful sign-in attempts. Please try again in 15 minutes." });
    }

    // Load the password hash explicitly.
    const user = await User.findOne({ email }).select("+passwordHash +authVersion");

    // Use the same generic error for invalid credentials.
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return sendLoginFailure(res, adminLoginFailures, attemptKey);
    }

    // A normal player must never enter the admin panel.
    if (user.role !== "admin") {
      return sendLoginFailure(res, adminLoginFailures, attemptKey);
    }

    if (!user.isEmailVerified || !user.userId) {
      return sendLoginFailure(res, adminLoginFailures, attemptKey);
    }

    adminLoginFailures.clear(attemptKey);
    user.lastActivityAt = new Date();
    await user.save();

    // Reuse your existing session system.
    const sessionId = await createLoginSession(user, "admin");

    return res.json({
      success: true,
      message: "Admin login successful.",
      user: safeUser(user),
      sessionId,
    });
  } catch (error) {
    console.error("Admin login request failed.", { code: safeErrorCode(error) });

    return res.status(500).json({
      success: false,
      message: "Admin login failed. Please try again.",
    });
  }
});

// Admin-only password recovery. These public routes deliberately use a separate
// namespace and never consult or create a client-supplied role/session.
app.post("/api/admin/auth/forgot-password", adminPasswordResetRequestRateLimit, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["email"])) return;
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Please enter a valid email address." });
  }
  try {
    const result = await adminPasswordResetService.requestReset(email);
    if (result.deliveryFailed) {
      console.error("Admin password reset email delivery failed.", { code: safeErrorCode({ code: result.errorCode }) });
    }
    return res.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Admin password reset request failed.", { code: safeErrorCode(error) });
    // Keep the response indistinguishable from an unknown/ineligible email.
    return res.json({
      success: true,
      message: "If an eligible account exists, password reset instructions will be sent.",
    });
  }
});

app.post("/api/admin/auth/reset-password", adminPasswordResetVerifyRateLimit, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["email", "otp", "password", "confirmPassword"])) return;
  try {
    const result = await adminPasswordResetService.resetPassword(req.body || {});
    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, message: result.message });
  } catch (error) {
    console.error("Admin password reset failed.", { code: safeErrorCode(error) });
    return res.status(500).json({ success: false, message: "Unable to reset the password. Please try again." });
  }
});


// --------------------------------------------------

// 13. Get currently logged-in user

// GET /api/auth/me

// --------------------------------------------------



app.get("/api/auth/me", authenticate, (req, res) => {
  return res.json({
    success: true,
    user: safeUser(req.user),
    session: {
      expiresAt: req.authSession?.expiresAt,
      absoluteExpiresAt: req.authSession?.absoluteExpiresAt,
    },
  });
});

app.patch("/api/auth/settings/notifications", authenticate, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["preferences"])) return;
  if (req.user.role !== "user") return res.status(403).json({ success: false, message: "Player account required." });
  try {
    const result = await updateNotificationPreferences({
      User,
      userId: req.user._id,
      preferences: req.body?.preferences,
    });
    if (result.status !== 200) {
      return res.status(result.status).json({ success: false, code: result.code, message: result.message });
    }
    return res.json({ success: true, preferences: result.preferences });
  } catch (error) {
    console.error("Notification preferences update failed.", { code: safeErrorCode(error) });
    return res.status(500).json({ success: false, message: "Unable to save notification preferences." });
  }
});

app.patch("/api/auth/change-password", authenticate, async (req, res) => {
  if (rejectUnexpectedBodyFields(req, res, ["currentPassword", "newPassword", "confirmPassword"])) return;
  if (req.user.role !== "user") return res.status(403).json({ success: false, message: "Player account required." });
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ success: false, message: "Enter your current password." });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 72 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ success: false, message: "New password must be between 8 and 72 characters." });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ success: false, message: "New password and confirmation do not match." });
  }

  try {
    const result = await changeAccountPassword({
      User,
      LoginSession,
      user: req.user,
      session: req.authSession,
      currentPassword,
      newPassword,
      comparePassword: bcrypt.compare,
      hashPassword: (password) => bcrypt.hash(password, 12),
    });
    if (result.status !== 200) {
      return res.status(result.status).json({ success: false, code: result.code, message: result.message });
    }
    return res.json({
      success: true,
      currentSessionPreserved: result.currentSessionPreserved,
      message: result.currentSessionPreserved
        ? "Password updated. Other active sessions have been signed out."
        : "Password updated. Please sign in again to continue.",
    });
  } catch (error) {
    console.error("Account password change failed.", { code: safeErrorCode(error) });
    return res.status(500).json({ success: false, message: "Unable to change your password. Please try again." });
  }
});

// --------------------------------------------------
// 14. Record authenticated user activity
// POST /api/auth/activity
// --------------------------------------------------

app.post("/api/auth/activity", authenticate, (req, res) => {
  return res.json({
    success: true,
    message: "Session activity recorded.",
  });
});


// --------------------------------------------------

// 15. Logout

// POST /api/auth/logout

// --------------------------------------------------



app.post("/api/auth/logout", createLogoutHandler({ LoginSession, hashSessionId, clearAuthCookie }));



// --------------------------------------------------

// 16. List matches

// GET /api/matches

// --------------------------------------------------
// Authenticated player wallet and withdrawal routes.
app.use("/api/wallet", authenticate, walletRoutes);
app.use(
  "/api/admin/wallets",
  authenticate,
  requireAdmin,
  adminWalletRoutes
);

app.use("/api/notifications", authenticate, notificationRoutes);
app.use("/api/admin/telegram", authenticate, requireAdmin, adminTelegramRoutes);

// Public pages can read the active catalog; writes remain admin-only.
app.use("/api/teams", publicTeamRoutes);
app.use("/api/admin/teams", authenticate, requireAdmin, teamRoutes);

// Admin-only withdrawal management routes.
app.use(
  "/api/admin/withdrawals",
  authenticate,
  requireAdmin,
  adminWithdrawalRoutes
);

// admin deposits

app.use(
  "/api/admin/deposits",
  authenticate,
  requireAdmin,
  adminDepositRoutes
);

/* --------------------------------------------------
   Match module routes
-------------------------------------------------- */

// Shared matches for all users.
app.use("/api/matches", matchRoutes);
// Provider data is a separate shared read-only feed and never changes contest matches.
app.use("/api/cricket-feed", authenticate, cricketFeedRoutes);

// Only admins can create, update, or delete matches.
app.use(
  "/api/admin/matches",
  authenticate,
  requireAdmin,
  adminMatchRoutes
);


// Authenticated player contest routes.
app.use("/api/contests", authenticate, contestRoutes);

// Admin-only contest management routes.
app.use(
  "/api/admin/contests",
  authenticate,
  requireAdmin,
  adminContestRoutes
);

app.use("/api/admin/reports", authenticate, requireAdmin, adminReportRoutes);

// --------------------------------------------------

// 18. Handle unknown API routes and errors

// --------------------------------------------------

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "CricketClash API is running",
    timestamp: new Date().toISOString(),
  });
});



app.use("/api", (req, res) => {

  res.status(404).json({

    success: false,

    message: "API endpoint not found.",

  });

});



app.use((error, req, res, next) => {

  console.error("Unhandled server error.", { code: safeErrorCode(error) });



  if (res.headersSent) {

    return next(error);

  }



  const status = error?.type === "entity.too.large"
    ? 413
    : error?.type === "entity.parse.failed"
      ? 400
      : 500;

  return res.status(status).json({

    success: false,

    message: status === 413
      ? "Request body is too large."
      : status === 400
        ? "Request body contains invalid JSON."
        : "An unexpected server error occurred.",

  });

});



// --------------------------------------------------

// 19. Connect to MongoDB, then start the server

// --------------------------------------------------

export default app;
