
import mongoose from "mongoose";

const { Schema } = mongoose;

const walletTransactionSchema = new Schema(
  {
    // Player whose wallet is affected.
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Wallet affected by this transaction.
    wallet: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "DEPOSIT",
        "CONTEST_ENTRY",
        "CONTEST_ENTRY_REVERSAL",
        "CONTEST_WINNING",
        "CONTEST_REFUND",
        "WITHDRAWAL",
        "WITHDRAWAL_RELEASE",
        "ADMIN_ADJUSTMENT",
      ],
      required: true,
    },

    // Positive integer coin amount.
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator(value) {
          return Number.isSafeInteger(value);
        },
        message: "Transaction amount must be a positive safe integer.",
      },
    },

    // CREDIT increases the balance; DEBIT decreases it.
    direction: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED", "REVERSED"],
      default: "PENDING",
      required: true,
    },

    // Idempotency key: one operation must not be applied twice.
    reference: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Optional links to related records.
    contest: {
      type: Schema.Types.ObjectId,
      ref: "Contest",
      default: null,
    },

    initiatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reversesTransaction: {
      type: Schema.Types.ObjectId,
      ref: "WalletTransaction",
      default: null,
    },

    withdrawal: {
      type: Schema.Types.ObjectId,
      ref: "Withdrawal",
      default: null,
    },

    // Payment provider reference for a deposit.
    provider: {
      type: String,
      enum: ["RAZORPAY", "MANUAL", "INTERNAL"],
      default: "INTERNAL",
    },

    providerPaymentId: {
      type: String,
      default: null,
      trim: true,
    },

    // Balance snapshots make auditing easier.
    balanceBefore: {
      type: Number,
      min: 0,
      default: null,
    },

    balanceAfter: {
      type: Number,
      min: 0,
      default: null,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// A reference can only be used once for a given user.
walletTransactionSchema.index(
  { user: 1, reference: 1 },
  { unique: true }
);

// A provider payment ID must not credit multiple wallets.
// Multiple null values are allowed.
walletTransactionSchema.index(
  { provider: 1, providerPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerPaymentId: { $type: "string" },
    },
  }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index(
  { reversesTransaction: 1 },
  {
    unique: true,
    partialFilterExpression: { reversesTransaction: { $type: "objectId" } },
  }
);

const WalletTransaction =
  mongoose.models.WalletTransaction ||
  mongoose.model("WalletTransaction", walletTransactionSchema);

export default WalletTransaction;
