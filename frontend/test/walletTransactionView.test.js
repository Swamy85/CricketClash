import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTransactionAmount,
  getTransactionBalanceEffect,
  getTransactionStatusLabel,
  getTransactionTypeLabel,
} from "../src/features/dashboard/wallet/walletTransactionView.js";

test("credits and debits use the recorded balance change and show signed amounts", () => {
  const deposit = { type: "DEPOSIT", amount: 500, direction: "CREDIT", status: "COMPLETED", balanceBefore: 100, balanceAfter: 600 };
  const entry = { type: "CONTEST_ENTRY", amount: 75, direction: "DEBIT", status: "COMPLETED", balanceBefore: 600, balanceAfter: 525 };
  assert.equal(getTransactionBalanceEffect(deposit).direction, "CREDITED");
  assert.equal(formatTransactionAmount(deposit), "+₹500");
  assert.equal(getTransactionBalanceEffect(entry).direction, "DEBITED");
  assert.equal(formatTransactionAmount(entry), "−₹75");
});

test("pending and failed requests with no balance movement are not shown as credits or debits", () => {
  for (const status of ["PENDING", "FAILED"]) {
    const transaction = { type: "WITHDRAWAL", amount: 120, direction: "DEBIT", status, balanceBefore: 400, balanceAfter: 400 };
    assert.equal(getTransactionBalanceEffect(transaction).direction, "NO_CHANGE");
    assert.equal(formatTransactionAmount(transaction), "₹120");
    assert.equal(getTransactionStatusLabel(status), status[0] + status.slice(1).toLowerCase());
  }
});

test("withdrawal is debited only when its completion changes the balance", () => {
  const pending = { type: "WITHDRAWAL", amount: 80, direction: "DEBIT", status: "PENDING", balanceBefore: 300, balanceAfter: 300 };
  const completed = { ...pending, status: "COMPLETED", balanceAfter: 220 };
  assert.equal(getTransactionBalanceEffect(pending).direction, "NO_CHANGE");
  assert.equal(getTransactionBalanceEffect(completed).direction, "DEBITED");
  assert.equal(formatTransactionAmount(completed), "−₹80");
});

test("contest refunds and winnings are credited, while contest entry reversals follow their recorded debit", () => {
  const refund = { type: "CONTEST_REFUND", amount: 50, direction: "CREDIT", status: "COMPLETED", balanceBefore: 200, balanceAfter: 250 };
  const winnings = { type: "CONTEST_WINNING", amount: 90, direction: "CREDIT", status: "COMPLETED", balanceBefore: 250, balanceAfter: 340 };
  const entryReversal = { type: "CONTEST_ENTRY_REVERSAL", amount: 50, direction: "DEBIT", status: "COMPLETED", balanceBefore: 340, balanceAfter: 290 };
  assert.equal(getTransactionTypeLabel(refund.type), "Contest refund");
  assert.equal(formatTransactionAmount(refund), "+₹50");
  assert.equal(formatTransactionAmount(winnings), "+₹90");
  assert.equal(formatTransactionAmount(entryReversal), "−₹50");
});

test("reversed ledger entries use their own recorded balance effect", () => {
  const reversal = { type: "ADMIN_ADJUSTMENT", amount: 90, direction: "DEBIT", status: "COMPLETED", balanceBefore: 500, balanceAfter: 410, reversesTransaction: "original-payout" };
  const reversedOriginal = { type: "CONTEST_WINNING", amount: 90, direction: "CREDIT", status: "REVERSED", balanceBefore: 500, balanceAfter: 500 };
  assert.equal(getTransactionBalanceEffect(reversal).direction, "DEBITED");
  assert.equal(formatTransactionAmount(reversal), "−₹90");
  assert.equal(getTransactionBalanceEffect(reversedOriginal).direction, "NO_CHANGE");
  assert.equal(formatTransactionAmount(reversedOriginal), "₹90");
  assert.equal(getTransactionStatusLabel("REVERSED"), "Reversed");
});

test("transactions without balance snapshots only use direction for completed ledger entries", () => {
  assert.equal(getTransactionBalanceEffect({ amount: 40, direction: "CREDIT", status: "COMPLETED" }).direction, "CREDITED");
  assert.equal(getTransactionBalanceEffect({ amount: 40, direction: "CREDIT", status: "FAILED" }).direction, "NO_CHANGE");
});
