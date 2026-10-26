import { sendGmailEmail } from "./gmailService.js";

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export async function sendRegistrationNotificationEmail(
  user,
  { env = process.env, sendEmail = sendGmailEmail, now = () => new Date() } = {},
) {
  const recipient = env.REGISTRATION_NOTIFICATION_EMAIL || "kotariswamy1@gmail.com";
  const registeredAt = new Date(user.createdAt || now()).toISOString();
  const details = [
    ["Username", String(user.username || "")],
    ["Email", String(user.email || "")],
    ["User ID", String(user.userId || "")],
    ["Registered at (UTC)", registeredAt],
  ];
  const text = `A new CricketClash account was verified.\n\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:auto;padding:24px"><h2 style="color:#7d1833">New CricketClash user verified</h2><table style="border-collapse:collapse;width:100%">${details.map(([label, value]) => `<tr><th style="padding:10px;text-align:left;border-bottom:1px solid #eee">${escapeHTML(label)}</th><td style="padding:10px;border-bottom:1px solid #eee">${escapeHTML(value)}</td></tr>`).join("")}</table></div>`;
  return sendEmail({
    to: recipient,
    subject: "New CricketClash user registration",
    text,
    html,
  });
}
