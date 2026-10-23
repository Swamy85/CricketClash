
import { Router } from "express";

import {
  getAllDeposits,
  getDepositProof,
  approveDeposit,
  rejectDeposit,
  retryDepositNotification,
} from "./depositController.js";

const router = Router();

// Admin authentication and authorization are applied in app.js.

// Get all deposit requests, optionally filtered by status.
router.get("/", getAllDeposits);
router.post("/:id/notification/retry", retryDepositNotification);

// View a submitted payment screenshot.
router.get("/:id/proof", getDepositProof);

// Approve a deposit and credit the player's wallet.
router.patch("/:id/approve", approveDeposit);

// Reject a deposit with a reason.
router.patch("/:id/reject", rejectDeposit);

export default router;
