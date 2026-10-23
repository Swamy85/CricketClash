import { Router } from "express";
import { getCricketFeed } from "../services/cricketFeedService.js";

const router = Router();
router.get("/", async (req, res) => {
  try {
    return res.json({ success: true, feed: await getCricketFeed() });
  } catch {
    return res.status(503).json({ success: false, message: "Live match data is temporarily unavailable." });
  }
});
export default router;
