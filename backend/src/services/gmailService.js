import nodemailer from "nodemailer";

export async function sendGmailEmail(message, { env = process.env, createTransport = nodemailer.createTransport } = {}) {
  const smtpHost = String(env.SMTP_HOST || "").trim();
  const smtpPort = Number(env.SMTP_PORT);
  const smtpUser = String(env.SMTP_USER || "").trim();
  const smtpPassword = String(env.SMTP_PASS || "");
  const smtpFrom = String(env.BREVO_SENDER_EMAIL || "").trim();

  const gmailUser = String(env.GMAIL_USER || "").trim();
  const gmailPassword = String(env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");

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
    transporter = createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: env.SMTP_SECURE === "true",
      auth: { user: smtpUser, pass: smtpPassword },
      requireTLS: smtpPort === 587,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
    from = {
      name: env.BREVO_SENDER_NAME || "CricketClash",
      address: smtpFrom,
    };
  } else if (gmailUser && gmailPassword) {
    transporter = createTransport({
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

    const acceptedRecipients = Array.isArray(result.accepted)
      ? result.accepted.map((recipient) => String(recipient?.address || recipient).trim().toLowerCase())
      : [];
    if (!acceptedRecipients.includes(String(message.to).trim().toLowerCase())) {
      throw Object.assign(new Error("SMTP server did not accept the recipient."), {
        code: "EMAIL_RECIPIENT_REJECTED",
      });
    }

    return result;
  } finally {
    transporter.close();
  }
}
