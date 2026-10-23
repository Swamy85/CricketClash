
import { notifySessionExpired } from "../../auth/services/authService";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

const SESSION_STORAGE_KEY = "cc_session_id";

/**
 * Common request helper for wallet APIs.
 * Supports JSON requests and multipart FormData uploads.
 */
async function walletRequest(endpoint, options = {}) {
  const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  const isFormData =
    typeof FormData !== "undefined" &&
    options.body instanceof FormData;

  const headers = {
    // The browser must set the multipart boundary for FormData.
    ...(isFormData
      ? {}
      : { "Content-Type": "application/json" }),

    ...(sessionId
      ? { "X-CricketClash-Session": sessionId }
      : {}),

    ...(options.headers || {}),
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: "include",
    cache: "no-store",
    headers,
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    // Some responses may not contain JSON.
  }

  if (!response.ok) {
    notifySessionExpired(response, data);
    const error = new Error(
      data.message || "Wallet request failed."
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/**
 * Get the logged-in user's wallet balance.
 */
export async function getWalletDetails(options) {
  return walletRequest("/api/wallet", options);
}

export async function getWalletTransactions(options) {
  return walletRequest("/api/wallet/transactions", options);
}

/**
 * Get the logged-in user's withdrawal history.
 */
export async function getWithdrawalHistory(options) {
  return walletRequest("/api/wallet/withdrawals", options);
}

/**
 * Submit a withdrawal request.
 */
export async function submitWithdrawal(
  coinAmount,
  payoutDetails
) {
  const reference = `withdrawal-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;

  return walletRequest("/api/wallet/withdrawals", {
    method: "POST",
    body: JSON.stringify({
      coinAmount: Number(coinAmount),
      reference,
      payoutDetails,
    }),
  });
}

/**
 * Submit a manual deposit request with payment screenshot.
 *
 * Backend expects multipart/form-data fields:
 * amount, utr, paymentProof
 */
export async function submitDeposit(
  amount,
  utr,
  paymentProof
) {
  if (!Number.isSafeInteger(Number(amount)) || Number(amount) <= 0) {
    throw new Error("Enter a valid whole-number deposit amount.");
  }

  if (typeof utr !== "string" || !utr.trim()) {
    throw new Error("Enter your UTR/reference number.");
  }

  if (!(paymentProof instanceof File)) {
    throw new Error("Please select a payment screenshot.");
  }

  const formData = new FormData();

  formData.append("amount", String(Number(amount)));
  formData.append("utr", utr.trim());
  formData.append("paymentProof", paymentProof);

  return walletRequest("/api/wallet/deposits", {
    method: "POST",
    body: formData,
  });
}

/**
 * Get the logged-in user's deposit history.
 */
export async function getDepositHistory(options) {
  return walletRequest("/api/wallet/deposits", {
    method: "GET",
    ...options,
  });
}
