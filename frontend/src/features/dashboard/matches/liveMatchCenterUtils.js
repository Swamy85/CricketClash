export function filterAndSortProviderMatches(matches, { category, query = "", sort = "soonest", tournament = "" }) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTournament = tournament.trim().toLowerCase();
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => match.category === category
      && (!normalizedTournament || String(match.series || "").trim().toLowerCase() === normalizedTournament)
      && (!normalizedQuery || [match.teamA, match.teamB, match.series, match.format, match.status].some((value) => String(value || "").toLowerCase().includes(normalizedQuery))))
    .slice()
    .sort((left, right) => {
      const leftTime = left.startTime ? new Date(left.startTime).getTime() : Number.NaN;
      const rightTime = right.startTime ? new Date(right.startTime).getTime() : Number.NaN;
      const leftValid = Number.isFinite(leftTime);
      const rightValid = Number.isFinite(rightTime);
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      const difference = sort === "soonest" ? leftTime - rightTime : rightTime - leftTime;
      return difference || String(left.externalId || "").localeCompare(String(right.externalId || ""));
    });
}

export function countProviderMatches(matches) {
  return Object.fromEntries(["live", "upcoming", "completed", "uncertain"].map((category) => [category, (Array.isArray(matches) ? matches : []).filter((match) => match.category === category).length]));
}

export function selectLiveCenterMatches(providerMatches, internalMatches, userView = false) {
  const feed = Array.isArray(providerMatches) ? providerMatches : [];
  if (!userView) return feed;
  const internal = Array.isArray(internalMatches) ? internalMatches : [];
  return feed.filter((providerMatch) => {
    const byProviderId = internal.find((match) => match.providerId && match.providerId === providerMatch.externalId);
    if (byProviderId) return byProviderId.published === true;
    const providerStart = new Date(providerMatch.startTime || 0).getTime();
    return internal.some((match) => {
      if (match.published !== true) return false;
      const sameTeams = (match.teamA === providerMatch.teamA && match.teamB === providerMatch.teamB)
        || (match.teamA === providerMatch.teamB && match.teamB === providerMatch.teamA);
      return sameTeams && Math.abs(new Date(match.startTime).getTime() - providerStart) < 60_000;
    });
  });
}
