import test from "node:test";
import assert from "node:assert/strict";
import { filterAdminPublishedMatches, paginateItems } from "../src/features/admin/utils/adminMatchListUtils.js";

const matches = [
  { _id: "p1", published: true, status: "upcoming", format: "T20", teamA: "India", teamB: "Australia" },
  { _id: "p2", published: true, status: "live", format: "ODI", teamA: "England", teamB: "India" },
  { _id: "p3", published: true, status: "completed", format: "T20", teamA: "Sri Lanka", teamB: "Pakistan" },
  { _id: "hidden", published: false, status: "upcoming", format: "T20", teamA: "Hidden A", teamB: "Hidden B" },
  { _id: "legacy", status: "upcoming", format: "T20", teamA: "Legacy A", teamB: "Legacy B" },
];

test("admin match search and status/format filters only return published matches", () => {
  assert.deepEqual(filterAdminPublishedMatches(matches).map((match) => match._id), ["p1", "p2", "p3"]);
  assert.deepEqual(filterAdminPublishedMatches(matches, { status: "upcoming" }).map((match) => match._id), ["p1"]);
  assert.deepEqual(filterAdminPublishedMatches(matches, { format: "T20", query: "india" }).map((match) => match._id), ["p1"]);
});

test("admin match pagination is based on the filtered published rows", () => {
  const filtered = filterAdminPublishedMatches(matches);
  const second = paginateItems(filtered, 2, 2);
  assert.deepEqual(second.items.map((match) => match._id), ["p3"]);
  assert.equal(second.total, 3);
  assert.equal(second.pageCount, 2);
});
