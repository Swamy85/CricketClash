import nodemailer from "nodemailer";

export async function sendGmailEmail(message) {
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const smtpPort = Number(process.env.SMTP_PORT);
  const smtpUser = String(process.env.SMTP_USER || "").trim();
  const smtpPassword = String(process.env.SMTP_PASS || "");
  const smtpFrom = String(process.env.BREVO_SENDER_EMAIL || "").trim();

  const gmailUser = String(process.env.GMAIL_USER || "").trim();
  const gmailPassword = String(process.env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");

  const hasConfiguredSmtp =
    smtpHost &&
    Number.isInteger(smtpPort) &&
    smtpPort > 0 &&
    smtpPort <= 65535 &&
    smtpUser &&
    smtpPassword &&
    smtpFrom;

  let transporter;
  let from;
  if (hasConfiguredSmtp) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: smtpUser, pass: smtpPassword },
      requireTLS: smtpPort === 587,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
    from = {
      name: process.env.BREVO_SENDER_NAME || "CricketClash",
      address: smtpFrom,
    };
  } else if (gmailUser && gmailPassword) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPassword },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
    from = { name: "CricketClash", address: gmailUser };
  } else {
    throw Object.assign(
      new Error("SMTP email configuration is incomplete."),
      { code: "EMAIL_CONFIGURATION" }
    );
  }

  try {
    const result = await transporter.sendMail({
      from,
      ...message,
    });

    if (
      Array.isArray(result.accepted) &&
      !result.accepted.some(
        (acceptedAddress) =>
          String(acceptedAddress).toLowerCase() ===
          String(message.to).toLowerCase()
      )
    ) {
      throw Object.assign(new Error("SMTP server did not accept the recipient."), {
        code: "EMAIL_RECIPIENT_REJECTED",
      });
    }

    return result;
  } finally {
    transporter.close();
  }
}
