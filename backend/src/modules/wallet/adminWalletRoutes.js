import { Router } from "express";
import mongoose from "mongoose";
import { creditWallet, debitWallet } from "./walletService.js";
import { unexpectedFields } from "../../middleware/requestSafety.js";

const router = Router();

router.post("/:userId/adjustments", async (req, res) => {
  const unknownFields = unexpectedFields(req.body, ["amount", "direction", "reason", "reference"]);
  if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
  const { amount, direction, reason, reference } = req.body || {};

  if (!mongoose.isValidObjectId(req.params.userId)) {
    return res.status(400).json({ success: false, message: "Invalid user ID." });
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Amount must be a positive whole number of coins.",
    });
  }

  if (!["CREDIT", "DEBIT"].includes(direction)) {
    return res.status(400).json({
      success: false,
      message: 'Direction must be "CREDIT" or "DEBIT".',
    });
  }

  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 400) {
    return res.status(400).json({
      success: false,
      message: "A reason of at most 400 characters is required.",
    });
  }

  if (
    typeof reference !== "string" ||
    !reference.trim() ||
    reference.trim().length > 120
  ) {
    return res.status(400).json({
      success: false,
      message: "A unique reference of at most 120 characters is required.",
    });
  }

  try {
    const operation = direction === "CREDIT" ? creditWallet : debitWallet;
    const transaction = await operation({
      userId: req.params.userId,
      amount,
      reference: `admin-adjustment:${req.user._id}:${reference.trim()}`,
      type: "ADMIN_ADJUSTMENT",
      initiatedBy: req.user._id,
      description: reason.trim(),
    });

    return res.json({
      success: true,
      message: "Wallet adjustment recorded.",
      transaction,
    });
  } catch (error) {
    const status =
      error.message === "Insufficient available coins." ? 409 : 500;

    if (status === 500) {
      console.error("Admin wallet adjustment failed:", error);
    }

    return res.status(status).json({
      success: false,
      message:
        status === 500
          ? "Unable to apply wallet adjustment."
          : error.message,
    });
  }
});

export default router;
