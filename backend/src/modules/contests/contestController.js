
import {
  validateCreateContest,
  validateJoinContest,
} from "./contestValidation.js";

import {
  listOpenContests,
  listMyContests,
  joinContest,
  listAllContests,
  createContest,
  cancelContest,
  listLeaderboard,
} from "./contestService.js";
import mongoose from "mongoose";
import WalletTransaction from "../../models/WalletTransaction.js";
import PlatformLedgerEntry from "../../models/PlatformLedgerEntry.js";
import Contest from "../../models/Contest.js";
import { parseBoundedInteger, unexpectedFields } from "../../middleware/requestSafety.js";

function sendError(res, error) {
  const status = error.status || 500;

  if (status === 500) {
    console.error("Contest API error:", error);
  }

  return res.status(status).json({
    success: false,
    message:
      status === 500
        ? "An unexpected contest error occurred."
        : error.message,
  });
}

export async function getOpenContests(req, res) {
  try {
    const contests = await listOpenContests();
    return res.json({
      success: true,
      currentUserId: String(req.user._id),
      contests,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getMyContests(req, res) {
  try {
    const contests = await listMyContests(req.user._id);
    return res.json({ success: true, contests });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getLeaderboard(req, res) {
  const unknownFields = unexpectedFields(req.query, ["limit"]);
  if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
  const limit = parseBoundedInteger(req.query.limit, { max: 1000, defaultValue: 100 });
  if (limit === null) return res.status(400).json({ success: false, message: '"limit" must be an integer between 1 and 1000.' });
  try {
    const leaderboard = await listLeaderboard(limit);
    return res.json({ success: true, leaderboard });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postJoinContest(req, res) {
  const validation = validateJoinContest(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: validation.errors.join(" "),
      errors: validation.errors,
    });
  }

  if (!validation.data.idempotencyKey) {
    return res.status(400).json({ success: false, message: "An idempotencyKey is required so retries cannot create duplicate entries." });
  }

  try {
    let target = validation.data;
    if (!target.matchId && req.params.id) {
      const selectedContest = await Contest.findById(req.params.id).select("match tier").lean();
      if (!selectedContest) return res.status(404).json({ success: false, message: "Contest not found." });
      target = { ...target, matchId: String(selectedContest.match), tier: selectedContest.tier };
    }
    if (!target.matchId || !target.tier) {
      return res.status(400).json({ success: false, message: "matchId and tier are required for automatic matchmaking." });
    }
    const result = await joinContest({
      matchId: target.matchId,
      tier: target.tier,
      idempotencyKey: target.idempotencyKey,
      userId: req.user._id,
      selectedTeam: validation.data.selectedTeam,
    });

    const serializedContest = result.contest?.toObject
      ? result.contest.toObject()
      : result.contest;
    const safeContest = serializedContest
      ? {
          ...serializedContest,
          players: (serializedContest.players || []).map(({ joinRequestId, ...player }) => player),
        }
      : serializedContest;

    return res.json({
      success: true,
      message: "You were assigned to a contest automatically.",
      ...result,
      contest: safeContest,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getAdminContests(req, res) {
  try {
    const contests = await listAllContests();
    return res.json({ success: true, contests });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function getContestLedger(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid contest ID.",
    });
  }

  try {
    const [walletEntries, platformEntries] = await Promise.all([
      WalletTransaction.find({ contest: req.params.id })
        .populate("user", "userId username")
        .populate("initiatedBy", "userId username")
        .populate("reversesTransaction", "reference type")
        .sort({ createdAt: 1 })
        .lean(),
      PlatformLedgerEntry.find({ contest: req.params.id })
        .populate("initiatedBy", "userId username")
        .populate("reversesEntry", "reference type")
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    return res.json({
      success: true,
      walletEntries,
      platformEntries,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function postCreateContest(req, res) {
  const validation = validateCreateContest(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: validation.errors.join(" "),
      errors: validation.errors,
    });
  }

  try {
    const contest = await createContest({
      ...validation.data,
      createdBy: req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: "Contest created successfully.",
      contest,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function patchCancelContest(req, res) {
  const unknownFields = unexpectedFields(req.body ?? {}, ["reason"]);
  if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
  if (req.body?.reason !== undefined && typeof req.body.reason !== "string") {
    return res.status(400).json({ success: false, message: "Cancellation reason must be text." });
  }
  try {
    const contest = await cancelContest(
      req.params.id,
      req.body?.reason || "ADMIN_CANCELLED"
    );

    return res.json({
      success: true,
      message: "Contest cancelled successfully.",
      contest,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
