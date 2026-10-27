const paidEntryStates = new Set(["PAID", "NOT_REQUIRED"]);

function createdAtTime(contest) {
  const value = new Date(contest.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function idOrder(contest) {
  return String(contest._id || "");
}

function playerId(player) {
  return String(player?.user?._id || player?.user || "");
}

/**
 * Select the shared lobby view: the oldest paid half-filled contest for each
 * selected side, plus one empty contest per upcoming match and tier.
 * Historical and full contests remain stored and are read by other endpoints.
 */
export function selectVisibleOpenContests(contests, now = new Date()) {
  const eligible = (Array.isArray(contests) ? contests : []).filter((contest) => {
    const match = contest.match && typeof contest.match === "object" ? contest.match : null;
    const expiresAt = new Date(contest.expiresAt).getTime();
    const matchStart = new Date(match?.startTime).getTime();
    return match
      && match.published === true
      && match.status === "upcoming"
      && !["live", "result"].includes(String(match.providerState || "").toLowerCase())
      && Number.isFinite(matchStart)
      && matchStart > now.getTime()
      && Number.isFinite(expiresAt)
      && expiresAt > now.getTime()
      && !contest.entryClosedAt
      && !["SETTLED", "REFUNDED"].includes(contest.settlementStatus)
      && ["OPEN", "WAITING"].includes(contest.status);
  }).sort((left, right) =>
    createdAtTime(left) - createdAtTime(right) || idOrder(left).localeCompare(idOrder(right))
  );

  const selected = [];
  const groups = new Map();
  for (const contest of eligible) {
    const matchId = String(contest.match._id || contest.match);
    const key = `${matchId}:${contest.tier}`;
    if (!groups.has(key)) groups.set(key, { empty: false, sides: new Set() });
    const group = groups.get(key);
    const players = Array.isArray(contest.players) ? contest.players : [];

    // Participant state is authoritative for slot availability. A stale
    // OPEN/WAITING status must never expose a contest with two entries.
    if (players.length >= 2) continue;

    if (contest.status === "OPEN" && players.length === 0) {
      if (!group.empty) {
        group.empty = true;
        selected.push(contest);
      }
      continue;
    }

    if (contest.status !== "WAITING" || players.length !== 1) continue;
    const player = players[0];
    if (!paidEntryStates.has(player.entryPaymentStatus)) continue;
    if (!playerId(player) || (players[1] && playerId(players[1]) === playerId(player))) continue;
    if (!["A", "B"].includes(player.selectedTeam) || group.sides.has(player.selectedTeam)) continue;
    group.sides.add(player.selectedTeam);
    selected.push(contest);
  }

  return selected.sort((left, right) => {
    const leftStart = new Date(left.match.startTime).getTime();
    const rightStart = new Date(right.match.startTime).getTime();
    return leftStart - rightStart
      || String(left.match._id || left.match).localeCompare(String(right.match._id || right.match))
      || String(left.tier).localeCompare(String(right.tier))
      || (left.players?.length || 0) - (right.players?.length || 0)
      || createdAtTime(left) - createdAtTime(right);
  });
}
