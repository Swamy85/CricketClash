
import {
  listMatches,
  listAdminMatches,
  listAdminMatchPublicationStatus,
  getAdminMatchCounts,
  getMatchById,
  createMatch,
  updateMatch,
  deleteMatch,
  publishAdminMatch,
} from "./matchService.js";

import { validateMatch } from "./matchValidation.js";
import { correctMatchResult } from "./matchCorrectionService.js";
import { parseBoundedInteger, unexpectedFields } from "../../middleware/requestSafety.js";

function sendError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;

  return res.status(status).json({
    success: false,
    message: status < 500
      ? error.message
      : fallbackMessage,
  });
}

export async function getMatches(req, res) {
  try {
    const matches = await listMatches();
    return res.json({ success: true, matches });
  } catch (error) {
    return sendError(res, error, "Could not fetch matches.");
  }
}

export async function getAdminMatches(req, res) {
  try {
    const unknownFields = unexpectedFields(req.query, ["recent", "limit"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    if (req.query.recent !== undefined && !["true", "false"].includes(req.query.recent)) {
      return res.status(400).json({ success: false, message: '"recent" must be true or false.' });
    }
    const recent = req.query.recent === "true";
    const limit = parseBoundedInteger(req.query.limit, { max: 1000, defaultValue: 1000 });
    if (limit === null) return res.status(400).json({ success: false, message: '"limit" must be an integer between 1 and 1000.' });
    const [matches, counts] = await Promise.all([
      listAdminMatches({ recent, limit }),
      getAdminMatchCounts(),
    ]);
    return res.json({ success: true, matches, counts });
  } catch (error) {
    return sendError(res, error, "Could not fetch matches.");
  }
}

export async function getAdminMatchPublicationStatus(req, res) {
  try {
    const matches = await listAdminMatchPublicationStatus();
    return res.json({ success: true, matches });
  } catch (error) {
    return sendError(res, error, "Could not fetch match publication status.");
  }
}

export async function postPublishAdminMatch(req, res) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ success: false, message: "Administrator access required." });
  }
  const unknownFields = unexpectedFields(req.body || {}, []);
  if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
  try {
    const match = await publishAdminMatch(req.params.id, req.user._id);
    return res.json({
      success: true,
      message: "Match published and all eight contest tiers are ready.",
      match,
      tiers: match.automaticContestTiers,
    });
  } catch (error) {
    return sendError(res, error, error.status === 503
      ? "Match publication or tier setup is incomplete. Retry Publish Match; existing queues will be reused."
      : "Could not publish match.");
  }
}

export async function getMatch(req, res) {
  try {
    const match = await getMatchById(req.params.id);
    return res.json({ success: true, match });
  } catch (error) {
    return sendError(res, error, "Could not fetch match.");
  }
}

export async function postMatch(req, res) {
  const errors = validateMatch(req.body || {});

  if (errors.length) {
    return res.status(400).json({
      success: false,
      message: errors[0],
      errors,
    });
  }

  try {
    const match = await createMatch(req.body, req.user._id);
    return res.status(201).json({
      success: true,
      message: "Match created successfully.",
      match,
    });
  } catch (error) {
    return sendError(res, error, "Could not create match.");
  }
}

export async function patchMatch(req, res) {
  const errors = validateMatch(req.body || {}, {
    partial: true,
  });

  if (errors.length) {
    return res.status(400).json({
      success: false,
      message: errors[0],
      errors,
    });
  }

  if (!Object.keys(req.body || {}).length) {
    return res.status(400).json({
      success: false,
      message: "Provide at least one field to update.",
    });
  }

  try {
    const match = await updateMatch(req.params.id, req.body);
    return res.json({
      success: true,
      message: "Match updated successfully.",
      match,
    });
  } catch (error) {
    return sendError(res, error, "Could not update match.");
  }
}

export async function removeMatch(req, res) {
  try {
    await deleteMatch(req.params.id);
    return res.json({
      success: true,
      message: "Match deleted successfully.",
    });
  } catch (error) {
    return sendError(res, error, "Could not delete match.");
  }
}

export async function postCorrectMatchResult(req, res) {
  const unknownFields = unexpectedFields(req.body, ["result", "reason"]);
  if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
  const { result, reason } = req.body || {};

  if (!["teamA", "teamB", "tie", "no_result"].includes(result)) {
    return res.status(400).json({
      success: false,
      message: "Select Team A, Team B, tie, or no result.",
    });
  }

  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500) {
    return res.status(400).json({
      success: false,
      message: "A correction reason of at most 500 characters is required.",
    });
  }

  try {
    const match = await correctMatchResult({
      matchId: req.params.id,
      result,
      reason: reason.trim(),
      adminId: req.user._id,
    });

    return res.json({
      success: true,
      message: "The result correction was applied and contest settlements were recalculated.",
      match,
    });
  } catch (error) {
    return sendError(res, error, "Could not correct the match result.");
  }
}
