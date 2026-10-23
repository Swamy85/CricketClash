export function filterAndSortProviderMatches(matches, { category, query = "", sort = "soonest" }) {
  const normalizedQuery = query.trim().toLowerCase();
  return (Array.isArray(matches) ? matches : [])
    .filter((match) => match.category === category && (!normalizedQuery || [match.teamA, match.teamB, match.series, match.format, match.status].some((value) => String(value || "").toLowerCase().includes(normalizedQuery))))
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
