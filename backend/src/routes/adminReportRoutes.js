import { Router } from "express";
import Contest from "../models/Contest.js";
import Match from "../models/Match.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import PlatformLedgerEntry from "../models/PlatformLedgerEntry.js";
import { createAdminReportsService } from "../services/adminReportsService.js";

const router = Router();
const reports = createAdminReportsService({ Contest, Match, User, WalletTransaction, PlatformLedgerEntry });
const send = (res, result) => res.status(result.status).json({ success: result.status < 400, ...(result.data ? { data: result.data } : { message: result.message }) });
const OVERVIEW_FIELDS = new Set(["from", "to", "group"]);
const LIST_FIELDS = new Set(["from", "to", "page", "limit", "search", "status", "matchId", "entryFee", "type"]);

function hasUnexpectedQuery(req, res, allowed) {
  const unexpected = Object.keys(req.query).find((key) => !allowed.has(key));
  if (!unexpected) return false;
  res.status(400).json({ success: false, message: `Unexpected query parameter: ${unexpected}.` });
  return true;
}

router.get("/overview", async (req, res, next) => {
  if (hasUnexpectedQuery(req, res, OVERVIEW_FIELDS)) return;
  try { send(res, await reports.overview(req.query)); } catch (error) { next(error); }
});

router.get("/:type", async (req, res, next) => {
  if (hasUnexpectedQuery(req, res, LIST_FIELDS)) return;
  try { send(res, await reports.list(req.query, req.params.type)); } catch (error) { next(error); }
});

export default router;
