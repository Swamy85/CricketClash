import { useCallback, useEffect, useRef, useState } from "react";
import {
  getWalletDetails,
  getWithdrawalHistory,
  submitWithdrawal,
  getDepositHistory,
  submitDeposit,
  getWalletTransactions,
} from "./walletService";
import { formatIndiaDateTime } from "../../../utils/dateTime";

import paymentQr from "../../../assets/QR_Code.jpeg";
import "./WalletPage.css";

const UPI_ID = "8341929472@axl";

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : formatIndiaDateTime(date);
}

function getStatusClass(status) {
  return String(status || "PENDING").toLowerCase();
}

const INITIAL_PAYOUT_DETAILS = {
  fullName: "",
  mobileNumber: "",
  method: "UPI",
  upiId: "",
  accountHolderName: "",
  accountNumber: "",
  ifscCode: "",
  bankName: "",
};

export default function WalletPage() {
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [coinAmount, setCoinAmount] = useState("");

  const [payoutDetails, setPayoutDetails] = useState({
    ...INITIAL_PAYOUT_DETAILS,
  });

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Deposit state
  const [activeTab, setActiveTab] = useState("deposit");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositUtr, setDepositUtr] = useState("");
  const [paymentProof, setPaymentProof] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const walletRequestRef = useRef(null);
  const depositRequestRef = useRef(null);

  // Load wallet balance and withdrawal history.
  const loadWallet = useCallback(async ({ silent = false, initial = false } = {}) => {
    if (walletRequestRef.current) return;

    const controller = new AbortController();
    walletRequestRef.current = controller;
    if (initial) setLoading(true);
    if (!silent && !initial) {
      setRefreshing(true);
      setError("");
      setMessage("");
    }

    try {
      const [walletResult, historyResult, transactionResult] = await Promise.all([
        getWalletDetails({ signal: controller.signal }),
        getWithdrawalHistory({ signal: controller.signal }),
        getWalletTransactions({ signal: controller.signal }),
      ]);

      setWallet(walletResult.wallet || {});

      const history =
        historyResult.withdrawals ??
        historyResult.data?.withdrawals ??
        [];

      setWithdrawals(Array.isArray(history) ? history : []);
      setTransactions(
        Array.isArray(transactionResult.transactions)
          ? transactionResult.transactions
          : []
      );
      setWalletLoaded(true);
      setError("");
      if (!silent && !initial) setMessage("Wallet updated.");
    } catch (err) {
      if (!silent && err.name !== "AbortError") {
        setError(err.message || "Unable to load your wallet.");
      }
    } finally {
      if (walletRequestRef.current === controller) {
        walletRequestRef.current = null;
        if (initial) setLoading(false);
        if (!silent && !initial) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadWallet({ initial: true });
    return () => {
      const request = walletRequestRef.current;
      walletRequestRef.current = null;
      request?.abort();
    };
  }, [loadWallet]);

  // Load deposit history.
  const loadDeposits = useCallback(async (silent = false) => {
    if (depositRequestRef.current) return;
    const controller = new AbortController();
    depositRequestRef.current = controller;
    try {
      const result = await getDepositHistory({ signal: controller.signal });

      const history =
        result.deposits ??
        result.data?.deposits ??
        [];

      setDeposits(Array.isArray(history) ? history : []);
    } catch (err) {
      if (!silent && err.name !== "AbortError") {
        setError(err.message || "Unable to load deposit history.");
      }
    } finally {
      if (depositRequestRef.current === controller) {
        depositRequestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    loadDeposits();
    return () => {
      const request = depositRequestRef.current;
      depositRequestRef.current = null;
      request?.abort();
    };
  }, [loadDeposits]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadWallet({ silent: true });
      void loadDeposits(true);
    }, 20_000);
    return () => {
      window.clearInterval(timer);
      const request = depositRequestRef.current;
      depositRequestRef.current = null;
      request?.abort();
    };
  }, [loadDeposits, loadWallet]);

  function updatePayoutField(event) {
    const { name, value } = event.target;

    setPayoutDetails((previous) => ({
      ...previous,
      [name]: name === "ifscCode" ? value.toUpperCase() : value,
    }));
  }

  // Submit a deposit request with payment screenshot.
  async function handleDeposit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const amount = Number(depositAmount);
    const utr = depositUtr.trim();

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError("Enter a valid whole-number deposit amount.");
      return;
    }

    if (!/^[A-Za-z0-9]{8,40}$/.test(utr)) {
      setError(
        "Enter a valid UTR/reference number (8–40 letters or numbers)."
      );
      return;
    }

    if (!paymentProof) {
      setError("Please upload your payment screenshot.");
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(paymentProof.type)) {
      setError("Upload a JPG, PNG, or WEBP screenshot.");
      return;
    }

    if (paymentProof.size > 5 * 1024 * 1024) {
      setError("Screenshot must be 5 MB or smaller.");
      return;
    }

    setDepositSubmitting(true);

    try {
      const result = await submitDeposit(
        amount,
        utr,
        paymentProof
      );

      setMessage(
        result.message ||
          "Deposit request submitted. Coins will be credited after admin verification."
      );

      setDepositAmount("");
      setDepositUtr("");
      setPaymentProof(null);

      const fileInput = document.getElementById(
        "deposit-payment-proof"
      );

      if (fileInput) {
        fileInput.value = "";
      }

      await loadDeposits();
      await loadWallet();
    } catch (err) {
      setError(
        err.message || "Unable to submit the deposit request."
      );
    } finally {
      setDepositSubmitting(false);
    }
  }

  function validateWithdrawalForm() {
    const fullName = payoutDetails.fullName.trim();
    const mobileNumber = payoutDetails.mobileNumber.replace(
      /\s/g,
      ""
    );

    if (fullName.length < 2 || fullName.length > 100) {
      return "Enter your full name.";
    }

    if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
      return "Enter a valid 10-digit Indian mobile number.";
    }

    if (payoutDetails.method === "UPI") {
      const upiId = payoutDetails.upiId.trim();

      if (!/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(upiId)) {
        return "Enter a valid UPI ID, such as name@upi.";
      }
    }

    if (payoutDetails.method === "BANK") {
      if (!payoutDetails.accountHolderName.trim()) {
        return "Enter the bank account holder name.";
      }

      if (!/^\d{9,18}$/.test(payoutDetails.accountNumber.trim())) {
        return "Enter a valid bank account number.";
      }

      if (
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(
          payoutDetails.ifscCode.trim().toUpperCase()
        )
      ) {
        return "Enter a valid IFSC code.";
      }

      if (!payoutDetails.bankName.trim()) {
        return "Enter the bank name.";
      }
    }

    return "";
  }

  // Submit a withdrawal request.
  async function handleWithdrawal(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    const amount = Number(coinAmount);
    const balance = Number(wallet?.balance ?? 0);
    const reserved = Number(wallet?.reservedBalance ?? 0);

    const available = Number(
      wallet?.availableBalance ?? balance - reserved
    );

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setError("Enter a valid whole-number coin amount.");
      return;
    }

    if (!walletLoaded) {
      setError("Your wallet is still loading. Please try again.");
      return;
    }

    if (amount > available) {
      setError("You don't have enough available coins.");
      return;
    }

    const validationError = validateWithdrawalForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    const normalizedPayoutDetails = {
      fullName: payoutDetails.fullName.trim(),
      mobileNumber: payoutDetails.mobileNumber.replace(/\s/g, ""),
      method: payoutDetails.method,
      upiId:
        payoutDetails.method === "UPI"
          ? payoutDetails.upiId.trim()
          : "",
      accountHolderName:
        payoutDetails.method === "BANK"
          ? payoutDetails.accountHolderName.trim()
          : "",
      accountNumber:
        payoutDetails.method === "BANK"
          ? payoutDetails.accountNumber.trim()
          : "",
      ifscCode:
        payoutDetails.method === "BANK"
          ? payoutDetails.ifscCode.trim().toUpperCase()
          : "",
      bankName:
        payoutDetails.method === "BANK"
          ? payoutDetails.bankName.trim()
          : "",
    };

    setSubmitting(true);

    try {
      const result = await submitWithdrawal(
        amount,
        normalizedPayoutDetails
      );

      setMessage(
        result.message || "Withdrawal request submitted."
      );

      setCoinAmount("");
      setPayoutDetails({ ...INITIAL_PAYOUT_DETAILS });

      await loadWallet();
    } catch (err) {
      setError(
        err.message || "Unable to submit the withdrawal request."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const balance = Number(wallet?.balance ?? 0);
  const reserved = Number(wallet?.reservedBalance ?? 0);

  const available = Number(
    wallet?.availableBalance ?? balance - reserved
  );

  async function copyUpiId() {
    setError("");
    setMessage("");

    try {
      await navigator.clipboard.writeText(UPI_ID);
      setMessage("UPI ID copied successfully.");
    } catch {
      setError(
        "Unable to copy UPI ID. Please copy it manually."
      );
    }
  }

  return (
    <section className="cc-wallet-page">
      <header className="cc-wallet-header">
        <div>
          <p className="cc-wallet-eyebrow">YOUR ACCOUNT</p>
          <h1>My Wallet</h1>
          <p>Manage your coins, deposits, and withdrawals.</p>
        </div>

        <button
          type="button"
          className="cc-wallet-refresh"
          onClick={async () => {
            await loadWallet();
            await loadDeposits();
          }}
          disabled={loading || refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      {loading && (
        <p className="cc-wallet-message" role="status">
          Loading your wallet...
        </p>
      )}

      {error && (
        <div className="cc-wallet-alert error" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="cc-wallet-alert success" role="status">
          {message}
        </div>
      )}

      {/* Wallet balance cards */}
      <div className="cc-wallet-balance-grid">
        <article className="cc-wallet-balance-card primary">
          <span>Total wallet balance</span>
          <strong>
            {walletLoaded
              ? `${balance.toLocaleString("en-IN")} coins`
              : "—"}
          </strong>
          <small>All coins currently in your wallet</small>
        </article>

        <article className="cc-wallet-balance-card">
          <span>Available balance</span>
          <strong>
            {walletLoaded
              ? `${available.toLocaleString("en-IN")} coins`
              : "—"}
          </strong>
          <small>Available after reserved withdrawals</small>
        </article>

        <article className="cc-wallet-balance-card">
          <span>Reserved balance</span>
          <strong>
            {walletLoaded
              ? `${reserved.toLocaleString("en-IN")} coins`
              : "—"}
          </strong>
          <small>Temporarily reserved for pending requests</small>
        </article>
      </div>

      {/* Deposit and withdrawal tabs */}
      <div
        className="cc-wallet-tabs"
        role="tablist"
        aria-label="Wallet actions"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "deposit"}
          className={activeTab === "deposit" ? "active" : ""}
          onClick={() => {
            setActiveTab("deposit");
            setError("");
            setMessage("");
          }}
        >
          Add Coins
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "withdraw"}
          className={activeTab === "withdraw" ? "active" : ""}
          onClick={() => {
            setActiveTab("withdraw");
            setError("");
            setMessage("");
          }}
        >
          Withdraw
        </button>
      </div>

      {/* Deposit tab */}
      {activeTab === "deposit" && (
        <div className="cc-wallet-deposit-layout">
          <section className="cc-wallet-panel cc-wallet-payment-panel">
            <h2>Deposit Coins</h2>

            <p className="cc-wallet-description">
              Pay using your UPI app. After paying, submit the
              transaction reference and screenshot for verification.
            </p>

            <div className="cc-wallet-qr-container">
              <img
                src={paymentQr}
                alt="Paytm UPI payment QR code"
                className="cc-wallet-payment-qr"
              />

              <p className="cc-wallet-payee">
                Payee: Kotari Swamy
              </p>

              <p className="cc-wallet-description">
                Scan this QR code using your UPI app.
              </p>
            </div>

            <label htmlFor="deposit-upi-id">UPI ID</label>

            <div className="cc-wallet-upi-row">
              <input
                id="deposit-upi-id"
                type="text"
                value={UPI_ID}
                readOnly
              />

              <button
                type="button"
                className="cc-wallet-secondary-button"
                onClick={copyUpiId}
              >
                Copy
              </button>
            </div>

            <p className="cc-wallet-payment-warning">
              Verify the recipient name and amount in your UPI app
              before completing payment.
            </p>
          </section>

          <section className="cc-wallet-panel">
            <h2>Submit Payment</h2>

            <p className="cc-wallet-description">
              Complete your payment first, then submit the details below.
            </p>

            <p className="cc-wallet-processing-note">
              <strong>Note:</strong> After submitting your request, please wait up to {"30\u201345"} minutes for processing. Avoid submitting duplicate requests while your request is pending.
            </p>

            <form onSubmit={handleDeposit}>
              <label htmlFor="deposit-amount">
                Amount paid (₹)
              </label>

              <input
                id="deposit-amount"
                type="number"
                min="1"
                max="100000"
                step="1"
                value={depositAmount}
                onChange={(event) =>
                  setDepositAmount(event.target.value)
                }
                placeholder="Enter amount paid"
                required
              />

              <label htmlFor="deposit-utr">
                UTR / transaction reference
              </label>

              <input
                id="deposit-utr"
                type="text"
                value={depositUtr}
                onChange={(event) =>
                  setDepositUtr(event.target.value.trimStart())
                }
                placeholder="Enter payment reference"
                minLength={8}
                maxLength={40}
                autoComplete="off"
                required
              />

              <label htmlFor="deposit-payment-proof">
                Payment screenshot (JPG, PNG, WEBP; max 5 MB)
              </label>

              <input
                id="deposit-payment-proof"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) =>
                  setPaymentProof(event.target.files?.[0] || null)
                }
                required
              />

              <button
                type="submit"
                className="cc-wallet-primary-button"
                disabled={depositSubmitting}
              >
                {depositSubmitting
                  ? "Submitting..."
                  : "Submit Deposit Request"}
              </button>
            </form>

            <p className="cc-wallet-payment-warning">
              Your request remains pending until an administrator
              verifies the payment. A screenshot does not automatically
              credit coins.
            </p>
          </section>

          {/* Deposit history */}
          <details className="cc-wallet-panel cc-wallet-deposit-history cc-wallet-history-accordion">
            <summary className="cc-wallet-history-summary">
              <div className="cc-wallet-history-heading">
                <div>
                  <h2>Deposit History</h2>
                  <p>Review your recent deposit requests.</p>
                </div>
                <span className="cc-wallet-history-count">
                  {deposits.length}{" "}
                  {deposits.length === 1 ? "request" : "requests"}
                </span>
              </div>
            </summary>

            {deposits.length === 0 ? (
              <p className="cc-wallet-empty">
                No deposit requests yet.
              </p>
            ) : (
              <div className="cc-wallet-table-wrapper">
                <table className="cc-wallet-table">
                  <thead>
                    <tr>
                      <th>Requested</th>
                      <th>Amount</th>
                      <th>UTR / Reference</th>
                      <th>Status</th>
                      <th>Rejection reason</th>
                    </tr>
                  </thead>

                  <tbody>
                    {deposits.map((deposit) => (
                      <tr key={deposit._id || deposit.utr}>
                        <td>{formatDate(deposit.createdAt)}</td>

                        <td>
                          ₹
                          {Number(deposit.amount || 0).toLocaleString(
                            "en-IN"
                          )}
                        </td>

                        <td>{deposit.utr || "—"}</td>

                        <td>
                          <span
                            className={`cc-wallet-status ${getStatusClass(
                              deposit.status
                            )}`}
                          >
                            {deposit.status || "PENDING"}
                          </span>
                        </td>

                        <td>
                          {String(deposit.status || "").toUpperCase() === "REJECTED" ? (
                            <div className="cc-wallet-deposit-rejection-reason">
                              <strong>Why it was rejected</strong>
                              <p>
                                {deposit.rejectionReason ||
                                  "Your deposit was rejected. Please contact support for details."}
                              </p>
                            </div>
                          ) : (
                            <span className="cc-wallet-no-rejection-reason">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </div>
      )}

      {/* Withdrawal tab */}
      {activeTab === "withdraw" && (
        <>
          <div className="cc-wallet-content-grid">
            <section className="cc-wallet-panel">
              <h2>Request a withdrawal</h2>

              <p className="cc-wallet-description">
                Enter your withdrawal amount and payout details.
                An administrator will review your request.
              </p>

              <p className="cc-wallet-processing-note">
                <strong>Note:</strong> After submitting your request, please wait up to {"30\u201345"} minutes for processing. Avoid submitting duplicate requests while your request is pending.
              </p>

              <form onSubmit={handleWithdrawal}>
                <label htmlFor="wallet-coin-amount">
                  Amount in coins
                </label>

                <input
                  id="wallet-coin-amount"
                  type="number"
                  min="1"
                  step="1"
                  max={walletLoaded ? available : undefined}
                  value={coinAmount}
                  onChange={(event) =>
                    setCoinAmount(event.target.value)
                  }
                  placeholder="Enter coin amount"
                  required
                />

                <div className="cc-wallet-conversion">
                  Current configured conversion: 1 coin = ₹1
                </div>

                <div className="cc-wallet-form-divider" />

                <h3>Personal details</h3>

                <label htmlFor="withdrawal-full-name">
                  Full name
                </label>

                <input
                  id="withdrawal-full-name"
                  name="fullName"
                  type="text"
                  value={payoutDetails.fullName}
                  onChange={updatePayoutField}
                  placeholder="Enter your full name"
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                  required
                />

                <label htmlFor="withdrawal-mobile">
                  Mobile number
                </label>

                <input
                  id="withdrawal-mobile"
                  name="mobileNumber"
                  type="tel"
                  inputMode="numeric"
                  value={payoutDetails.mobileNumber}
                  onChange={updatePayoutField}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  autoComplete="tel-national"
                  required
                />

                <label htmlFor="withdrawal-method">
                  Withdrawal method
                </label>

                <select
                  id="withdrawal-method"
                  name="method"
                  value={payoutDetails.method}
                  onChange={updatePayoutField}
                  required
                >
                  <option value="UPI">UPI</option>
                  <option value="BANK">Bank Transfer</option>
                </select>

                {payoutDetails.method === "UPI" && (
                  <div className="cc-wallet-payout-fields">
                    <h3>UPI details</h3>

                    <label htmlFor="withdrawal-upi">
                      UPI ID
                    </label>

                    <input
                      id="withdrawal-upi"
                      name="upiId"
                      type="text"
                      value={payoutDetails.upiId}
                      onChange={updatePayoutField}
                      placeholder="example@upi"
                      maxLength={100}
                      autoComplete="off"
                      required
                    />
                  </div>
                )}

                {payoutDetails.method === "BANK" && (
                  <div className="cc-wallet-payout-fields">
                    <h3>Bank account details</h3>

                    <label htmlFor="withdrawal-account-holder">
                      Account holder name
                    </label>

                    <input
                      id="withdrawal-account-holder"
                      name="accountHolderName"
                      type="text"
                      value={payoutDetails.accountHolderName}
                      onChange={updatePayoutField}
                      placeholder="Name on bank account"
                      maxLength={100}
                      autoComplete="name"
                      required
                    />

                    <label htmlFor="withdrawal-account-number">
                      Bank account number
                    </label>

                    <input
                      id="withdrawal-account-number"
                      name="accountNumber"
                      type="password"
                      inputMode="numeric"
                      value={payoutDetails.accountNumber}
                      onChange={updatePayoutField}
                      placeholder="Enter account number"
                      minLength={9}
                      maxLength={18}
                      autoComplete="off"
                      required
                    />

                    <label htmlFor="withdrawal-ifsc">
                      IFSC code
                    </label>

                    <input
                      id="withdrawal-ifsc"
                      name="ifscCode"
                      type="text"
                      value={payoutDetails.ifscCode}
                      onChange={updatePayoutField}
                      placeholder="e.g. SBIN0001234"
                      maxLength={11}
                      autoCapitalize="characters"
                      autoComplete="off"
                      required
                    />

                    <label htmlFor="withdrawal-bank-name">
                      Bank name
                    </label>

                    <input
                      id="withdrawal-bank-name"
                      name="bankName"
                      type="text"
                      value={payoutDetails.bankName}
                      onChange={updatePayoutField}
                      placeholder="Enter bank name"
                      maxLength={100}
                      autoComplete="off"
                      required
                    />
                  </div>
                )}

                <div className="cc-wallet-form-notice">
                  Check your payout details carefully before submitting.
                  Incorrect details may delay your withdrawal.
                </div>

                <button
                  type="submit"
                  className="cc-wallet-submit"
                  disabled={
                    submitting ||
                    !walletLoaded ||
                    available <= 0
                  }
                >
                  {submitting
                    ? "Submitting..."
                    : "Submit withdrawal request"}
                </button>
              </form>
            </section>

            <section className="cc-wallet-panel">
              <h2>Before you withdraw</h2>

              <ul className="cc-wallet-notes">
                <li>Only available coins can be requested.</li>
                <li>
                  Requested coins are reserved while the request is pending.
                </li>
                <li>
                  Choose either UPI or bank transfer and provide the
                  corresponding payout details.
                </li>
                <li>
                  An administrator processes and updates your request.
                </li>
                <li>
                  Check your request status in the history below.
                </li>
              </ul>
            </section>
          </div>

          {/* Withdrawal history */}
          <details className="cc-wallet-panel cc-wallet-history cc-wallet-history-accordion">
            <summary className="cc-wallet-history-summary">
              <div className="cc-wallet-history-heading">
                <div>
                  <h2>Withdrawal history</h2>
                  <p>Review your recent withdrawal requests.</p>
                </div>
                <span className="cc-wallet-history-count">
                  {withdrawals.length}{" "}
                  {withdrawals.length === 1 ? "request" : "requests"}
                </span>
              </div>
            </summary>

            {withdrawals.length === 0 ? (
              <p className="cc-wallet-empty">
                No withdrawal requests yet.
              </p>
            ) : (
              <div className="cc-wallet-table-wrapper">
                <table className="cc-wallet-table">
                  <thead>
                    <tr>
                      <th>Requested</th>
                      <th>Coins</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {withdrawals.map((item) => (
                      <tr key={item._id || item.reference}>
                        <td>{formatDate(item.createdAt)}</td>

                        <td>
                          {Number(item.coinAmount || 0).toLocaleString(
                            "en-IN"
                          )}
                        </td>

                        <td>
                          ₹
                          {Number(
                            item.cashAmount ?? item.coinAmount ?? 0
                          ).toLocaleString("en-IN")}
                        </td>

                        <td>
                          <span
                            className={`cc-wallet-status ${getStatusClass(
                              item.status
                            )}`}
                          >
                            {item.status || "PENDING"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>

          <details className="cc-wallet-panel cc-wallet-history cc-wallet-history-accordion">
            <summary className="cc-wallet-history-summary">
              <div className="cc-wallet-history-heading">
                <div>
                  <h2>Wallet transaction history</h2>
                  <p>
                    Deposits, contest entries, winnings, refunds and withdrawals.
                  </p>
                </div>
                <span className="cc-wallet-history-count">
                  {transactions.length}{" "}
                  {transactions.length === 1 ? "transaction" : "transactions"}
                </span>
              </div>
            </summary>

            {transactions.length === 0 ? (
              <p className="cc-wallet-empty">No wallet transactions yet.</p>
            ) : (
              <div className="cc-wallet-table-wrapper">
                <table className="cc-wallet-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Transaction</th>
                      <th>Direction</th>
                      <th>Coins</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((transaction) => (
                      <tr key={transaction._id || transaction.reference}>
                        <td>{formatDate(transaction.createdAt)}</td>
                        <td>
                          {transaction.description || transaction.type}
                          <small>{transaction.reference}</small>
                        </td>
                        <td>{transaction.direction}</td>
                        <td>
                          {Number(transaction.amount || 0).toLocaleString(
                            "en-IN"
                          )}
                        </td>
                        <td>
                          <span
                            className={`cc-wallet-status ${getStatusClass(
                              transaction.status
                            )}`}
                          >
                            {transaction.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        </>
      )}
    </section>
  );
}
