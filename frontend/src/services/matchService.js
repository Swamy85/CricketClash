
const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

export async function getMatches({ signal } = {}) {
  const response = await fetch(`${API_URL}/api/matches`, {
    method: "GET",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error("Unable to load matches. Please retry.");
  }

  const data = await response.json();

  return Array.isArray(data.matches) ? data.matches : [];
}

export async function getTeamCatalog({ signal } = {}) {
  const response = await fetch(`${API_URL}/api/teams`, {
    method: "GET",
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error("Unable to load the team catalog.");
  }

  const data = await response.json();
  return Array.isArray(data.teams) ? data.teams : [];
}
