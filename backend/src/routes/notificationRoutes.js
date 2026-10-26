import { Router } from "express";
import Notification from "../models/Notification.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const preferences = req.user.notificationPreferences || {};
    const suppressedTypes = [
      ...(preferences.matchUpdates === false ? ["MATCH_LIVE"] : []),
      ...(preferences.contestUpdates === false ? ["CONTEST_JOINED", "OPPONENT_JOINED", "CONTEST_FULL", "CONTEST_CANCELLED"] : []),
      ...(preferences.results === false ? ["MATCH_RESULT"] : []),
      ...(preferences.announcements === false ? ["PAYOUT_COMPLETED", "PAYOUT_REVERSED", "REFUND_COMPLETED"] : []),
    ];
    const filter = {
      user: req.user._id,
      ...(suppressedTypes.length ? { type: { $nin: suppressedTypes } } : {}),
    };
    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, notifications });
  } catch (error) {
    console.error("Unable to load notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load notifications.",
    });
  }
});

router.patch("/read-all", async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, readAt: null },
      { $set: { readAt: new Date() } }
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Unable to mark notifications as read:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update notifications.",
    });
  }
});

router.patch("/:id/read", async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true }
    ).lean();

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    return res.json({ success: true, notification });
  } catch (error) {
    console.error("Unable to mark notification as read:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update notification.",
    });
  }
});

export default router;
