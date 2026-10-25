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
    if (joinedByUser || players.length > 1) return false;
    if (contest.status === "OPEN" && players.length !== 0) return false;
    if (contest.status === "WAITING" && (players.length !== 1 || !["PAID", "NOT_REQUIRED"].includes(players[0].entryPaymentStatus))) return false;
    if (!["OPEN", "WAITING"].includes(contest.status)) return false;
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
  const matching = rows.filter((contest) => {
    const match = contest.match && typeof contest.match === "object" ? contest.match : null;
    const status = String(match?.status || "").toLowerCase();
    const contestMatchId = String(match?._id || contest.match || "");
    return ["upcoming", "live"].includes(status) && (!matchId || contestMatchId === String(matchId));
  });
  if (matchId || matching.length === 0) return matching;
  const newestMatchId = String(matching[0].match?._id || matching[0].match || "");
  return matching.filter((contest) => String(contest.match?._id || contest.match || "") === newestMatchId);
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
