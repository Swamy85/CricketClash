export function filterAdminPublishedMatches(matches, { query = "", status = "all", format = "all" } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();
  return (Array.isArray(matches) ? matches : []).filter((match) => {
    if (match?.published !== true) return false;
    const searchable = [match.title, match.competition, match.teamA, match.teamB, match.format]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    return (!normalizedQuery || searchable)
      && (status === "all" || match.status === status)
      && (format === "all" || match.format === format);
  });
}

export function paginateItems(items, page, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  return {
    items: list.slice((safePage - 1) * size, safePage * size),
    page: safePage,
    pageCount,
    total: list.length,
  };
}
