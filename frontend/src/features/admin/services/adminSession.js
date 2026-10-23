
import { ADMIN_SESSION_KEY } from "../../auth/services/sessionKeys.js";

export function getAdminSession() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY);
}

export function saveAdminSession(sessionId) {
  sessionStorage.setItem(ADMIN_SESSION_KEY, sessionId);
}

export function clearAdminSession() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

export async function adminFetch(path, options = {}) {
  const sessionId = getAdminSession();

  const response = await fetch(
    `${import.meta.env.VITE_API_URL || "http://localhost:5000"}${path}`,
    {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(sessionId
          ? { "X-CricketClash-Session": sessionId }
          : {}),
      },
      cache: "no-store",
    }
  );

  if ([401, 403].includes(response.status)) {
    window.dispatchEvent(
      new CustomEvent("cricketclash:admin-session-expired")
    );
  }

  return response;
}
