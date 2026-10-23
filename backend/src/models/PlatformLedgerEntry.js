import mongoose from "mongoose";

const platformLedgerEntrySchema = new mongoose.Schema(
  {
    contest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contest",
      required: true,
      index: true,
    },
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    direction: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },
    type: {
      type: String,
      enum: ["PLATFORM_FEE", "PLATFORM_FEE_REVERSAL"],
      required: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      maxlength: 200,
    },
    description: { type: String, required: true, maxlength: 500 },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reversesEntry: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlatformLedgerEntry",
      default: null,
    },
  },
  { timestamps: true }
);

platformLedgerEntrySchema.index(
  { reversesEntry: 1 },
  {
    unique: true,
    partialFilterExpression: { reversesEntry: { $type: "objectId" } },
  }
);

const PlatformLedgerEntry =
  mongoose.models.PlatformLedgerEntry ||
  mongoose.model("PlatformLedgerEntry", platformLedgerEntrySchema);

export default PlatformLedgerEntry;
