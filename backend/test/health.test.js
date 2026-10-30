import test from "node:test";
import assert from "node:assert/strict";

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/cricketclash_test";
process.env.JWT_SECRET ||= "test-only-jwt-secret-with-at-least-32-characters";

const { default: app } = await import("../src/app.js");

test("GET /health returns a successful API health response", async (context) => {
  const server = app.listen(0);
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.message, "CricketClash API is running");
  assert.equal(typeof body.timestamp, "string");
  assert.ok(Number.isFinite(Date.parse(body.timestamp)));
});
