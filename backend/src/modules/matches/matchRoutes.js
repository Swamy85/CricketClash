
import { Router } from "express";
import {
  getMatches,
  getMatch,
} from "./matchController.js";

const router = Router();

// Public match listing shared by all users.
router.get("/", getMatches);
router.get("/:id", getMatch);

export default router;
