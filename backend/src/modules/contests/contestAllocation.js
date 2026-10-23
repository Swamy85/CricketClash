export function buildCompatibleContestQuery({ matchId, tier, entryFee, prizePool, userId, selectedTeam, now }) {
  return {
    match: matchId,
    tier,
    entryFee,
    prizePool,
    status: "WAITING",
    expiresAt: { $gt: now },
    "players.0.selectedTeam": selectedTeam === "A" ? "B" : "A",
    // PENDING reserves an entry whose wallet transaction is in flight. The
    // second player can safely claim the slot; a failed debit removes only
    // its own reservation and leaves the other player's paid entry waiting.
    "players.0.entryPaymentStatus": { $in: ["PAID", "NOT_REQUIRED", "PENDING"] },
    "players.1": { $exists: false },
    "players.user": { $ne: userId },
  };
}

export function buildEmptyContestQuery({ matchId, tier, entryFee, prizePool, userId, now }) {
  return {
    match: matchId,
    tier,
    entryFee,
    prizePool,
    status: "OPEN",
    expiresAt: { $gt: now },
    "players.0": { $exists: false },
    "players.user": { $ne: userId },
  };
}
