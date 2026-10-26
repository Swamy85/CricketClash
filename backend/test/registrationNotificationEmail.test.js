import test from "node:test";
import assert from "node:assert/strict";
import { sendRegistrationNotificationEmail } from "../src/services/registrationNotificationEmailService.js";

test("new-user notification includes account details and omits credentials", async () => {
  let message;
  await sendRegistrationNotificationEmail({
    username: "wicket&keeper",
    email: "player@example.com",
    userId: "CC-0001",
    createdAt: new Date("2026-10-26T12:30:00.000Z"),
    passwordHash: "must-not-appear",
    otpHash: "must-not-appear-either",
  }, {
    env: { REGISTRATION_NOTIFICATION_EMAIL: "notify@example.com" },
    sendEmail: async (value) => { message = value; },
  });

  assert.equal(message.to, "notify@example.com");
  assert.match(message.text, /Username: wicket&keeper/);
  assert.match(message.text, /Email: player@example\.com/);
  assert.match(message.text, /User ID: CC-0001/);
  assert.match(message.text, /2026-10-26T12:30:00\.000Z/);
  assert.doesNotMatch(message.text + message.html, /must-not-appear|passwordHash|otpHash/);
  assert.match(message.html, /wicket&amp;keeper/);
});

test("notification email transport errors are surfaced to the caller for safe handling", async () => {
  await assert.rejects(
    sendRegistrationNotificationEmail({ username: "player", email: "player@example.com", userId: "CC-1" }, {
      sendEmail: async () => { throw Object.assign(new Error("private provider response"), { code: "ECONNECTION" }); },
    }),
    (error) => error.code === "ECONNECTION" && !error.message.includes("password"),
  );
});
