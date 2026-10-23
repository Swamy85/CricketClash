
import mongoose from "mongoose";

const payoutDetailsSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    mobileNumber: {
      type: String,
      trim: true,
    },
    method: {
      type: String,
      enum: ["UPI", "BANK"],
    },
    upiId: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    accountHolderName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    accountNumber: {
      type: String,
      trim: true,
      maxlength: 18,
    },
    ifscCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 11,
    },
    bankName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
  },
  { _id: false }
);

const withdrawalSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },

    coinAmount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Withdrawal amount must be a whole number.",
      },
    },

    cashAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    currency: {
      type: String,
      enum: ["INR"],
      default: "INR",
    },

    payoutDetails: {
      type: payoutDetailsSchema,
      required: false,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "REJECTED",
        "CANCELLED",
      ],
      default: "PENDING",
      required: true,
      index: true,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 200,
    },

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    payoutReference: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    failureReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    requestedAt: {
      type: Date,
      default: Date.now,
    },

    processedAt: {
      type: Date,
    },

    completedAt: {
      type: Date,
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

withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });
withdrawalSchema.index({
  "adminEmailNotification.status": 1,
  "adminEmailNotification.nextAttemptAt": 1,
});
withdrawalSchema.index({
  "adminEmailNotification.status": 1,
  "adminEmailNotification.lastAttemptAt": 1,
});

const Withdrawal =
  mongoose.models.Withdrawal ||
  mongoose.model("Withdrawal", withdrawalSchema);

export default Withdrawal;
