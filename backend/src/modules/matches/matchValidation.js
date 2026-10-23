
import { unexpectedFields } from "../../middleware/requestSafety.js";

const FORMATS = ["T10", "T20", "ODI", "TEST", "HUNDRED"];
const STATUSES = ["upcoming", "live", "completed", "cancelled", "abandoned"];
const RESULTS = ["teamA", "teamB", "tie", "no_result", "abandoned", "cancelled"];

export function validateMatch(payload, { partial = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["Request body must be a valid object."];
  }

  const errors = [];
  errors.push(...unexpectedFields(payload, [
    "competition", "teamA", "teamB", "format", "status", "result", "startTime",
  ]));

  if (!partial || payload.competition !== undefined) {
    if (
      typeof payload.competition !== "string" ||
      !payload.competition.trim() ||
      payload.competition.trim().length > 100
    ) {
      errors.push("A valid competition is required.");
    }
  }

  if (!partial || payload.teamA !== undefined) {
    if (
      typeof payload.teamA !== "string" ||
      !payload.teamA.trim() ||
      payload.teamA.trim().length > 80
    ) {
      errors.push("Team A is required and must be at most 80 characters.");
    }
  }

  if (!partial || payload.teamB !== undefined) {
    if (
      typeof payload.teamB !== "string" ||
      !payload.teamB.trim() ||
      payload.teamB.trim().length > 80
    ) {
      errors.push("Team B is required and must be at most 80 characters.");
    }
  }

  if (payload.teamA && payload.teamB &&
      payload.teamA.trim().toLowerCase() ===
      payload.teamB.trim().toLowerCase()) {
    errors.push("Team A and Team B must be different.");
  }

  if (!partial || payload.format !== undefined) {
    if (payload.format !== undefined && !FORMATS.includes(payload.format)) {
      errors.push("Format must be T10, T20, ODI, TEST, or HUNDRED.");
    }
  }

  if (payload.status !== undefined &&
      !STATUSES.includes(payload.status)) {
    errors.push("Status must be upcoming, live, completed, cancelled, or abandoned.");
  }

  if (payload.result !== undefined &&
      payload.result !== null &&
      !RESULTS.includes(payload.result)) {
    errors.push("Result must identify Team A, Team B, a tie, no result, abandonment, or cancellation.");
  }

  if (payload.result !== undefined &&
      !["completed", "cancelled", "abandoned"].includes(payload.status || "")) {
    errors.push("A result can only be supplied when completing or cancelling a match.");
  }

  if (payload.status === "completed" &&
      !["teamA", "teamB", "tie", "no_result"].includes(payload.result)) {
    errors.push("A completed match requires an official result.");
  }

  if (!partial || payload.startTime !== undefined) {
    const date = typeof payload.startTime === "string"
      ? new Date(payload.startTime)
      : new Date(Number.NaN);

    if (
      !payload.startTime ||
      Number.isNaN(date.getTime())
    ) {
      errors.push("A valid match start time is required.");
    }
  }

  return errors;
}
