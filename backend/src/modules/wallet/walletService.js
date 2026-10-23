
import mongoose from "mongoose";
import Wallet from "../../models/Wallet.js";
import WalletTransaction from "../../models/WalletTransaction.js";

const CREDIT_TYPES = new Set([
  "DEPOSIT",
  "CONTEST_WINNING",
  "CONTEST_REFUND",
  "ADMIN_ADJUSTMENT",
]);

const DEBIT_TYPES = new Set([
  "CONTEST_ENTRY",
  "CONTEST_ENTRY_REVERSAL",
  "WITHDRAWAL",
  "ADMIN_ADJUSTMENT",
]);

function validateOperation({ userId, amount, reference, type, direction }, isValidObjectId) {
  if (!isValidObjectId(userId)) {
    throw new Error("A valid user ID is required.");
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a positive whole number of coins.");
  }

  if (
    typeof reference !== "string" ||
    reference.trim().length === 0 ||
    reference.length > 200
  ) {
    throw new Error("A valid transaction reference is required.");
  }

  const allowedTypes = direction === "CREDIT" ? CREDIT_TYPES : DEBIT_TYPES;

  if (!allowedTypes.has(type)) {
    throw new Error(`Transaction type ${type} is not valid for ${direction}.`);
  }
}

function assertSameOperation(existing, { amount, type, direction }) {
  if (
    existing.amount !== amount ||
    existing.type !== type ||
    existing.direction !== direction ||
    existing.status !== "COMPLETED"
  ) {
    throw new Error(
      "This transaction reference was already used for a different operation."
    );
  }

  return existing;
}

export function createWalletOperations({
  WalletModel = Wallet,
  WalletTransactionModel = WalletTransaction,
  startSession = () => mongoose.startSession(),
  isValidObjectId = (value) => mongoose.isValidObjectId(value),
} = {}) {
  async function applyWalletOperation({
    userId,
    amount,
    reference,
    type,
    direction,
    provider = "INTERNAL",
    providerPaymentId = null,
    contestId = null,
    description = "",
    initiatedBy = null,
  }) {
  validateOperation({ userId, amount, reference, type, direction }, isValidObjectId);

  if (!["RAZORPAY", "MANUAL", "INTERNAL"].includes(provider)) {
    throw new Error("Invalid transaction provider.");
  }

  if (providerPaymentId !== null && typeof providerPaymentId !== "string") {
    throw new Error("Provider payment ID must be a string.");
  }

  if (contestId && !isValidObjectId(contestId)) {
    throw new Error("Invalid contest ID.");
  }

  if (initiatedBy && !isValidObjectId(initiatedBy)) {
    throw new Error("Invalid administrator ID.");
  }

  const normalizedReference = reference.trim();
  const session = await startSession();

  let result;

  try {
    await session.withTransaction(async () => {
      // Idempotency: don't apply the same operation twice.
      const existing = await WalletTransactionModel.findOne({
        user: userId,
        reference: normalizedReference,
      }).session(session);

      if (existing) {
        result = assertSameOperation(existing, {
          amount,
          type,
          direction,
        });
        return;
      }

      // Create the wallet on first use.
      const wallet = await WalletModel.findOneAndUpdate(
        { user: userId },
        {
          $setOnInsert: {
            user: userId,
            balance: 0,
            reservedBalance: 0,
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
          session,
        }
      );

      const balanceBefore = wallet.balance;

      let updatedWallet;

      if (direction === "CREDIT") {
        updatedWallet = await WalletModel.findOneAndUpdate(
          {
            _id: wallet._id,
            $expr: {
              $lte: [
                { $add: ["$balance", amount] },
                Number.MAX_SAFE_INTEGER,
              ],
            },
          },
          { $inc: { balance: amount } },
          { new: true, session }
        );
      } else {
        // Only spend coins that aren't reserved for withdrawals.
        updatedWallet = await WalletModel.findOneAndUpdate(
          {
            _id: wallet._id,
            $expr: {
              $gte: [
                { $subtract: ["$balance", "$reservedBalance"] },
                amount,
              ],
            },
          },
          { $inc: { balance: -amount } },
          { new: true, session }
        );

        if (!updatedWallet) {
          throw new Error("Insufficient available coins.");
        }
      }

      if (!updatedWallet) {
        throw new Error("Unable to update wallet balance.");
      }

      const [transaction] = await WalletTransactionModel.create(
        [
          {
            user: userId,
            wallet: wallet._id,
            type,
            amount,
            direction,
            status: "COMPLETED",
            reference: normalizedReference,
            contest: contestId,
            initiatedBy,
            provider,
            providerPaymentId,
            balanceBefore,
            balanceAfter: updatedWallet.balance,
            description,
            processedAt: new Date(),
          },
        ],
        { session }
      );

      result = transaction;
    });

    return result;
  } catch (error) {
    // A concurrent request may have created the same unique reference.
    // Check the ledger before deciding whether this was a duplicate.
    if (
      error.code === 11000 ||
      error.hasErrorLabel?.("TransientTransactionError")
    ) {
      const existing = await WalletTransactionModel.findOne({
        $or: [
          { user: userId, reference: normalizedReference },
          ...(providerPaymentId
            ? [{ provider, providerPaymentId }]
            : []),
        ],
      });

      if (existing) {
        if (existing.user.toString() !== userId.toString()) {
          throw new Error("This payment has already been used.");
        }

        if (
          providerPaymentId &&
          existing.providerPaymentId === providerPaymentId &&
          existing.reference !== normalizedReference
        ) {
          throw new Error("This provider payment has already been processed.");
        }

        return assertSameOperation(existing, {
          amount,
          type,
          direction,
        });
      }
    }

    throw error;
  } finally {
    await session.endSession();
  }
  }

  return {
    creditWallet: (options) => applyWalletOperation({ ...options, direction: "CREDIT" }),
    debitWallet: (options) => applyWalletOperation({ ...options, direction: "DEBIT" }),
  };
}

const walletOperations = createWalletOperations();

// Credit coins after a verified deposit, win, refund or admin adjustment.
export const creditWallet = walletOperations.creditWallet;

// Deduct coins for a contest entry or an authorized debit.
export const debitWallet = walletOperations.debitWallet;

// Read a player's wallet.
export async function getWallet(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("A valid user ID is required.");
  }

  const wallet = await Wallet.findOne({ user: userId });

  if (!wallet) {
    return {
      balance: 0,
      reservedBalance: 0,
      availableBalance: 0,
    };
  }

  return {
    balance: wallet.balance,
    reservedBalance: wallet.reservedBalance,
    availableBalance: wallet.balance - wallet.reservedBalance,
  };
}
