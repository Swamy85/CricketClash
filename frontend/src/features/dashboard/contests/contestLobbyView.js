function playerUserId(player) {
  const user = player?.user;
  return String(typeof user === "object" ? user?._id || "" : user || "");
}

export const DEFAULT_CONTEST_CATEGORY = "AVAILABLE";

export function getContestLobbyView(contests, { currentUserId, matchId, now = new Date() } = {}) {
  const matching = (Array.isArray(contests) ? contests : []).filter((contest) => {
    if (matchId && String(contest.match?._id || contest.match) !== String(matchId)) return false;
    const match = contest.match && typeof contest.match === "object" ? contest.match : null;
    const startTime = new Date(match?.startTime || 0).getTime();
    const expiresAt = new Date(contest.expiresAt || 0).getTime();
    if (match?.status !== "upcoming" || !Number.isFinite(startTime) || startTime <= now.getTime() || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
    return true;
  });

  const visible = matching.filter((contest) => {
    const players = Array.isArray(contest.players) ? contest.players : [];
    const joinedByUser = players.some((player) => playerUserId(player) === String(currentUserId || ""));
    if (contest.status !== "OPEN" || players.length !== 0 || joinedByUser) return false;
    if (["SETTLED", "REFUNDED"].includes(contest.settlementStatus)) return false;
    return true;
  });

  return visible.sort((left, right) => {
    const feeDifference = Number(left.entryFee || 0) - Number(right.entryFee || 0);
    if (feeDifference) return feeDifference;
    const leftStart = new Date(left.match?.startTime || 0).getTime();
    const rightStart = new Date(right.match?.startTime || 0).getTime();
    return leftStart - rightStart || String(left._id).localeCompare(String(right._id));
  });
}

export function getJoinedContestView(contests, matchId) {
  const rows = Array.isArray(contests) ? contests : [];
  // The API returns a player's newest joined entries first. Keep the main
  // Joined Contests view focused on that match; a matchId can select another.
  const selectedMatchId = matchId || String(rows[0]?.match?._id || rows[0]?.match || "");
  return rows.filter((contest) =>
    selectedMatchId && String(contest.match?._id || contest.match) === String(selectedMatchId)
  );
}

export function getJoinedContestStatus(contest, userPublicId) {
  const match = contest?.match && typeof contest.match === "object" ? contest.match : null;
  const winnerId = typeof contest?.winnerId === "object" ? contest.winnerId?.userId : contest?.winnerId;
  const settled = contest?.settlementStatus === "SETTLED";
  const won = settled && String(winnerId || "") === String(userPublicId || "");
  const lost = settled && Boolean(winnerId) && !won;
  const refunded = contest?.status === "REFUNDED" || contest?.settlementStatus === "REFUNDED";
  const paymentPending = Array.isArray(contest?.players) && contest.players.some((player) => player.entryPaymentStatus === "PENDING");
  const filled = Array.isArray(contest?.players) && contest.players.length >= 2;
  const label = refunded ? "Refunded" : won ? "Won" : lost ? "Lost" : match?.status === "live" ? "Live" : paymentPending ? "Confirming Entries" : filled ? "Contest Full" : contest?.status === "WAITING" ? "Waiting for Opponent" : contest?.status === "FULL" ? "Contest Full" : contest?.status || "Status unavailable";
  return { label, won, lost, refunded };
}
