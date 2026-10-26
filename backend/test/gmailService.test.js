import test from "node:test";
import assert from "node:assert/strict";
import { sendGmailEmail } from "../src/services/gmailService.js";

const message = { to: "player@example.com", subject: "Verify", text: "Code" };
const brevoEnv = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "smtp-login",
  SMTP_PASS: "example-test-password",
  BREVO_SENDER_EMAIL: "verified@example.test",
  BREVO_SENDER_NAME: "CricketClash",
};

test("Brevo SMTP uses configured STARTTLS credentials and confirms recipient acceptance", async () => {
  let transportOptions;
  let sentMessage;
  let closed = false;
  const result = await sendGmailEmail(message, {
    env: brevoEnv,
    createTransport(options) {
      transportOptions = options;
      return {
        async sendMail(value) { sentMessage = value; return { accepted: ["player@example.com"], messageId: "test-id" }; },
        close() { closed = true; },
      };
    },
  });
  assert.equal(transportOptions.host, "smtp.example.test");
  assert.equal(transportOptions.port, 587);
  assert.equal(transportOptions.secure, false);
  assert.equal(transportOptions.requireTLS, true);
  assert.deepEqual(transportOptions.auth, { user: "smtp-login", pass: "example-test-password" });
  assert.deepEqual(sentMessage.from, { name: "CricketClash", address: "verified@example.test" });
  assert.equal(result.messageId, "test-id");
  assert.equal(closed, true);
});

test("SMTP rejection and missing configuration are reported as delivery failures", async () => {
  await assert.rejects(
    sendGmailEmail(message, {
      env: brevoEnv,
      createTransport: () => ({ async sendMail() { return { accepted: [], rejected: [message.to] }; }, close() {} }),
    }),
    (error) => error.code === "EMAIL_RECIPIENT_REJECTED",
  );
  await assert.rejects(
    sendGmailEmail(message, { env: {}, createTransport() { assert.fail("Transport must not start without configuration"); } }),
    (error) => error.code === "EMAIL_CONFIGURATION" && !error.message.includes("password"),
  );
});

test("SMTP transport failures close the transporter and preserve only an error code for safe logging", async () => {
  let closed = false;
  await assert.rejects(
    sendGmailEmail(message, {
      env: brevoEnv,
      createTransport: () => ({
        async sendMail() { throw Object.assign(new Error("provider-private-response"), { code: "EAUTH" }); },
        close() { closed = true; },
      }),
    }),
    (error) => error.code === "EAUTH",
  );
  assert.equal(closed, true);
});
