import { createRateLimiter } from "./authSecurity.js";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 1000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Built lazily on the first request so backend/.env is loaded before the
// configuration is read. The limit is intentionally high enough for the
// dashboard's polling requests while still stopping request floods.
let limiter;

export function globalLimiter(req, res, next) {
  if (!limiter) {
    limiter = createRateLimiter({
      limit: positiveInteger(process.env.GLOBAL_RATE_LIMIT_MAX, DEFAULT_LIMIT),
      windowMs: positiveInteger(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
      message: "Too many requests from this address. Please try again later.",
    });
  }

  return limiter(req, res, next);
}
