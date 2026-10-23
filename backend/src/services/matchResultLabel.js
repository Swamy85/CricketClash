export function formatMatchResult(match, result = match?.result) {
  if (result === "teamA") return `${match?.teamA || "Team A"} won`;
  if (result === "teamB") return `${match?.teamB || "Team B"} won`;
  if (result === "tie") return "Match tied";
  if (result === "no_result") return "No result";
  if (result === "abandoned") return "Match abandoned";
  if (result === "cancelled") return "Match cancelled";
  return "Result unavailable";
}
