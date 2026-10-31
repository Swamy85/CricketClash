import test from "node:test";
import assert from "node:assert/strict";

// Configure the environment before app.js is loaded so the test does not
// depend on the developer's local backend/.env values.
process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27017/cricketclash_test";
process.env.JWT_SECRET ||= "test-only-jwt-secret-with-at-least-32-characters";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.NODE_ENV = "test";

const { default: app } = await import("../src/app.js");

async function startServer(context) {
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("security headers are applied and Express identity is hidden", async (context) => {
  const url = await startServer(context);
  const response = await fetch(`${url}/health`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(response.headers.get("content-security-policy"));
  assert.ok(response.headers.get("strict-transport-security"));
  assert.ok(response.headers.get("cross-origin-resource-policy"));
});

test("CORS allows the configured frontend origin and rejects unknown origins", async (context) => {
  const url = await startServer(context);

  const allowed = await fetch(`${url}/health`, {
    headers: { Origin: process.env.FRONTEND_URL },
  });
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    process.env.FRONTEND_URL
  );
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

  const rejected = await fetch(`${url}/health`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});
