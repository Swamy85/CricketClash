import express from "express";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const jsonBodyParser = express.json({ limit: "20kb" });

function hasUnsafeKey(value) {
  const pending = [value];
  const visited = new Set();

  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (key.startsWith("$") || key.includes(".") || FORBIDDEN_KEYS.has(key)) return true;
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return false;
}

export function rejectUnsafeRequestKeys(req, res, next) {
  if (hasUnsafeKey(req.body) || hasUnsafeKey(req.query)) {
    return res.status(400).json({
      success: false,
      message: "Request contains an unsupported field name.",
    });
  }
  return next();
}

export function unexpectedFields(input, allowedFields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ["Request body must be a valid object."];
  }
  return Object.keys(input)
    .filter((field) => !allowedFields.includes(field))
    .map((field) => `Unexpected field: ${field}.`);
}

export function parseBoundedInteger(value, { min = 1, max, defaultValue } = {}) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max
    ? number
    : null;
}
