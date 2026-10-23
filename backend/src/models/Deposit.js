
import mongoose from "mongoose";

const depositSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Deposit amount must be a whole number.",
      },
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
    },

    // Normalize UTR values before saving and checking duplicates.
    utr: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 6,
      maxlength: 100,
    },

    paymentProof: {
      storageKey: {
        type: String,
        required: true,
        select: false,
      },
      originalName: {
        type: String,
        required: true,
        maxlength: 255,
      },
      mimeType: {
        type: String,
        required: true,
        enum: ["image/jpeg", "image/png", "image/webp"],
      },
    },

    status: {
      type: String,
      enum: ["PENDING","PROCESSING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    walletTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WalletTransaction",
      default: null,
    },

    adminEmailNotification: {
      status: {
        type: String,
        enum: ["PENDING", "SENDING", "SENT", "FAILED"],
        default: "PENDING",
      },
      attempts: { type: Number, default: 0, min: 0 },
      lastAttemptAt: { type: Date, default: null },
      nextAttemptAt: { type: Date, default: Date.now },
      lastErrorCode: { type: String, default: "", maxlength: 80 },
    },
  },
  {
    timestamps: true,
  }
);

// Prevent the same UTR from being submitted for multiple deposits.
depositSchema.index({ utr: 1 }, { unique: true });

// Efficient player history and admin queue queries.
depositSchema.index({ user: 1, createdAt: -1 });
depositSchema.index({ status: 1, createdAt: -1 });
depositSchema.index({
  "adminEmailNotification.status": 1,
  "adminEmailNotification.nextAttemptAt": 1,
});
depositSchema.index({
  "adminEmailNotification.status": 1,
  "adminEmailNotification.lastAttemptAt": 1,
});

const Deposit = mongoose.model("Deposit", depositSchema);

export default Deposit;
