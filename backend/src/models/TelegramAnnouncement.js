import mongoose from "mongoose";

const telegramAnnouncementSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 180 },
    text: { type: String, required: true, maxlength: 4096 },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SENT", "FAILED", "UNKNOWN"],
      required: true,
    },
    telegramMessageId: { type: Number, default: null },
    errorCode: { type: String, default: null, maxlength: 80 },
    nextAttemptAt: { type: Date, default: null },
  },
  { timestamps: true }
);

telegramAnnouncementSchema.index({ key: 1 }, { unique: true });

const TelegramAnnouncement = mongoose.models.TelegramAnnouncement
  || mongoose.model("TelegramAnnouncement", telegramAnnouncementSchema);

export default TelegramAnnouncement;
