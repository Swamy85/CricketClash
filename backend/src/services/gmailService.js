import nodemailer from "nodemailer";

export async function sendGmailEmail(message, {
  env = process.env,
  createTransport = nodemailer.createTransport,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  const smtpHost = String(env.SMTP_HOST || "").trim();
  const smtpPort = Number(env.SMTP_PORT);
  const smtpUser = String(env.SMTP_USER || "").trim();
  const smtpPassword = String(env.SMTP_PASS || "");
  const smtpFrom = String(env.BREVO_SENDER_EMAIL || "").trim();

  const gmailUser = String(env.GMAIL_USER || "").trim();
  const gmailPassword = String(env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");

  // Render's free web services block SMTP ports. Brevo's HTTPS API uses port
  // 443, so prefer it whenever an API key is configured.
  const brevoApiKey = String(env.BREVO_API_KEY || "").trim();
  if (brevoApiKey) {
    const senderEmail = smtpFrom || gmailUser;
    if (!senderEmail) {
      throw Object.assign(
        new Error("Brevo sender email is not configured."),
        { code: "EMAIL_CONFIGURATION" }
      );
    }

    const response = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": brevoApiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: env.BREVO_SENDER_NAME || "CricketClash",
          email: senderEmail,
        },
        to: [{ email: String(message.to).trim() }],
        subject: message.subject,
        ...(message.replyTo ? { replyTo: {
          email: String(typeof message.replyTo === "string"
            ? message.replyTo
            : message.replyTo.address || message.replyTo.email || "").trim(),
          ...(typeof message.replyTo === "object" && message.replyTo.name
            ? { name: String(message.replyTo.name).trim() }
            : {}),
        } } : {}),
        ...(message.html ? { htmlContent: message.html } : {}),
        ...(message.text ? { textContent: message.text } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw Object.assign(
        new Error(`Brevo email API rejected the request (${response.status}).`),
        { code: `BREVO_API_${response.status}` }
      );
    }

    const result = await response.json();
    return {
      accepted: [String(message.to).trim()],
      messageId: result.messageId,
    };
  }

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
