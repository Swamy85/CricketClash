import test from "node:test";
import assert from "node:assert/strict";
import {
  assertContestTeamSelection,
  getAvailableContestTeams,
} from "../src/modules/contests/contestTeamSelection.js";

test("a half-filled contest locks India and permits only the opposing team", () => {
  const players = [{ selectedTeam: "A" }];
  assert.deepEqual(getAvailableContestTeams(players), ["B"]);
  assert.doesNotThrow(() => assertContestTeamSelection(players, "B"));
  assert.throws(() => assertContestTeamSelection(players, "A"), {
    status: 409,
    message: /already locked by the first player/,
  });
});

test("a half-filled contest locks Australia and permits only the opposing team", () => {
  const players = [{ selectedTeam: "B" }];
  assert.deepEqual(getAvailableContestTeams(players), ["A"]);
  assert.doesNotThrow(() => assertContestTeamSelection(players, "A"));
  assert.throws(() => assertContestTeamSelection(players, "B"), {
    status: 409,
    message: /already locked by the first player/,
  });
});

test("an empty contest allows either side, including repeated selection in a separate entry", () => {
  assert.deepEqual(getAvailableContestTeams([]), ["A", "B"]);
  assert.doesNotThrow(() => assertContestTeamSelection([], "A"));
  assert.doesNotThrow(() => assertContestTeamSelection([], "B"));
});
