import { sendGmailEmail } from "./gmailService.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function sendAdminPasswordResetOtpEmail(email, username, otp) {
  const safeUsername = escapeHtml(username);
  return sendGmailEmail({
    to: email,
    subject: "Reset your CricketClash administrator password",
    text: `Hello ${username}, your CricketClash administrator password reset code is ${otp}. It expires in 5 minutes and can only be used once. If you did not request this code, ignore this email.`,
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;"><div style="max-width:520px;margin:auto;padding:24px;"><h2 style="color:#7d1833;">Administrator password reset</h2><p>Hello ${safeUsername},</p><p>Use this six-digit code to reset your CricketClash administrator password:</p><div style="padding:18px;background:#f8f0f2;color:#7d1833;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;">${otp}</div><p>This code expires in 5 minutes and can only be used once.</p><p>If you did not request this code, ignore this email. Your password will not change.</p><p>— CricketClash Team</p></div></body></html>`,
  });
}
