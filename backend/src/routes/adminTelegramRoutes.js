import { Router } from "express";
import { sendTelegramNotification } from "../services/telegramNotificationService.js";

const router = Router();

router.post("/test", async (req, res) => {
  const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();
  if (!/^[a-zA-Z0-9:_-]{8,140}$/.test(idempotencyKey)) {
    return res.status(400).json({
      success: false,
      message: "Provide an Idempotency-Key header containing 8 to 140 letters, numbers, hyphens, underscores, or colons.",
    });
  }

  try {
    const result = await sendTelegramNotification({
      key: `admin-test:${req.user._id}:${idempotencyKey}`,
      text: "✅ CricketClash Telegram bot connection test succeeded.",
    });
    return res.json({
      success: true,
      sent: result.sent,
      duplicate: result.duplicate,
      message: result.duplicate ? "This test message was already sent or is being processed." : "Test message sent to the CricketClash channel.",
    });
  } catch (error) {
    const status = error.code === "TELEGRAM_NOT_CONFIGURED" ? 503 : 502;
    return res.status(status).json({
      success: false,
      message: status === 503
        ? "Telegram notifications are not configured on the server."
        : "Telegram could not send the test message. Check the bot's channel access and server logs.",
    });
  }
});

export default router;
