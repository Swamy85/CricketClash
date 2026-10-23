import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortProviderMatches, countProviderMatches } from "../src/features/dashboard/matches/liveMatchCenterUtils.js";

const fixtures = [
  { externalId: "later", teamA: "Later A", teamB: "Later B", category: "upcoming", startTime: "2030-01-03T15:00:00Z" },
  { externalId: "tomorrow", teamA: "Tomorrow A", teamB: "Tomorrow B", category: "upcoming", startTime: "2030-01-02T15:00:00Z" },
  { externalId: "final", teamA: "Final A", teamB: "Final B", category: "completed", startTime: "2030-01-01T15:00:00Z" },
];

test("upcoming fixtures sort by scheduled time, nearest first", () => {
  assert.deepEqual(filterAndSortProviderMatches(fixtures, { category: "upcoming" }).map((match) => match.externalId), ["tomorrow", "later"]);
});

test("sorting can reverse chronological fixture order and search remains category-scoped", () => {
  assert.deepEqual(filterAndSortProviderMatches(fixtures, { category: "upcoming", sort: "latest" }).map((match) => match.externalId), ["later", "tomorrow"]);
  assert.deepEqual(filterAndSortProviderMatches(fixtures, { category: "upcoming", query: "final" }), []);
});

test("category counts keep live, upcoming, and completed matches separate", () => {
  assert.deepEqual(countProviderMatches([...fixtures, { externalId: "live", category: "live" }]), { live: 1, upcoming: 2, completed: 1, uncertain: 0 });
});
