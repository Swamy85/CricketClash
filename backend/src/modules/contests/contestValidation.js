
import mongoose from "mongoose";
import { unexpectedFields } from "../../middleware/requestSafety.js";

// Fixed contest configuration.
// Amounts are in INR and are configuration only.
// No payments or payouts are processed here.
export const CONTEST_TIERS = Object.freeze({
  FREE: {
    entryFee: 0,
    prizePool: 0,
  },
  BRONZE: {
    entryFee: 50,
    prizePool: 100,
  },
  SILVER: {
    entryFee: 100,
    prizePool: 200,
  },
  GOLD: {
    entryFee: 250,
    prizePool: 500,
  },
  PLATINUM: {
    entryFee: 500,
    prizePool: 1000,
  },
  DIAMOND: {
    entryFee: 1000,
    prizePool: 2000,
  },
  ELITE: {
    entryFee: 2500,
    prizePool: 5000,
  },
  CHAMPION: {
    entryFee: 5000,
    prizePool: 10000,
  },
});

export const PLATFORM_FEE_PERCENTAGE = 10;

// Validate contest creation.
// The client selects an existing match and fixed business-rule tier.
// The backend derives all monetary configuration.
export function validateCreateContest(input) {
  const errors = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Request body must be a valid object."],
    };
  }

  errors.push(...unexpectedFields(input, ["matchId", "tier", "name"]));

  const { matchId, tier } = input;
  const name = input.name === undefined ? "" : input.name;

  if (
    typeof matchId !== "string" ||
    !mongoose.isValidObjectId(matchId)
  ) {
    errors.push("A valid matchId is required.");
  }

  if (typeof tier !== "string" || !Object.hasOwn(CONTEST_TIERS, tier)) {
    errors.push(
      `Invalid contest tier. Allowed tiers: ${Object.keys(CONTEST_TIERS).join(", ")}.`
    );
  }

  if (typeof name !== "string" || name.trim().length > 80) {
    errors.push("Contest name must be text of at most 80 characters.");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: {
      matchId,
      tier,
      name: name.trim(),
      ...CONTEST_TIERS[tier],
      platformFeePercentage: PLATFORM_FEE_PERCENTAGE,
    },
  };
}

export function validateEditContest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, errors: ["Request body must be a valid object."] };
  }
  const errors = unexpectedFields(input, ["matchId", "tier", "name"]);
  if (!Object.keys(input).length) errors.push("Provide at least one contest field to update.");
  if (input.matchId !== undefined && (typeof input.matchId !== "string" || !mongoose.isValidObjectId(input.matchId))) {
    errors.push("A valid matchId is required.");
  }
  if (input.tier !== undefined && (typeof input.tier !== "string" || !Object.hasOwn(CONTEST_TIERS, input.tier))) {
    errors.push(`Invalid contest tier. Allowed tiers: ${Object.keys(CONTEST_TIERS).join(", ")}.`);
  }
  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80)) {
    errors.push("Contest name is required and must be at most 80 characters.");
  }
  return errors.length
    ? { valid: false, errors }
    : { valid: true, errors: [], data: input };
}

// Validate a player's team selection before attempting to join.
export function validateJoinContest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Request body must be a valid object."],
    };
  }

  const errors = unexpectedFields(input, ["selectedTeam", "matchId", "tier", "idempotencyKey"]);

  const { selectedTeam, matchId, tier, idempotencyKey } = input;

  if (!(typeof selectedTeam === "string" && ["A", "B"].includes(selectedTeam))) {
    errors.push('selectedTeam must be either "A" or "B".');
  }

  if (matchId !== undefined && (typeof matchId !== "string" || !mongoose.isValidObjectId(matchId))) {
    errors.push("A valid matchId is required.");
  }
  if (tier !== undefined && (typeof tier !== "string" || !Object.hasOwn(CONTEST_TIERS, tier))) {
    errors.push(`Invalid contest tier. Allowed tiers: ${Object.keys(CONTEST_TIERS).join(", ")}.`);
  }
  if ((matchId === undefined) !== (tier === undefined)) {
    errors.push("Both matchId and tier are required for automatic matchmaking.");
  }
  if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey))) {
    errors.push("A valid idempotencyKey is required.");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: { selectedTeam, ...(matchId ? { matchId, tier } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) },
  };
}
