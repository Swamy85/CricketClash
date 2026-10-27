import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "CONTEST_JOINED",
        "OPPONENT_JOINED",
        "CONTEST_FULL",
        "CONTEST_CANCELLED",
        "MATCH_LIVE",
        "MATCH_RESULT",
        "PAYOUT_COMPLETED",
        "PAYOUT_REVERSED",
        "REFUND_COMPLETED",
        "DEPOSIT_STATUS",
        "WITHDRAWAL_STATUS",
      ],
      required: true,
    },
    title: { type: String, required: true, maxlength: 120 },
    message: { type: String, required: true, maxlength: 1500 },
    contest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      default: null,
    },
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    reference: { type: String, required: true, maxlength: 200 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, reference: 1 }, { unique: true });
notificationSchema.index({ user: 1, createdAt: -1 });

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);

export default Notification;
