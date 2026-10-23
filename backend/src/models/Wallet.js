
import mongoose from "mongoose";

const { Schema } = mongoose;

const walletSchema = new Schema(
  {
    // One wallet per registered user.
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Total coins currently owned by the player.
    // Includes coins reserved for pending withdrawals.
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return Number.isSafeInteger(value);
        },
        message: "Wallet balance must be a safe integer.",
      },
    },

    // Coins temporarily unavailable because of pending withdrawals.
    reservedBalance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator(value) {
          return Number.isSafeInteger(value);
        },
        message: "Reserved balance must be a safe integer.",
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Coins available for contests or new withdrawal requests.
walletSchema.virtual("availableBalance").get(function () {
  return this.balance - this.reservedBalance;
});

// Basic consistency check when saving a wallet document.
walletSchema.pre("validate", function (next) {
  if (this.reservedBalance > this.balance) {
    this.invalidate(
      "reservedBalance",
      "Reserved balance cannot exceed total balance."
    );
  }

  next();
});

const Wallet =
  mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);

export default Wallet;
