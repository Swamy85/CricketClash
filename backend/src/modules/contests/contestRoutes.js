
import { Router } from "express";

import {
  getOpenContests,
  getMyContests,
  postJoinContest,
  getLeaderboard,
} from "./contestController.js";

const router = Router();

// Player authentication is applied in app.js.
router.get("/", getOpenContests);
router.get("/mine", getMyContests);
router.get("/leaderboard", getLeaderboard);
router.post("/join", postJoinContest);
router.post("/:id/join", postJoinContest);

export default router;
