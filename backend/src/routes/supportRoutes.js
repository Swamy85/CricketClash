
import { Router } from "express";
import SupportRequest from "../models/SupportRequest.js";
import { unexpectedFields } from "../middleware/requestSafety.js";
import { sendGmailEmail } from "../services/gmailService.js";

const router = Router();

const SUPPORT_EMAIL = "kotariswamy1@gmail.com";

const allowedCategories = new Set([
  "account",
  "email-verification",
  "login",
  "contest",
  "privacy",
  "technical",
  "other",
]);

// Lightweight per-process rate limit:
// 5 submissions per IP per 15 minutes.
const submissionAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMISSIONS = 5;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function checkRateLimit(ip) {
  const now = Date.now();
  const existing = submissionAttempts.get(ip);

  if (
    !existing ||
    now - existing.startedAt >= RATE_LIMIT_WINDOW_MS
  ) {
    submissionAttempts.set(ip, {
      startedAt: now,
      count: 1,
    });

    return true;
  }

  if (existing.count >= MAX_SUBMISSIONS) {
    return false;
  }

  existing.count += 1;
  return true;
}

// POST /api/support
router.post("/", async (req, res) => {
  const unknownFields = unexpectedFields(req.body, ["name", "email", "category", "subject", "message", "website"]);
  if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
  // Read request data before using any submitted fields.
  const {
    name,
    email,
    category,
    subject,
    message,
    website,
  } = req.body ?? {};

  // Honeypot field: silently accept bot submissions.
  if (website) {
    return res.status(201).json({
      success: true,
      message: "Your support request has been received.",
    });
  }

  const ip =
    req.ip || req.socket?.remoteAddress || "unknown";

  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      message: "Too many requests. Please try again in 15 minutes.",
    });
  }

  try {
    const cleanName =
      typeof name === "string" ? name.trim() : "";

    const cleanEmail =
      typeof email === "string"
        ? email.trim().toLowerCase()
        : "";

    const cleanCategory =
      typeof category === "string"
        ? category.trim()
        : "";

    const cleanSubject =
      typeof subject === "string" ? subject.trim() : "";

    const cleanMessage =
      typeof message === "string" ? message.trim() : "";

    // Validate submitted fields.
    const validationErrors = {};

    if (!cleanName || cleanName.length > 80) {
      validationErrors.name =
        "Enter your name (maximum 80 characters).";
    }

    if (
      !cleanEmail ||
      cleanEmail.length > 254 ||
      !validEmail(cleanEmail)
    ) {
      validationErrors.email =
        "Enter a valid email address (maximum 254 characters).";
    }

    if (!allowedCategories.has(cleanCategory)) {
      validationErrors.category = "Choose a valid support category.";
    }

    if (!cleanSubject || cleanSubject.length > 120) {
      validationErrors.subject =
        "Enter a subject (maximum 120 characters).";
    }

    if (cleanMessage.length < 10 || cleanMessage.length > 3000) {
      validationErrors.message =
        "Enter a message between 10 and 3000 characters.";
    }

    if (Object.keys(validationErrors).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Please check the highlighted fields and try again.",
        errors: validationErrors,
      });
    }

    // Save to MongoDB first so an email failure doesn't
    // cause the original support request to be lost.
    const supportRequest = await SupportRequest.create({
      name: cleanName,
      email: cleanEmail,
      category: cleanCategory,
      subject: cleanSubject,
      message: cleanMessage,
      notificationStatus: "pending",
    });

    let notificationSent = false;

    try {
      const safeName = escapeHtml(cleanName);
      const safeEmail = escapeHtml(cleanEmail);
      const safeCategory = escapeHtml(cleanCategory);
      const safeSubject = escapeHtml(cleanSubject);

      const safeMessage = escapeHtml(cleanMessage)
        .replace(/\r\n/g, "\n")
        .replace(/\n/g, "<br>");

      await sendGmailEmail({
        to: SUPPORT_EMAIL,
        replyTo: {
          name: cleanName,
          address: cleanEmail,
        },
        subject: `[CricketClash Support] ${cleanSubject}`,
        text: [
          "New CricketClash support request",
          "",
          `Request ID: ${supportRequest._id}`,
          `Name: ${cleanName}`,
          `Email: ${cleanEmail}`,
          `Category: ${cleanCategory}`,
          `Subject: ${cleanSubject}`,
          "",
          "Message:",
          cleanMessage,
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;color:#34252a;max-width:640px;margin:auto;padding:24px">
            <h2 style="color:#681b32">New CricketClash Support Request</h2>
            <p><strong>Request ID:</strong> ${supportRequest._id}</p>
            <p><strong>Name:</strong> ${safeName}</p>
            <p><strong>Email:</strong> ${safeEmail}</p>
            <p><strong>Category:</strong> ${safeCategory}</p>
            <p><strong>Subject:</strong> ${safeSubject}</p>
            <div style="background:#faf4f6;border:1px solid #eadde2;border-radius:8px;padding:16px;line-height:1.7">
              ${safeMessage}
            </div>
          </div>
        `,
      });

      notificationSent = true;
    } catch (emailError) {
      // The request is already saved even if SMTP fails.
      console.error(
        "Support notification failed:",
        emailError.message
      );
    }

    supportRequest.notificationStatus =
      notificationSent ? "sent" : "failed";

    await supportRequest.save();

    if (!notificationSent) {
      console.warn(
        `Support request ${supportRequest._id} was saved, but its email notification failed.`
      );
    }

    return res.status(201).json({
      success: true,
      notificationSent,
      message: notificationSent
        ? "Your support request has been submitted successfully."
        : "Your request was saved, but the email notification could not be sent. Please try again later if you need a response.",
      requestId: supportRequest._id,
    });
  } catch (error) {
    // Keep internal error details in the backend terminal only.
    console.error("Support submission failed:", error);

    return res.status(500).json({
      success: false,
      message:
        "We could not process your support request. Please try again later.",
    });
  }
});

export default router;
