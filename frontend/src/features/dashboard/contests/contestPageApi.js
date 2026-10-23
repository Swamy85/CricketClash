import { notifySessionExpired } from "../../auth/services/authService";

const API_BASE = `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api`;

export async function fetchContestPageData(path, signal) {
  const sessionId = sessionStorage.getItem("cc_session_id");
  if (!sessionId) {
    const error = new Error("Your session has expired. Please sign in again.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "X-CricketClash-Session": sessionId },
    signal,
    cache: "no-store",
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  notifySessionExpired(response, data);
  if ([401, 403].includes(response.status)) {
    const error = new Error("Your session has expired. Please sign in again.");
    error.status = response.status;
    throw error;
  }
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Unable to load contest details.");
  }
  return data;
}

export function formatContestCoins(value) {
  return `${Number(value ?? 0).toLocaleString("en-IN")} coins`;
}

export function matchResultLabel(match) {
  if (match?.result === "teamA") return `${match.teamA} won`;
  if (match?.result === "teamB") return `${match.teamB} won`;
  if (match?.result === "tie") return "Match tied";
  if (match?.result === "no_result") return "No result";
  if (match?.result === "abandoned") return "Match abandoned";
  if (match?.result === "cancelled") return "Match cancelled";
  return "No official result";
}
