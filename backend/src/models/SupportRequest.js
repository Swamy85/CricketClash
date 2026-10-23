
import mongoose from "mongoose";

const supportRequestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "account",
        "email-verification",
        "login",
        "contest",
        "privacy",
        "technical",
        "other",
      ],
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 3000,
    },
    status: {
      type: String,
      enum: ["new", "in-progress", "resolved"],
      default: "new",
      index: true,
    },
    notificationStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.SupportRequest ||
  mongoose.model("SupportRequest", supportRequestSchema);
