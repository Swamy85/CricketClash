const TYPE_LABELS = {
  DEPOSIT: "Deposit",
  CONTEST_ENTRY: "Contest entry",
  CONTEST_ENTRY_REVERSAL: "Contest entry reversal",
  CONTEST_WINNING: "Contest winnings",
  CONTEST_REFUND: "Contest refund",
  WITHDRAWAL: "Withdrawal",
  WITHDRAWAL_RELEASE: "Withdrawal release",
  ADMIN_ADJUSTMENT: "Wallet adjustment",
};

function finiteAmount(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function getTransactionBalanceEffect(transaction = {}) {
  const hasSnapshots = finiteAmount(transaction.balanceBefore) && finiteAmount(transaction.balanceAfter);
  if (hasSnapshots) {
    const delta = Number(transaction.balanceAfter) - Number(transaction.balanceBefore);
    if (delta > 0) return { direction: "CREDITED", amount: delta };
    if (delta < 0) return { direction: "DEBITED", amount: Math.abs(delta) };
    return { direction: "NO_CHANGE", amount: Number(transaction.amount || 0) };
  }

  const status = String(transaction.status || "").toUpperCase();
  if (["PENDING", "FAILED"].includes(status)) {
    return { direction: "NO_CHANGE", amount: Number(transaction.amount || 0) };
  }

  const storedDirection = String(transaction.direction || "").toUpperCase();
  if (["COMPLETED", "REVERSED"].includes(status) && storedDirection === "CREDIT") {
    return { direction: "CREDITED", amount: Number(transaction.amount || 0) };
  }
  if (["COMPLETED", "REVERSED"].includes(status) && storedDirection === "DEBIT") {
    return { direction: "DEBITED", amount: Number(transaction.amount || 0) };
  }
  return { direction: "NO_CHANGE", amount: Number(transaction.amount || 0) };
}

export function formatTransactionAmount(transaction = {}) {
  const effect = getTransactionBalanceEffect(transaction);
  const sign = effect.direction === "CREDITED" ? "+" : effect.direction === "DEBITED" ? "−" : "";
  return `${sign}₹${Number(effect.amount || 0).toLocaleString("en-IN")}`;
}

export function getTransactionTypeLabel(type) {
  const normalized = String(type || "").toUpperCase();
  return TYPE_LABELS[normalized] || normalized.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase()) || "Wallet transaction";
}

export function getTransactionStatusLabel(status) {
  const normalized = String(status || "PENDING").toUpperCase();
  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}
