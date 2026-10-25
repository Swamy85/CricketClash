
import { Router } from "express";

import {
  getAdminContests,
  postCreateContest,
  patchCancelContest,
  patchAdminContest,
  deleteAdminContest,
  getContestLedger,
} from "./contestController.js";

const router = Router();

// Authentication and requireAdmin are applied in app.js.
router.get("/", getAdminContests);
router.get("/:id/ledger", getContestLedger);
router.post("/", postCreateContest);
router.patch("/:id", patchAdminContest);
router.delete("/:id", deleteAdminContest);
router.patch("/:id/cancel", patchCancelContest);

export default router;
