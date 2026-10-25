
import { unexpectedFields } from "../../middleware/requestSafety.js";

const FORMATS = ["T10", "T20", "ODI", "TEST", "HUNDRED"];
const STATUSES = ["upcoming", "live", "completed", "cancelled", "abandoned"];
const RESULTS = ["teamA", "teamB", "tie", "no_result", "abandoned", "cancelled"];
const CONTEST_TIERS = ["FREE", "BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND", "ELITE", "CHAMPION"];

export function validateMatch(payload, { partial = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["Request body must be a valid object."];
  }

  const errors = [];
  errors.push(...unexpectedFields(payload, [
    "competition", "title", "imageUrl", "teamA", "teamB", "format", "status", "result", "startTime",
    "automaticContestGeneration", "automaticContestTiers",
    "creationRequestId",
  ]));

  if (payload.creationRequestId !== undefined
    && (typeof payload.creationRequestId !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(payload.creationRequestId))) {
    errors.push("Match creation request ID must contain 16 to 100 letters, numbers, underscores, or hyphens.");
  }
  if (partial && payload.creationRequestId !== undefined) {
    errors.push("Match creation request ID can only be supplied when creating a match.");
  }

  if (payload.automaticContestGeneration !== undefined && typeof payload.automaticContestGeneration !== "boolean") {
    errors.push("Automatic contest generation must be enabled or disabled.");
  }

  if (payload.automaticContestTiers !== undefined) {
    if (!Array.isArray(payload.automaticContestTiers)
      || payload.automaticContestTiers.some((tier) => !CONTEST_TIERS.includes(tier))
      || new Set(payload.automaticContestTiers).size !== payload.automaticContestTiers.length) {
      errors.push(`Automatic contest templates must be unique supported tiers: ${CONTEST_TIERS.join(", ")}.`);
    }
    if (Array.isArray(payload.automaticContestTiers)
      && payload.automaticContestTiers.length === 0
      && payload.automaticContestGeneration !== false) {
      errors.push("Choose at least one automatic contest template or disable automatic contest generation.");
    }
  }

  if (payload.title !== undefined && (typeof payload.title !== "string" || payload.title.trim().length > 140)) {
    errors.push("Match title must be text of at most 140 characters.");
  }

  if (payload.imageUrl !== undefined) {
    if (typeof payload.imageUrl !== "string" || payload.imageUrl.length > 500) {
      errors.push("Match image URL must be at most 500 characters.");
    } else if (payload.imageUrl.trim()) {
      try {
        const imageUrl = new URL(payload.imageUrl.trim());
        if (!["http:", "https:"].includes(imageUrl.protocol)) errors.push("Match image URL must use HTTP or HTTPS.");
      } catch {
        errors.push("Provide a valid match image URL.");
      }
    }
  }

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
