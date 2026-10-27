import test from "node:test";
import assert from "node:assert/strict";
import { filterAndSortProviderMatches, countProviderMatches, selectLiveCenterMatches } from "../src/features/dashboard/matches/liveMatchCenterUtils.js";

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

test("tournament filter keeps matches from the selected series", () => {
  const tournamentMatches = [
    { externalId: "league-a", category: "upcoming", series: "Premier League", startTime: "2030-01-02T15:00:00Z" },
    { externalId: "league-b", category: "upcoming", series: "County Cup", startTime: "2030-01-03T15:00:00Z" },
  ];
  assert.deepEqual(filterAndSortProviderMatches(tournamentMatches, { category: "upcoming", tournament: "premier league" }).map((match) => match.externalId), ["league-a"]);
});

test("category counts keep live, upcoming, and completed matches separate", () => {
  assert.deepEqual(countProviderMatches([...fixtures, { externalId: "live", category: "live" }]), { live: 1, upcoming: 2, completed: 1, uncertain: 0 });
});

test("admin Live Match Center keeps the entire provider feed while user mode only shows published matches", () => {
  const internal = [{ providerId: "tomorrow", published: false }, { providerId: "final", published: true }];
  assert.deepEqual(selectLiveCenterMatches(fixtures, internal, false), fixtures);
  assert.deepEqual(selectLiveCenterMatches(fixtures, internal, true).map((match) => match.externalId), ["final"]);
});
