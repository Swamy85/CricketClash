import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import hpp from "hpp";
import { mongoSanitize } from "../src/middleware/mongoSanitize.js";

// Read lazily by the rate limiter on its first request.
process.env.GLOBAL_RATE_LIMIT_MAX = "2";
process.env.GLOBAL_RATE_LIMIT_WINDOW_MS = "60000";

const { globalLimiter } = await import("../src/middleware/rateLimiter.js");

async function startServer(context, app) {
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("Mongo operator keys are stripped and duplicate query parameters are collapsed", async (context) => {
  const app = express();
  app.use(express.json());
  app.use(mongoSanitize);
  app.use(hpp());
  app.all("/", (req, res) => res.json({ query: req.query, body: req.body }));

  const url = await startServer(context, app);
  const response = await fetch(
    `${url}/?$where=1&tag=first&tag=last&profile.balance=10`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: { $gt: "" },
        name: "Player",
        profile: { "wallet.balance": 1, safe: true },
      }),
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.query.$where, undefined);
  assert.equal(body.query["profile.balance"], undefined);
  assert.equal(body.query.tag, "last");
  assert.deepEqual(body.body, {
    email: {},
    name: "Player",
    profile: { safe: true },
  });
});

test("global API limiter rejects floods with 429 and Retry-After", async (context) => {
  const app = express();
  app.use("/api", globalLimiter);
  app.get("/api/ping", (_req, res) => res.json({ success: true }));

  const url = await startServer(context, app);
  assert.equal((await fetch(`${url}/api/ping`)).status, 200);
  assert.equal((await fetch(`${url}/api/ping`)).status, 200);

  const blocked = await fetch(`${url}/api/ping`);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.deepEqual(await blocked.json(), {
    success: false,
    code: "RATE_LIMITED",
    message: "Too many requests from this address. Please try again later.",
  });
});
