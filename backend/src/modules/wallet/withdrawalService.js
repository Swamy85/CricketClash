
import mongoose from "mongoose";

import Wallet from "../../models/Wallet.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import Withdrawal from "../../models/Withdrawal.js";

const COIN_TO_INR_RATE = 1;

function validateUserId(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("A valid user ID is required.");
  }
}

function validateCoinAmount(coinAmount) {
  if (!Number.isSafeInteger(coinAmount) || coinAmount <= 0) {
    throw new Error("Withdrawal amount must be a positive whole number of coins.");
  }
}

function validateReference(reference) {
  if (
    typeof reference !== "string" ||
    !reference.trim() ||
    reference.trim().length > 200
  ) {
    throw new Error("A valid request reference is required.");
  }
}


function validatePayoutDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Withdrawal details are required.");
  }

  const fullName =
    typeof details.fullName === "string" ? details.fullName.trim() : "";

  if (fullName.length < 2 || fullName.length > 100) {
    throw new Error("Enter your full name.");
  }

  const mobileNumber = String(details.mobileNumber || "").replace(/\s/g, "");

  if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
    throw new Error("Enter a valid 10-digit mobile number.");
  }

  if (!["UPI", "BANK"].includes(details.method)) {
    throw new Error("Select UPI or Bank Transfer.");
  }

  if (details.method === "UPI") {
    const upiId =
      typeof details.upiId === "string" ? details.upiId.trim() : "";

    if (
      upiId.length > 100 ||
      !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(upiId)
    ) {
      throw new Error("Enter a valid UPI ID.");
    }

    return {
      fullName,
      mobileNumber,
      method: "UPI",
      upiId,
      accountHolderName: "",
      accountNumber: "",
      ifscCode: "",
      bankName: "",
    };
  }

  const accountHolderName =
    typeof details.accountHolderName === "string"
      ? details.accountHolderName.trim()
      : "";

  const accountNumber = String(details.accountNumber || "").trim();

  const ifscCode =
    typeof details.ifscCode === "string"
      ? details.ifscCode.trim().toUpperCase()
      : "";

  const bankName =
    typeof details.bankName === "string" ? details.bankName.trim() : "";

  if (!accountHolderName || accountHolderName.length > 100) {
    throw new Error("Enter the bank account holder name.");
  }

  if (!/^\d{9,18}$/.test(accountNumber)) {
    throw new Error("Enter a valid bank account number.");
  }

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
    throw new Error("Enter a valid IFSC code.");
  }

  if (!bankName || bankName.length > 100) {
    throw new Error("Enter the bank name.");
  }

  return {
    fullName,
    mobileNumber,
    method: "BANK",
    upiId: "",
    accountHolderName,
    accountNumber,
    ifscCode,
    bankName,
  };
}



function assertSameRequest(withdrawal, userId, coinAmount, payoutDetails) {
  const existingDetails = withdrawal.payoutDetails;

  const samePayoutDetails =
    existingDetails &&
    existingDetails.fullName === payoutDetails.fullName &&
    existingDetails.mobileNumber === payoutDetails.mobileNumber &&
    existingDetails.method === payoutDetails.method &&
    (payoutDetails.method === "UPI"
      ? existingDetails.upiId === payoutDetails.upiId
      : existingDetails.accountHolderName === payoutDetails.accountHolderName &&
        existingDetails.accountNumber === payoutDetails.accountNumber &&
        existingDetails.ifscCode === payoutDetails.ifscCode &&
        existingDetails.bankName === payoutDetails.bankName);

  if (
    withdrawal.user.toString() !== userId.toString() ||
    withdrawal.coinAmount !== coinAmount ||
    !samePayoutDetails
  ) {
    throw new Error("This request reference was already used.");
  }

  return withdrawal;
}

// Step 1: Reserve coins when the player requests a withdrawal.
// The total balance stays unchanged until a successful transfer is confirmed.

export async function createWithdrawalRequest({
  userId,
  coinAmount,
  reference,
  payoutDetails,
}) {
  validateUserId(userId);
  validateCoinAmount(coinAmount);
  validateReference(reference);

  const validatedPayoutDetails = validatePayoutDetails(payoutDetails);
  const normalizedReference = reference.trim();
  const session = await mongoose.startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      const existing = await Withdrawal.findOne({
        reference: normalizedReference,
      }).session(session);

      if (existing) {
        result = assertSameRequest(
          existing,
          userId,
          coinAmount,
          validatedPayoutDetails
        );
        return;
      }

      const wallet = await Wallet.findOne({ user: userId }).session(session);

      if (!wallet) {
        throw new Error("Wallet not found.");
      }

      const availableBalance = wallet.balance - wallet.reservedBalance;

      if (availableBalance < coinAmount) {
        throw new Error("Insufficient available coins.");
      }

      // Reserve coins atomically. Total balance remains unchanged.
      const updatedWallet = await Wallet.findOneAndUpdate(
        {
          _id: wallet._id,
          balance: { $gte: coinAmount },
          $expr: {
            $gte: [
              { $subtract: ["$balance", "$reservedBalance"] },
              coinAmount,
            ],
          },
        },
        {
          $inc: { reservedBalance: coinAmount },
        },
        {
          new: true,
          session,
        }
      );

      if (!updatedWallet) {
        throw new Error("Insufficient available coins.");
      }

      const [withdrawal] = await Withdrawal.create(
        [
          {
            user: userId,
            wallet: wallet._id,
            coinAmount,
            cashAmount: coinAmount,
            currency: "INR",
            status: "PENDING",
            reference: normalizedReference,
            payoutDetails: validatedPayoutDetails,
          },
        ],
        { session }
      );

      // Record the reservation in the wallet ledger.
      await WalletTransaction.create(
        [
          {
            user: userId,
            wallet: wallet._id,
            type: "WITHDRAWAL",
            amount: coinAmount,
            direction: "DEBIT",
            status: "PENDING",
            reference: `withdrawal:${withdrawal._id}`,
            withdrawal: withdrawal._id,
            provider: "INTERNAL",
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance,
            description: "Coins reserved for withdrawal.",
          },
        ],
        { session }
      );

      result = withdrawal;
    });

    return result;
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Withdrawal.findOne({
        reference: normalizedReference,
      });

      if (existing) {
        return assertSameRequest(
          existing,
          userId,
          coinAmount,
          validatedPayoutDetails
        );
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
}


// Step 2: Admin marks a pending withdrawal as processing.
// Protect the route with authenticate and requireAdmin middleware.
export async function startWithdrawalProcessing({
  withdrawalId,
  adminId,
}) {
  validateUserId(adminId);

  if (!mongoose.isValidObjectId(withdrawalId)) {
    throw new Error("A valid withdrawal ID is required.");
  }

  const withdrawal = await Withdrawal.findOneAndUpdate(
    { _id: withdrawalId, status: "PENDING" },
    {
      $set: {
        status: "PROCESSING",
        processedBy: adminId,
        processedAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );

  if (!withdrawal) {
    throw new Error("Withdrawal not found or is no longer pending.");
  }

  return withdrawal;
}

// Step 3: Call only after the actual outgoing payment is verified.
// Finalize the debit and withdrawal status exactly once.
export async function completeWithdrawal({
  withdrawalId,
  adminId,
  payoutReference,
}) {
  validateUserId(adminId);

  if (!mongoose.isValidObjectId(withdrawalId)) {
    throw new Error("A valid withdrawal ID is required.");
  }

  if (
    typeof payoutReference !== "string" ||
    !payoutReference.trim() ||
    payoutReference.trim().length > 200
  ) {
    throw new Error("A verified payout reference is required.");
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const withdrawal = await Withdrawal.findOne({
        _id: withdrawalId,
      }).session(session);

      if (!withdrawal) {
        throw new Error("Withdrawal not found.");
      }

      if (withdrawal.status === "SUCCESS") {
        // Idempotent retry after a completed operation.
        if (withdrawal.payoutReference !== payoutReference.trim()) {
          throw new Error("Withdrawal was completed with a different reference.");
        }

        result = withdrawal;
        return;
      }

      if (withdrawal.status !== "PROCESSING") {
        throw new Error("Only processing withdrawals can be completed.");
      }

      const wallet = await Wallet.findOneAndUpdate(
        {
          _id: withdrawal.wallet,
          balance: { $gte: withdrawal.coinAmount },
          reservedBalance: { $gte: withdrawal.coinAmount },
        },
        {
          $inc: {
            balance: -withdrawal.coinAmount,
            reservedBalance: -withdrawal.coinAmount,
          },
        },
        { new: true, session }
      );

      if (!wallet) {
        throw new Error("Wallet reservation is inconsistent.");
      }

      const transaction = await WalletTransaction.findOneAndUpdate(
        {
          user: withdrawal.user,
          reference: `withdrawal:${withdrawal._id}`,
          status: "PENDING",
        },
        {
          $set: {
            status: "COMPLETED",
            balanceAfter: wallet.balance,
            processedAt: new Date(),
            description: "Withdrawal payment verified and completed.",
          },
        },
        { new: true, session }
      );

      if (!transaction) {
        throw new Error("Pending withdrawal ledger entry not found.");
      }

      const updatedWithdrawal = await Withdrawal.findOneAndUpdate(
        { _id: withdrawal._id, status: "PROCESSING" },
        {
          $set: {
            status: "SUCCESS",
            processedBy: adminId,
            payoutReference: payoutReference.trim(),
            completedAt: new Date(),
            processedAt: new Date(),
          },
        },
        { new: true, session, runValidators: true }
      );

      if (!updatedWithdrawal) {
        throw new Error("Withdrawal status changed unexpectedly.");
      }

      result = updatedWithdrawal;
    });

    return result;
  } finally {
    await session.endSession();
  }
}

// Step 4: Release reserved coins if a withdrawal fails or is rejected.
// Total balance remains unchanged.
export async function failWithdrawal({
  withdrawalId,
  adminId,
  reason,
  rejected = false,
}) {
  validateUserId(adminId);

  if (!mongoose.isValidObjectId(withdrawalId)) {
    throw new Error("A valid withdrawal ID is required.");
  }

  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error("A failure or rejection reason is required.");
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const withdrawal = await Withdrawal.findOne({
        _id: withdrawalId,
      }).session(session);

      if (!withdrawal) {
        throw new Error("Withdrawal not found.");
      }

      if (["FAILED", "REJECTED"].includes(withdrawal.status)) {
        const sameOutcome =
          withdrawal.status === (rejected ? "REJECTED" : "FAILED");

        if (sameOutcome) {
          result = withdrawal;
          return;
        }

        throw new Error("Withdrawal already has a different final status.");
      }

      if (!["PENDING", "PROCESSING"].includes(withdrawal.status)) {
        throw new Error("This withdrawal cannot be failed or rejected.");
      }

      // Do not release a reservation after the payout has succeeded.
      const wallet = await Wallet.findOneAndUpdate(
        {
          _id: withdrawal.wallet,
          reservedBalance: { $gte: withdrawal.coinAmount },
        },
        { $inc: { reservedBalance: -withdrawal.coinAmount } },
        { new: true, session }
      );

      if (!wallet) {
        throw new Error("Wallet reservation is inconsistent.");
      }

      const transaction = await WalletTransaction.findOneAndUpdate(
        {
          user: withdrawal.user,
          reference: `withdrawal:${withdrawal._id}`,
          status: "PENDING",
        },
        {
          $set: {
            status: "FAILED",
            balanceAfter: wallet.balance,
            processedAt: new Date(),
            description: "Withdrawal reservation released.",
          },
        },
        { new: true, session }
      );

      if (!transaction) {
        throw new Error("Pending withdrawal ledger entry not found.");
      }

      const updatedWithdrawal = await Withdrawal.findOneAndUpdate(
        {
          _id: withdrawal._id,
          status: { $in: ["PENDING", "PROCESSING"] },
        },
        {
          $set: {
            status: rejected ? "REJECTED" : "FAILED",
            processedBy: adminId,
            failureReason: reason.trim(),
            processedAt: new Date(),
          },
        },
        { new: true, session, runValidators: true }
      );

      if (!updatedWithdrawal) {
        throw new Error("Withdrawal status changed unexpectedly.");
      }

      result = updatedWithdrawal;
    });

    return result;
  } finally {
    await session.endSession();
  }
}
