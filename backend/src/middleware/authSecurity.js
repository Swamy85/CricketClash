const MAX_BUCKETS = 20000;

function pruneExpired(store, now) {
  if (store.size < MAX_BUCKETS) return;
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size >= MAX_BUCKETS) store.delete(store.keys().next().value);
}

export function createRateLimiter({ limit, windowMs, key = (req) => req.ip || req.socket?.remoteAddress || "unknown", message = "Too many requests. Please try again later." }) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const bucketKey = String(key(req));
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.expiresAt <= now) {
      pruneExpired(buckets, now);
      bucket = { count: 0, expiresAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }
    if (bucket.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ success: false, code: "RATE_LIMITED", message });
    }
    bucket.count += 1;
    return next();
  };
}

export function createFailedAttemptTracker({ maxAttempts, cooldownMs }) {
  const attempts = new Map();
  function get(key, now = Date.now()) {
    const entry = attempts.get(String(key));
    if (!entry) return { blocked: false, remainingAttempts: maxAttempts, retryAfterSeconds: 0 };
    if (entry.blockedUntil && entry.blockedUntil > now) {
      return { blocked: true, remainingAttempts: 0, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    if (entry.expiresAt <= now || (entry.blockedUntil && entry.blockedUntil <= now)) {
      attempts.delete(String(key));
      return { blocked: false, remainingAttempts: maxAttempts, retryAfterSeconds: 0 };
    }
    return { blocked: false, remainingAttempts: Math.max(0, maxAttempts - entry.count), retryAfterSeconds: 0 };
  }
  return {
    check: get,
    fail(key, now = Date.now()) {
      const normalizedKey = String(key);
      const current = get(normalizedKey, now);
      if (current.blocked) return current;
      pruneExpired(attempts, now);
      const previous = attempts.get(normalizedKey);
      const count = (previous?.count || 0) + 1;
      const blockedUntil = count >= maxAttempts ? now + cooldownMs : null;
      attempts.set(normalizedKey, { count, expiresAt: now + cooldownMs, blockedUntil });
      return {
        blocked: Boolean(blockedUntil),
        remainingAttempts: Math.max(0, maxAttempts - count),
        retryAfterSeconds: blockedUntil ? Math.ceil(cooldownMs / 1000) : 0,
      };
    },
    clear(key) { attempts.delete(String(key)); },
  };
}

export function nextOtpFailure(currentAttempts, maxAttempts, now = Date.now(), cooldownMs = 15 * 60 * 1000) {
  const attempts = Math.max(0, Number(currentAttempts) || 0) + 1;
  const blocked = attempts >= maxAttempts;
  return { attempts, blocked, blockedUntil: blocked ? new Date(now + cooldownMs) : null };
}
