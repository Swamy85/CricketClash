export function getAvailableContestTeams(players = []) {
  if (!Array.isArray(players) || players.length === 0) return ["A", "B"];
  if (players.length !== 1) return [];
  return players[0].selectedTeam === "A" ? ["B"] : players[0].selectedTeam === "B" ? ["A"] : [];
}

export function assertContestTeamSelection(players, selectedTeam) {
  const availableTeams = getAvailableContestTeams(players);
  if (!availableTeams.includes(selectedTeam)) {
    const error = new Error(
      players?.length === 1
        ? "That team is already locked by the first player. Choose the opposite team, or join an empty contest to choose either side."
        : "This contest is full and cannot accept another player."
    );
    error.status = 409;
    throw error;
  }
}
