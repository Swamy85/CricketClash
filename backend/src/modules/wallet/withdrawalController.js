
import mongoose from "mongoose";
import Withdrawal from "../../models/Withdrawal.js";
import WalletTransaction from "../../models/WalletTransaction.js";

import {
  createWithdrawalRequest,
  startWithdrawalProcessing,
  completeWithdrawal,
  failWithdrawal,
} from "./withdrawalService.js";

import { getWallet } from "./walletService.js";
import { unexpectedFields } from "../../middleware/requestSafety.js";
import {
  retryAdminRequestNotification,
  sendAdminRequestNotification,
} from "../../services/adminRequestEmailService.js";

function sendError(res, error) {
  const message = error.message || "An unexpected error occurred.";

  const clientErrors = [
    "A valid user ID is required.",
    "A valid withdrawal ID is required.",
    "A valid request reference is required.",
    "Withdrawal amount must be a positive whole number of coins.",
    "Insufficient available coins.",
    "Withdrawal not found.",
    "Only processing withdrawals can be completed.",
    "This withdrawal cannot be failed or rejected.",
    "A verified payout reference is required.",
    "A failure or rejection reason is required.",
    "Wallet reservation is inconsistent.",
    "Pending withdrawal ledger entry not found.",
    "Withdrawal details are required.",
    "Enter your full name.",
    "Enter a valid 10-digit mobile number.",
    "Select UPI or Bank Transfer.",
    "Enter a valid UPI ID.",
    "Enter the bank account holder name.",
    "Enter a valid bank account number.",
    "Enter a valid IFSC code.",
    "Enter the bank name.",
    "Wallet not found.",
    "This request reference was already used.",
    "Withdrawal was completed with a different reference.",
    "Withdrawal already has a different final status.",
    "Withdrawal status changed unexpectedly.",
  ];

  const status = clientErrors.includes(message) ? 400 : 500;

  return res.status(status).json({
    success: false,
    message:
      status === 500 ? "Unable to process the request." : message,
  });
}

export async function getMyWallet(req, res) {
  try {
    const wallet = await getWallet(req.user._id);

    return res.status(200).json({
      success: true,
      wallet,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Unable to load wallet.",
    });
  }
}

export async function getMyTransactions(req, res) {
  try {
    const transactions = await WalletTransaction.find({ user: req.user._id })
      .select("type amount direction status reference description contest initiatedBy createdAt processedAt")
      .populate("contest", "tier match")
      .populate("initiatedBy", "userId username")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error("Unable to load wallet transaction history:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load wallet transaction history.",
    });
  }
}

export async function requestWithdrawal(req, res) {
  let withdrawal;

  try {
    const unknownFields = unexpectedFields(req.body, ["coinAmount", "reference", "payoutDetails"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    if (req.body?.payoutDetails && typeof req.body.payoutDetails === "object" && !Array.isArray(req.body.payoutDetails)) {
      const payoutFields = unexpectedFields(req.body.payoutDetails, ["fullName", "mobileNumber", "method", "upiId", "accountHolderName", "accountNumber", "ifscCode", "bankName"]);
      if (payoutFields.length) return res.status(400).json({ success: false, message: payoutFields[0] });
    }
    const { coinAmount, reference, payoutDetails } = req.body || {};

    withdrawal = await createWithdrawalRequest({
      userId: req.user._id,
      coinAmount,
      reference,
      payoutDetails,
    });
    let notification;
    try {
      notification = await sendAdminRequestNotification("withdrawal", withdrawal._id);
    } catch (error) {
      console.error("Withdrawal request saved; email status update failed.", {
        requestId: String(withdrawal._id),
        code: String(error?.code || "EMAIL_STATUS_UPDATE_FAILED").slice(0, 80),
      });
      notification = { status: "FAILED" };
    }

    return res.status(201).json({
      success: true,
      message: notification.status === "SENT"
        ? "Withdrawal request submitted."
        : "Withdrawal request submitted. Admin email notification is pending retry.",
      withdrawal,
    });
  } catch (error) {
    return sendError(res, error);
  }

}

export async function retryWithdrawalNotification(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "A valid withdrawal ID is required." });
    }
    const result = await retryAdminRequestNotification("withdrawal", req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, message: "Withdrawal not found." });
    }
    return res.status(200).json({
      success: true,
      status: result.status,
      message: result.status === "SENT"
        ? "Admin email notification sent."
        : result.status === "SENDING"
          ? "Admin email notification is already being sent."
          : "Admin email notification failed and will be retried.",
    });
  } catch (error) {
    console.error("Retry withdrawal notification error:", error);
    return res.status(500).json({ success: false, message: "Unable to retry the email notification." });
  }
}

export async function getMyWithdrawals(req, res) {
  try {
    const withdrawals = await Withdrawal.find({
      user: req.user._id,
    })
      .select("-payoutDetails.accountNumber")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      withdrawals,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Unable to load withdrawal history.",
    });
  }
}

export async function getAllWithdrawals(req, res) {
  try {
    const unknownFields = unexpectedFields(req.query, ["status"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    const filter = {};

    if (req.query.status) {
      const allowedStatuses = [
        "PENDING",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "REJECTED",
        "CANCELLED",
      ];

      if (!allowedStatuses.includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid withdrawal status.",
        });
      }

      filter.status = req.query.status;
    }

    const withdrawals = await Withdrawal.find(filter)
      .populate("user", "username userId email")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      success: true,
      withdrawals,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Unable to load withdrawals.",
    });
  }
}

export async function processWithdrawal(req, res) {
  try {
    const withdrawal = await startWithdrawalProcessing({
      withdrawalId: req.params.id,
      adminId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "Withdrawal marked as processing.",
      withdrawal,
    });
  } catch (error) {
    if (withdrawal) {
      return res.status(201).json({
        success: true,
        message: "Withdrawal request was saved. Admin email notification is pending retry.",
        withdrawal,
      });
    }
    return sendError(res, error);
  }
}

export async function markWithdrawalSuccess(req, res) {
  try {
    const unknownFields = unexpectedFields(req.body, ["payoutReference"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    const { payoutReference } = req.body || {};

    const withdrawal = await completeWithdrawal({
      withdrawalId: req.params.id,
      adminId: req.user._id,
      payoutReference,
    });

    return res.status(200).json({
      success: true,
      message: "Withdrawal completed.",
      withdrawal,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

export async function failOrRejectWithdrawal(req, res) {
  try {
    const unknownFields = unexpectedFields(req.body, ["reason", "rejected"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    const { reason, rejected = false } = req.body || {};

    if (typeof rejected !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "rejected must be a boolean.",
      });
    }

    const withdrawal = await failWithdrawal({
      withdrawalId: req.params.id,
      adminId: req.user._id,
      reason,
      rejected,
    });

    return res.status(200).json({
      success: true,
      message: rejected
        ? "Withdrawal rejected and reserved coins released."
        : "Withdrawal failed and reserved coins released.",
      withdrawal,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
