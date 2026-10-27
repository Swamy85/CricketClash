
import fs from "node:fs";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import mongoose from "mongoose";

import Deposit from "../../models/Deposit.js";
import { unexpectedFields } from "../../middleware/requestSafety.js";
import { uploadDirectory } from "./depositUpload.js";
import { creditWallet } from "./walletService.js";
import { notifyWalletRequestStatus } from "../../services/notificationService.js";
import {
  retryAdminRequestNotification,
  sendAdminRequestNotification,
} from "../../services/adminRequestEmailService.js";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isValidId(id) {
  return mongoose.isValidObjectId(id);
}

async function removeUploadedFile(filePath) {
  if (!filePath) return;

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not remove deposit upload:", error.message);
    }
  }
}

function safeDeposit(deposit) {
  const item = deposit.toObject ? deposit.toObject() : deposit;

  // Never expose the private disk path or storage key in JSON.
  if (item.paymentProof) {
    delete item.paymentProof.storageKey;
  }

  return item;
}

// POST /api/wallet/deposits
// Multipart fields: amount, utr, paymentProof
export async function createDeposit(req, res) {
  let savedDeposit;

  try {
    const unknownFields = unexpectedFields(req.body ?? {}, ["amount", "utr"]);
    if (unknownFields.length) {
      await removeUploadedFile(req.file?.path);
      return res.status(400).json({ success: false, message: unknownFields[0] });
    }
    const userId = req.user?._id;
    const rawAmount = req.body?.amount;
    if (typeof rawAmount !== "string" || !/^\d+$/.test(rawAmount)) {
      await removeUploadedFile(req.file?.path);
      return res.status(400).json({ success: false, message: "Enter a valid positive whole-number deposit amount." });
    }
    const amount = Number(rawAmount);
    const utr = String(req.body?.utr || "").trim().toUpperCase();

    if (!userId || !isValidId(userId)) {
      await removeUploadedFile(req.file?.path);
      return res.status(401).json({
        success: false,
        message: "Please log in to continue.",
      });
    }

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      await removeUploadedFile(req.file?.path);
      return res.status(400).json({
        success: false,
        message: "Enter a valid positive whole-number deposit amount.",
      });
    }

    if (!/^[A-Z0-9-]{6,100}$/.test(utr)) {
      await removeUploadedFile(req.file?.path);
      return res.status(400).json({
        success: false,
        message: "Enter a valid transaction reference.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Upload your payment screenshot.",
      });
    }

    // Verify the actual file signature, not just its supplied MIME type.
    const detectedType = await fileTypeFromFile(req.file.path);

    if (
      !detectedType ||
      !ALLOWED_IMAGE_TYPES.has(detectedType.mime)
    ) {
      await removeUploadedFile(req.file.path);

      return res.status(400).json({
        success: false,
        message: "The uploaded file is not a supported image.",
      });
    }

    
    // A UTR may be reused only if every previous request with
    // that UTR has been rejected.
    const existingActiveDeposit = await Deposit.findOne({
      utr,
      status: { $in: ["PENDING", "PROCESSING", "APPROVED"] },
    }).select("_id status");

    if (existingActiveDeposit) {
      await removeUploadedFile(req.file.path);

      const message =
        existingActiveDeposit.status === "APPROVED"
          ? "This transaction reference has already been used for an approved deposit."
          : "This transaction reference already has a deposit request under review.";

      return res.status(409).json({
        success: false,
        message,
      });
    }


    const deposit = await Deposit.create({
      user: userId,
      amount,
      utr,
      status: "PENDING",
      paymentProof: {
        storageKey: path.basename(req.file.filename),
        originalName: path.basename(req.file.originalname).slice(0, 255),
        mimeType: detectedType.mime,
      },
    });

    savedDeposit = deposit;
    await notifyWalletRequestStatus("deposit", deposit);
    const notification = await sendAdminRequestNotification("deposit", deposit._id);

    return res.status(201).json({
      success: true,
      message: notification.status === "SENT"
        ? "Deposit submitted for manual verification."
        : "Deposit submitted for manual verification. Admin email notification is pending retry.",
      deposit: safeDeposit(await Deposit.findById(deposit._id)),
    });
  } catch (error) {
    if (!savedDeposit) await removeUploadedFile(req.file?.path);

    if (savedDeposit) {
      console.error("Deposit request saved; follow-up operation failed.", {
        requestId: String(savedDeposit._id),
        code: String(error?.code || "EMAIL_STATUS_UPDATE_FAILED").slice(0, 80),
      });
      return res.status(201).json({
        success: true,
        message: "Deposit request was saved. Admin email notification is pending retry.",
        deposit: safeDeposit(savedDeposit),
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This transaction reference has already been submitted.",
      });
    }

    console.error("Create deposit error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit the deposit request.",
    });
  }

}

export async function retryDepositNotification(req, res) {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid deposit ID." });
    }
    const result = await retryAdminRequestNotification("deposit", req.params.id);
    if (!result) {
      return res.status(404).json({ success: false, message: "Deposit not found." });
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
    console.error("Retry deposit notification error:", error);
    return res.status(500).json({ success: false, message: "Unable to retry the email notification." });
  }
}

// GET /api/wallet/deposits
export async function getMyDeposits(req, res) {
  try {
    const deposits = await Deposit.find({ user: req.user._id })
      .select("-paymentProof.storageKey")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.status(200).json({
      success: true,
      deposits,
    });
  } catch (error) {
    console.error("Load player deposits error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load deposit history.",
    });
  }
}

// GET /api/admin/deposits
export async function getAllDeposits(req, res) {
  try {
    const unknownFields = unexpectedFields(req.query, ["status"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    const allowedStatuses = [
      "PENDING",
      "PROCESSING",
      "APPROVED",
      "REJECTED",
    ];

    const filter = {};

    if (req.query.status) {
      if (!allowedStatuses.includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid deposit status.",
        });
      }

      filter.status = req.query.status;
    }

    const deposits = await Deposit.find(filter)
      .select("-paymentProof.storageKey")
      .populate("user", "username userId email")
      .populate("reviewedBy", "username userId")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      success: true,
      deposits,
    });
  } catch (error) {
    console.error("Load admin deposits error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load deposit requests.",
    });
  }
}

// GET /api/admin/deposits/:id/proof
// Admin authentication is applied by app.js.
export async function getDepositProof(req, res) {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid deposit ID.",
      });
    }

    const deposit = await Deposit.findById(req.params.id)
      .select("+paymentProof.storageKey");

    if (!deposit) {
      return res.status(404).json({
        success: false,
        message: "Deposit not found.",
      });
    }

    const storageKey = deposit.paymentProof?.storageKey;

    // Only allow a basename within the private upload directory.
    if (!storageKey || path.basename(storageKey) !== storageKey) {
      return res.status(404).json({
        success: false,
        message: "Payment proof not found.",
      });
    }

    const filePath = path.join(uploadDirectory, storageKey);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "Payment proof file is unavailable.",
      });
    }

    const detectedType = await fileTypeFromFile(filePath);

    if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType.mime)) {
      return res.status(415).json({
        success: false,
        message: "Payment proof is not a supported image.",
      });
    }

    res.set({
      "Content-Type": detectedType.mime,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });

    return res.sendFile(filePath);
  } catch (error) {
    console.error("Read deposit proof error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to display payment proof.",
    });
  }
}

// PATCH /api/admin/deposits/:id/approve
// The admin must verify the actual payment before calling this endpoint.
export async function approveDeposit(req, res) {
  let claimedDeposit;

  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid deposit ID.",
      });
    }

    // Claim the pending request so concurrent admin actions cannot
    // independently approve and reject it.
    claimedDeposit = await Deposit.findOneAndUpdate(
      {
        _id: req.params.id,
        // A retry may safely resume a prior approval interrupted after the
        // wallet transaction committed; creditWallet uses the deposit's
        // stable transaction reference and cannot credit it twice.
        status: { $in: ["PENDING", "PROCESSING"] },
      },
      {
        $set: { status: "PROCESSING" },
      },
      { new: true }
    );

    if (!claimedDeposit) {
      const current = await Deposit.findById(req.params.id).select("status");

      if (!current) {
        return res.status(404).json({
          success: false,
          message: "Deposit not found.",
        });
      }

      return res.status(409).json({
        success: false,
        message: `This deposit is already ${current.status.toLowerCase()}.`,
      });
    }

    // Idempotent reference: retrying cannot credit the same deposit twice.
    const transaction = await creditWallet({
      userId: claimedDeposit.user,
      amount: claimedDeposit.amount,
      reference: `deposit:${claimedDeposit._id}`,
      type: "DEPOSIT",
      provider: "MANUAL",
      providerPaymentId: claimedDeposit.utr,
      description: `Manually verified deposit ${claimedDeposit.utr}`,
    });

    const approved = await Deposit.findOneAndUpdate(
      {
        _id: claimedDeposit._id,
        status: "PROCESSING",
      },
      {
        $set: {
          status: "APPROVED",
          reviewedBy: req.user._id,
          reviewedAt: new Date(),
          walletTransaction: transaction._id,
        },
      },
      { new: true }
    );

    if (!approved) {
      throw new Error("Deposit approval status could not be saved.");
    }

    await notifyWalletRequestStatus("deposit", approved);

    return res.status(200).json({
      success: true,
      message: "Deposit approved and wallet credited.",
      deposit: safeDeposit(approved),
    });
  } catch (error) {
    console.error("Approve deposit error:", error);

    // Restore the request to pending so an admin can safely retry.
    // The wallet transaction reference protects against double credit.
    if (claimedDeposit) {
      try {
        await Deposit.updateOne(
          {
            _id: claimedDeposit._id,
            status: "PROCESSING",
          },
          {
            $set: { status: "PENDING" },
          }
        );
      } catch (resetError) {
        console.error("Could not restore deposit status:", resetError);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Unable to approve deposit. Check the deposit and wallet records before retrying.",
    });
  }
}

// PATCH /api/admin/deposits/:id/reject
export async function rejectDeposit(req, res) {
  try {
    const unknownFields = unexpectedFields(req.body, ["reason"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid deposit ID.",
      });
    }

    const reason = String(req.body?.reason || "").trim();

    if (!reason || reason.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Provide a rejection reason of 1–500 characters.",
      });
    }

    const deposit = await Deposit.findOneAndUpdate(
      {
        _id: req.params.id,
        status: "PENDING",
      },
      {
        $set: {
          status: "REJECTED",
          rejectionReason: reason,
          reviewedBy: req.user._id,
          reviewedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!deposit) {
      return res.status(409).json({
        success: false,
        message: "Deposit was not pending or could not be found.",
      });
    }

    await notifyWalletRequestStatus("deposit", deposit);

    return res.status(200).json({
      success: true,
      message: "Deposit rejected. No coins were credited.",
      deposit: safeDeposit(deposit),
    });
  } catch (error) {
    console.error("Reject deposit error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to reject deposit.",
    });
  }
}
