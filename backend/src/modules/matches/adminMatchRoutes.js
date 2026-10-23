
import { Router } from "express";

import {
  getAdminMatches,
  postMatch,
  patchMatch,
  removeMatch,
  postCorrectMatchResult,
} from "./matchController.js";

const router = Router();

// Authentication and requireAdmin are applied in app.js.

// List matches for the admin dashboard.
router.get("/", getAdminMatches);

// Create a match.
router.post("/", postMatch);

// Update a match.
router.patch("/:id", patchMatch);

router.post("/:id/correct-result", postCorrectMatchResult);

// Delete a match.
router.delete("/:id", removeMatch);

export default router;
