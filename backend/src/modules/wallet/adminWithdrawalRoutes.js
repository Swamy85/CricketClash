
import { Router } from "express";

import {
  getAllWithdrawals,
  processWithdrawal,
  markWithdrawalSuccess,
  failOrRejectWithdrawal,
  retryWithdrawalNotification,
} from "./withdrawalController.js";

const router = Router();

// Authentication and requireAdmin are applied in app.js.
router.get("/", getAllWithdrawals);
router.post("/:id/notification/retry", retryWithdrawalNotification);
router.patch("/:id/process", processWithdrawal);
router.patch("/:id/success", markWithdrawalSuccess);
router.patch("/:id/fail", failOrRejectWithdrawal);

export default router;
