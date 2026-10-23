import test from "node:test";
import assert from "node:assert/strict";
import { formatIndiaDateTime } from "../src/utils/dateTime.js";

test("IST formatter accepts dateStyle and timeStyle without conflicting component options", () => {
  const formatted = formatIndiaDateTime("2026-10-23T12:00:00.000Z", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  assert.match(formatted, /23 Oct 2026/);
  assert.match(formatted, /5:30/);
  assert.ok(formatted.endsWith("IST"));
});

test("IST formatter keeps component options and ignores attempts to override the timezone", () => {
  const formatted = formatIndiaDateTime("2026-10-23T12:00:00.000Z", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  assert.match(formatted, /5:30/);
  assert.ok(formatted.endsWith("IST"));
});
