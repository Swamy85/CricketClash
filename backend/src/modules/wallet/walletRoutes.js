
import { Router } from "express";

import {
  getMyWallet,
  getMyTransactions,
  requestWithdrawal,
  getMyWithdrawals,
} from "./withdrawalController.js";

import {
  createDeposit,
  getMyDeposits,
} from "./depositController.js";

import { handleDepositProofUpload } from "./depositUpload.js";

const router = Router();

// Authentication is applied when this router is mounted in app.js.
router.get("/", getMyWallet);
router.get("/transactions", getMyTransactions);

router.post("/withdrawals", requestWithdrawal);
router.get("/withdrawals", getMyWithdrawals);

// Player deposits use multipart/form-data.
router.post(
  "/deposits",
  handleDepositProofUpload,
  createDeposit
);

router.get("/deposits", getMyDeposits);

export default router;
