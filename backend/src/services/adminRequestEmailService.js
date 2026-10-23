import Deposit from "../models/Deposit.js";
import Withdrawal from "../models/Withdrawal.js";
import User from "../models/User.js";
import { sendGmailEmail } from "./gmailService.js";

const REQUEST_MODELS = {
  deposit: {
    Model: Deposit,
    subject: "CricketClash — New Deposit Request",
    adminPath: "/admin/deposits",
    amountLabel: "Requested deposit amount",
  },
  withdrawal: {
    Model: Withdrawal,
    subject: "CricketClash — New Withdrawal Request",
    adminPath: "/admin/withdrawals",
    amountLabel: "Requested withdrawal amount",
  },
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function getSafeErrorCode(error) {
  return String(error?.code || error?.responseCode || "DELIVERY_FAILED")
    .replace(/[^A-Z0-9_-]/gi, "")
    .slice(0, 80);
}

function nextRetryAt(attempts) {
  const delayMs = Math.min(60_000 * (2 ** Math.max(0, attempts - 1)), 6 * 60 * 60_000);
  return new Date(Date.now() + delayMs);
}

function adminRequestUrl(path, requestId) {
  const baseUrl = (process.env.FRONTEND_URL || "http://localhost:5173")
    .replace(/\/+$/, "");
  return `${baseUrl}${path}?requestId=${encodeURIComponent(requestId)}`;
}

async function getAdminNotificationEmail() {
  const configuredEmail = String(process.env.ADMIN_NOTIFICATION_EMAIL || "").trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (validEmail.test(configuredEmail)) return configuredEmail;

  const admin = await User.findOne({
    role: "admin",
    isEmailVerified: true,
  })
    .select("email")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const adminAccountEmail = String(admin?.email || "").trim();
  if (validEmail.test(adminAccountEmail)) return adminAccountEmail;

  throw Object.assign(
    new Error("No valid admin notification email is configured."),
    { code: "ADMIN_EMAIL_CONFIGURATION" }
  );
}

async function buildMessage(kind, request) {
  const settings = REQUEST_MODELS[kind];
  const playerId = request.user?.userId;
  if (!playerId) throw Object.assign(new Error("Player ID is unavailable."), { code: "PLAYER_ID_MISSING" });

  const amount = kind === "deposit"
    ? `${Number(request.amount).toLocaleString("en-IN")} INR`
    : `₹${Number(request.cashAmount).toLocaleString("en-IN")} INR (${Number(request.coinAmount).toLocaleString("en-IN")} coins)`;
  const reference = kind === "deposit" ? request.utr : request.reference;
  const submittedAt = new Date(request.createdAt || request.requestedAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  });
  const url = adminRequestUrl(settings.adminPath, request._id);
  const rows = [
    ["Request ID", request._id],
    ["Player ID", playerId],
    [settings.amountLabel, amount],
    ["Submission date and time", submittedAt],
    ...(reference ? [[kind === "deposit" ? "Payment reference" : "Request reference", reference]] : []),
    ["Admin panel", url],
  ];

  const text = [
    settings.subject,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
  const htmlRows = rows.map(([label, value]) =>
    `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
  ).join("");

  return {
    subject: settings.subject,
    text,
    html: `<div style="font-family:Arial,sans-serif"><h2>${escapeHtml(settings.subject)}</h2><table cellpadding="8" cellspacing="0">${htmlRows}</table><p><a href="${escapeHtml(url)}">Open request in the CricketClash admin panel</a></p></div>`,
  };
}

export async function sendAdminRequestNotification(kind, requestId) {
  const settings = REQUEST_MODELS[kind];
  if (!settings) throw new Error("Unsupported admin request notification type.");

  const { Model } = settings;
  const now = new Date();
  const request = await Model.findOneAndUpdate(
    {
      _id: requestId,
      $or: [
        {
          "adminEmailNotification.status": { $in: ["PENDING", "FAILED"] },
          "adminEmailNotification.nextAttemptAt": { $lte: now },
        },
        {
          "adminEmailNotification.status": "SENDING",
          "adminEmailNotification.lastAttemptAt": {
            $lte: new Date(now.getTime() - 5 * 60_000),
          },
        },
      ],
    },
    {
      $set: {
        "adminEmailNotification.status": "SENDING",
        "adminEmailNotification.lastAttemptAt": now,
      },
      $inc: { "adminEmailNotification.attempts": 1 },
    },
    { new: true }
  ).populate("user", "userId");

  if (!request) {
    const existing = await Model.findById(requestId)
      .select("adminEmailNotification.status adminEmailNotification.nextAttemptAt")
      .lean();
    if (!existing) return { status: "NOT_FOUND" };
    return { status: existing.adminEmailNotification?.status || "PENDING" };
  }

  try {
    const adminEmail = await getAdminNotificationEmail();
    const message = await buildMessage(kind, request);
    await sendGmailEmail({
      to: adminEmail,
      messageId: `<${kind}-${request._id}@cricketclash>`,
      ...message,
    });

    await Model.updateOne(
      { _id: request._id, "adminEmailNotification.status": "SENDING" },
      {
        $set: {
          "adminEmailNotification.status": "SENT",
          "adminEmailNotification.lastErrorCode": "",
          "adminEmailNotification.nextAttemptAt": null,
        },
      }
    );
    return { status: "SENT" };
  } catch (error) {
    const errorCode = getSafeErrorCode(error);
    const attempts = request.adminEmailNotification?.attempts || 1;
    await Model.updateOne(
      { _id: request._id, "adminEmailNotification.status": "SENDING" },
      {
        $set: {
          "adminEmailNotification.status": "FAILED",
          "adminEmailNotification.lastErrorCode": errorCode,
          "adminEmailNotification.nextAttemptAt": nextRetryAt(attempts),
        },
      }
    );
    console.error("Admin request email delivery failed.", {
      type: kind,
      requestId: String(request._id),
      attempt: attempts,
      code: errorCode,
    });
    return { status: "FAILED" };
  }
}

export async function retryDueAdminRequestNotifications() {
  const now = new Date();
  const staleSendingCutoff = new Date(now.getTime() - 5 * 60_000);
  const dueFilter = {
    $or: [
      {
        "adminEmailNotification.status": { $in: ["PENDING", "FAILED"] },
        "adminEmailNotification.nextAttemptAt": { $lte: now },
      },
      {
        "adminEmailNotification.status": "SENDING",
        "adminEmailNotification.lastAttemptAt": { $lte: staleSendingCutoff },
      },
    ],
  };
  const tasks = await Promise.all([
    Deposit.find(dueFilter).select("_id").limit(25).lean(),
    Withdrawal.find(dueFilter).select("_id").limit(25).lean(),
  ]);

  for (const request of tasks[0]) {
    await sendAdminRequestNotification("deposit", request._id);
  }
  for (const request of tasks[1]) {
    await sendAdminRequestNotification("withdrawal", request._id);
  }
}

export async function retryAdminRequestNotification(kind, requestId) {
  const settings = REQUEST_MODELS[kind];
  if (!settings) throw new Error("Unsupported admin request notification type.");

  const request = await settings.Model.findById(requestId);
  if (!request) return null;
  if (request.adminEmailNotification?.status === "SENT") {
    return { status: "SENT" };
  }

  await settings.Model.updateOne(
    { _id: requestId, "adminEmailNotification.status": { $ne: "SENDING" } },
    {
      $set: {
        "adminEmailNotification.status": "PENDING",
        "adminEmailNotification.nextAttemptAt": new Date(),
      },
    }
  );
  return sendAdminRequestNotification(kind, requestId);
}
