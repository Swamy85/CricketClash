const DEFAULT_FRONTEND_URL = "http://localhost:5173";

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/$/, "");
}

function allowedOrigins() {
  return String(process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL)
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
}

// Credentials (cookies) are allowed, so the origin must be explicit rather
// than a wildcard. Requests without an Origin header (health checks, server
// to server calls, curl) are not browser cross-origin requests and are allowed.
export const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, allowedOrigins().includes(normalizeOrigin(origin)));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 24 * 60 * 60,
  optionsSuccessStatus: 204,
};
