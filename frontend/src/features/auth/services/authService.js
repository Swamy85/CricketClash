import { PLAYER_SESSION_KEY } from "./sessionKeys.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
export const SESSION_STORAGE_KEY = PLAYER_SESSION_KEY;
export const PASSWORD_RESET_EMAIL_KEY = "cc_password_reset_email";
export const PASSWORD_RESET_EXPIRY_KEY = "cc_password_reset_expires_at";
export const PASSWORD_RESET_RESEND_KEY = "cc_password_reset_resend_at";
export const PASSWORD_RESET_TOKEN_KEY = "cc_password_reset_token";

async function publicAuthRequest(endpoint, body) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    // Use the standard request error when the server does not return JSON.
  }

  if (!response.ok) {
    const error = new Error(data.message || "Authentication request failed.");
    error.code = data.code;
    error.status = response.status;
    throw error;
  }

  return data;
}

export function notifySessionExpired(response, data) {
  if (
    [401, 403].includes(response.status) &&
    ["SESSION_REQUIRED", "SESSION_INVALID", "SESSION_TIMEOUT", "SESSION_MAX_LIFETIME"].includes(data?.code)
  ) {
    window.dispatchEvent(
      new CustomEvent("cricketclash:session-expired", {
        detail: { code: data.code, message: data.message },
      })
    );
  }
}

function sessionHeaders(extraHeaders = {}) {
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  return {
    ...extraHeaders,
    ...(sessionId ? { "X-CricketClash-Session": sessionId } : {}),
  };
}

async function authRequest(endpoint, options = {}) {
  const headers = sessionHeaders({ "Content-Type": "application/json", ...(options.headers || {}) });
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: "include", // also clears legacy cookie during migration
    headers,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    if (endpoint !== "/api/auth/activity") {
      notifySessionExpired(response, data);
    }
    const error = new Error(data.message || "Authentication request failed.");
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function registerUser(form) {
  return authRequest("/api/auth/register", { method: "POST", body: JSON.stringify(form) });
}

export async function loginUser(form) {
  // A login always creates a fresh session for this tab only.
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  const data = await authRequest("/api/auth/login", { method: "POST", body: JSON.stringify(form) });
  if (!data.sessionId) throw new Error("Login response did not include a session. Restart the backend and try again.");
  sessionStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
  sessionStorage.setItem("cc_last_activity", String(Date.now()));
  return data;
}

export function verifyEmailOtp(email, otp) {
  return authRequest("/api/auth/verify-otp", { method: "POST", body: JSON.stringify({ email, otp }) });
}

export function resendEmailOtp(email) {
  return authRequest("/api/auth/resend-otp", { method: "POST", body: JSON.stringify({ email }) });
}

export function requestPasswordReset(email) {
  return publicAuthRequest("/api/auth/forgot-password", { email });
}

export function resendPasswordResetOtp(email) {
  return publicAuthRequest("/api/auth/resend-password-reset-otp", { email });
}

export function verifyPasswordResetOtp(email, otp) {
  return publicAuthRequest("/api/auth/verify-password-reset-otp", { email, otp });
}

export function resetPassword({ email, resetToken, password, confirmPassword }) {
  return publicAuthRequest("/api/auth/reset-password", {
    email,
    resetToken,
    password,
    confirmPassword,
  });
}

export async function getCurrentUser(options = {}) {
  return authRequest("/api/auth/me", { method: "GET", cache: "no-store", ...options });
}

export async function saveNotificationPreferences(preferences) {
  return authRequest("/api/auth/settings/notifications", {
    method: "PATCH",
    body: JSON.stringify({ preferences }),
  });
}

export async function changeAccountPassword({ currentPassword, newPassword, confirmPassword }) {
  return authRequest("/api/auth/change-password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
  });
}

export async function recordSessionActivity() {
  return authRequest("/api/auth/activity", { method: "POST" });
}


export async function logoutCurrentSession() {
  // Capture the current session ID before clearing local storage.
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);

  try {
    const response = await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      headers: {
        ...(sessionId
          ? { "X-CricketClash-Session": sessionId }
          : {}),
      },
      credentials: "include",
      cache: "no-store",
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      // The server may return an empty response.
    }

    if (!response.ok || data.success !== true) {
      throw new Error(
        data.message || "The server could not complete logout."
      );
    }

    return data;
  } finally {
    // Always clear this tab's local session.
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem("cc_last_activity");
  }
}
