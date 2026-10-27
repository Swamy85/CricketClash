
import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "../services/adminSession";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import "../styles/AdminWithdrawalsPage.css";

const STATUS_OPTIONS = [
  "ALL",
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "FAILED",
  "REJECTED",
  "CANCELLED",
];

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : formatIndiaDateTime(date);
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function statusClass(status) {
  return String(status || "PENDING").toLowerCase();
}

function displayError(data, fallback) {
  return data?.message || fallback;
}

async function readResponse(response) {
  let data = {};

  try {
    data = await response.json();
  } catch {
    // The server may return an empty or non-JSON response.
  }

  if (!response.ok || data.success === false) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Your administrator session has expired or lacks permission. Please sign in again."
      );
    }

    throw new Error(
      displayError(data, "The request could not be completed.")
    );
  }

  return data;
}

export default function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState([]);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [notificationRetryId, setNotificationRetryId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [selectedWithdrawal, setSelectedWithdrawal] = useState(null);
  const [showSensitiveDetails, setShowSensitiveDetails] = useState(false);

  const [payoutReference, setPayoutReference] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [finalAction, setFinalAction] = useState("");
  const requestRef = useRef(null);

  const loadWithdrawals = useCallback(
    async ({ silent = false, manual = false } = {}) => {
      if (requestRef.current) return;
      const controller = new AbortController();
      requestRef.current = controller;
      if (manual) {
        setRefreshing(true);
        setError("");
        setMessage("");
      } else if (!silent) {
        setLoading(true);
      }

      try {
        const query =
          statusFilter === "ALL"
            ? ""
            : `?status=${encodeURIComponent(statusFilter)}`;

        const response = await adminFetch(
          `/api/admin/withdrawals${query}`,
          { signal: controller.signal }
        );

        const data = await readResponse(response);
        const items = data.withdrawals;

        if (!Array.isArray(items)) {
          throw new Error(
            "The server returned an unexpected withdrawal list."
          );
        }

        setWithdrawals(items);
        setError("");
        if (manual) setMessage("Withdrawal requests updated.");

        // Refresh the selected record if it is still in the result.
        setSelectedWithdrawal((current) => {
          if (!current) return null;

          return (
            items.find((item) => item._id === current._id) ||
            current
          );
        });
      } catch (err) {
        if (!silent && err.name !== "AbortError") {
          setError(err.message || "Unable to load withdrawal requests.");
        }
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          if (!silent && !manual) setLoading(false);
          if (manual) setRefreshing(false);
        }
      }
    },
    [statusFilter]
  );

  useEffect(() => {
    void loadWithdrawals();
    const timer = window.setInterval(
      () => void loadWithdrawals({ silent: true }),
      20_000
    );
    return () => {
      window.clearInterval(timer);
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
    };
  }, [loadWithdrawals]);

  function openReview(withdrawal) {
    setSelectedWithdrawal(withdrawal);
    setShowSensitiveDetails(false);
    setPayoutReference(withdrawal.payoutReference || "");
    setFailureReason(withdrawal.failureReason || "");
    setFinalAction("");
    setError("");
    setMessage("");
  }

  function closeReview() {
    if (actionLoading) return;

    setSelectedWithdrawal(null);
    setShowSensitiveDetails(false);
    setPayoutReference("");
    setFailureReason("");
    setFinalAction("");
  }

  async function retryNotification(withdrawal) {
    setNotificationRetryId(withdrawal._id);
    setError("");
    setMessage("");
    try {
      const response = await adminFetch(
        `/api/admin/withdrawals/${withdrawal._id}/notification/retry`,
        { method: "POST" }
      );
      const data = await readResponse(response);
      setMessage(data.message || "Email notification retry finished.");
      await loadWithdrawals({ silent: true });
    } catch (retryError) {
      setError(retryError.message || "Unable to retry the email notification.");
    } finally {
      setNotificationRetryId("");
    }
  }

  async function runAction(action, endpoint, body, successMessage) {
    if (!selectedWithdrawal || actionLoading) return;

    setActionLoading(action);
    setError("");
    setMessage("");

    try {
      const response = await adminFetch(endpoint, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await readResponse(response);

      setMessage(data.message || successMessage);
      setFinalAction("");
      setPayoutReference("");
      setFailureReason("");

      // Refresh using the current filter after the server confirms success.
      await loadWithdrawals({ silent: true });

      // If the request disappeared from the current filter, close the review.
      if (
        statusFilter !== "ALL" &&
        !["PENDING", "PROCESSING"].includes(statusFilter)
      ) {
        setSelectedWithdrawal(null);
      } else if (
        ["FAILED", "REJECTED", "SUCCESS"].includes(
          data.withdrawal?.status
        )
      ) {
        setSelectedWithdrawal(null);
      } else if (data.withdrawal) {
        setSelectedWithdrawal(data.withdrawal);
      }

    } catch (err) {
      setError(
        err.message || "Unable to update this withdrawal."
      );
    } finally {
      setActionLoading("");
    }
  }

  async function handleStartProcessing() {
    if (!selectedWithdrawal) return;

    await runAction(
      "process",
      `/api/admin/withdrawals/${selectedWithdrawal._id}/process`,
      {},
      "Withdrawal marked as processing."
    );
  }

  async function handleCompleteWithdrawal(event) {
    event.preventDefault();

    if (!payoutReference.trim()) {
      setError("Enter the verified payout reference.");
      return;
    }

    if (
      !window.confirm(
        "Confirm that the actual payment has been completed and verified before marking this withdrawal successful."
      )
    ) {
      return;
    }

    await runAction(
      "success",
      `/api/admin/withdrawals/${selectedWithdrawal._id}/success`,
      { payoutReference: payoutReference.trim() },
      "Withdrawal completed."
    );
  }

  async function handleFailOrReject(event) {
    event.preventDefault();

    if (!failureReason.trim()) {
      setError("Enter a reason for failing or rejecting this request.");
      return;
    }

    const rejected = finalAction === "reject";

    if (!["reject", "fail"].includes(finalAction)) {
      setError("Choose whether to reject or fail the withdrawal.");
      return;
    }

    const confirmed = window.confirm(
      `Confirm ${rejected ? "rejection" : "failure"} of this withdrawal? Reserved coins will be released.`
    );

    if (!confirmed) return;

    await runAction(
      rejected ? "reject" : "fail",
      `/api/admin/withdrawals/${selectedWithdrawal._id}/fail`,
      {
        reason: failureReason.trim(),
        rejected,
      },
      rejected
        ? "Withdrawal rejected and reserved coins released."
        : "Withdrawal failed and reserved coins released."
    );
  }

  const normalizedSearch = search.trim().toLowerCase();

  const filteredWithdrawals = withdrawals.filter((item) => {
    const user = item.user || {};
    const details = item.payoutDetails || {};

    const searchableValues = [
      item.reference,
      item._id,
      user.username,
      user.userId,
      user.email,
      details.fullName,
      details.mobileNumber,
      details.upiId,
      details.bankName,
      item.payoutReference,
    ];

    return searchableValues.some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  });

  const counts = withdrawals.reduce(
    (result, item) => {
      const status = String(item.status || "PENDING").toUpperCase();
      result[status] = (result[status] || 0) + 1;
      return result;
    },
    {}
  );

  const details = selectedWithdrawal?.payoutDetails || {};
  const isPending = selectedWithdrawal?.status === "PENDING";
  const isProcessing = selectedWithdrawal?.status === "PROCESSING";
  const canFailOrReject = isPending || isProcessing;

  function maskAccountNumber(value) {
    const account = String(value || "");

    if (!account) return "—";
    if (showSensitiveDetails) return account;

    return `${"•".repeat(Math.max(0, account.length - 4))}${account.slice(-4)}`;
  }

  return (
    <section className="admin-withdrawals-page">
      <header className="aw-page-header">
        <div>
          <p className="aw-eyebrow">FINANCIAL MANAGEMENT</p>
          <h1>Withdrawal Management</h1>
          <p>
            Review player withdrawal requests and record their
            processing outcomes.
          </p>
        </div>

        <button
          type="button"
          className="aw-button aw-button-secondary"
          onClick={() => loadWithdrawals({ manual: true })}
          disabled={loading || refreshing || Boolean(actionLoading)}
        >
          {refreshing ? "Refreshing..." : "↻ Refresh"}
        </button>
      </header>

      {error && (
        <div className="aw-alert aw-alert-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {message && (
        <div className="aw-alert aw-alert-success" role="status">
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      <div className="aw-summary-grid">
        <article className="aw-summary-card">
          <span>Pending</span>
          <strong>{counts.PENDING || 0}</strong>
          <small>Awaiting review</small>
        </article>

        <article className="aw-summary-card">
          <span>Processing</span>
          <strong>{counts.PROCESSING || 0}</strong>
          <small>Transfer in progress</small>
        </article>

        <article className="aw-summary-card">
          <span>Successful</span>
          <strong>{counts.SUCCESS || 0}</strong>
          <small>Completed requests</small>
        </article>

        <article className="aw-summary-card">
          <span>Failed / Rejected</span>
          <strong>
            {(counts.FAILED || 0) + (counts.REJECTED || 0)}
          </strong>
          <small>Unsuccessful requests</small>
        </article>
      </div>

      <section className="aw-panel">
        <div className="aw-toolbar">
          <div>
            <h2>Withdrawal requests</h2>
            <p>
              {filteredWithdrawals.length} request
              {filteredWithdrawals.length === 1 ? "" : "s"} shown
            </p>
          </div>

          <div className="aw-filters">
            <label className="aw-search-label">
              <span className="aw-visually-hidden">
                Search withdrawals
              </span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search player or reference"
              />
            </label>

            <label>
              <span className="aw-visually-hidden">
                Filter by withdrawal status
              </span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status === "ALL"
                      ? "All statuses"
                      : status.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className="aw-state">
            <span className="aw-spinner" />
            <p>Loading withdrawal requests...</p>
          </div>
        ) : filteredWithdrawals.length === 0 ? (
          <div className="aw-state">
            <span className="aw-empty-icon">₹</span>
            <h3>No withdrawal requests found</h3>
            <p>
              Try another status filter or search term.
            </p>
          </div>
        ) : (
          <div className="aw-table-wrapper">
            <table className="aw-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Amount</th>
                  <th>Payout method</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Admin email</th>
                  <th>Review</th>
                </tr>
              </thead>

              <tbody>
                {filteredWithdrawals.map((item) => (
                  <tr key={item._id}>
                    <td>
                      <div className="aw-player-cell">
                        <strong>
                          {item.payoutDetails?.fullName ||
                            item.user?.username ||
                            "Unknown player"}
                        </strong>
                        <span>
                          {item.user?.username
                            ? `@${item.user.username}`
                            : item.user?.email || "Player details unavailable"}
                        </span>
                        <small>
                          Ref: {item.reference || item._id}
                        </small>
                      </div>
                    </td>

                    <td>
                      <strong>
                        {formatAmount(item.coinAmount)} coins
                      </strong>
                      <span className="aw-amount-sub">
                        ₹{formatAmount(item.cashAmount)}
                      </span>
                    </td>

                    <td>
                      <span className="aw-method-badge">
                        {item.payoutDetails?.method || "Not recorded"}
                      </span>
                      <small className="aw-table-subtext">
                        {item.payoutDetails?.method === "UPI"
                          ? item.payoutDetails?.upiId || "UPI ID unavailable"
                          : item.payoutDetails?.bankName || "Bank details unavailable"}
                      </small>
                    </td>

                    <td>{formatDate(item.requestedAt || item.createdAt)}</td>

                    <td>
                      <span
                        className={`aw-status aw-status-${statusClass(item.status)}`}
                      >
                        {item.status || "PENDING"}
                      </span>
                    </td>

                    <td>
                      <small className="aw-table-subtext">
                        {item.adminEmailNotification?.status || "PENDING"}
                        {item.adminEmailNotification?.lastErrorCode
                          ? ` (${item.adminEmailNotification.lastErrorCode})`
                          : ""}
                      </small>
                      {item.adminEmailNotification?.status !== "SENT" &&
                        item.adminEmailNotification?.status !== "SENDING" && (
                          <button
                            type="button"
                            className="aw-button aw-button-secondary"
                            disabled={Boolean(notificationRetryId)}
                            onClick={() => retryNotification(item)}
                          >
                            {notificationRetryId === item._id ? "Sending..." : "Retry email"}
                          </button>
                        )}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="aw-button aw-button-review"
                        onClick={() => openReview(item)}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedWithdrawal && (
        <div
          className="aw-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeReview();
            }
          }}
        >
          <section
            className="aw-review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aw-review-title"
          >
            <header className="aw-modal-header">
              <div>
                <p className="aw-eyebrow">WITHDRAWAL REVIEW</p>
                <h2 id="aw-review-title">Request details</h2>
                <p>
                  {selectedWithdrawal.reference ||
                    selectedWithdrawal._id}
                </p>
              </div>

              <button
                type="button"
                className="aw-modal-close"
                onClick={closeReview}
                disabled={Boolean(actionLoading)}
                aria-label="Close withdrawal review"
              >
                ×
              </button>
            </header>

            <div className="aw-modal-body">
              <div className="aw-review-summary">
                <div>
                  <span>Withdrawal amount</span>
                  <strong>
                    ₹{formatAmount(selectedWithdrawal.cashAmount)}
                  </strong>
                  <small>
                    {formatAmount(selectedWithdrawal.coinAmount)} coins
                  </small>
                </div>

                <span
                  className={`aw-status aw-status-${statusClass(selectedWithdrawal.status)}`}
                >
                  {selectedWithdrawal.status}
                </span>
              </div>

              <section className="aw-detail-section">
                <h3>Player information</h3>

                <div className="aw-detail-grid">
                  <div className="aw-detail-item">
                    <span>Full name</span>
                    <strong>{details.fullName || "Not provided"}</strong>
                  </div>

                  <div className="aw-detail-item">
                    <span>Mobile number</span>
                    <strong>{details.mobileNumber || "Not provided"}</strong>
                  </div>

                  <div className="aw-detail-item">
                    <span>Username</span>
                    <strong>
                      {selectedWithdrawal.user?.username || "—"}
                    </strong>
                  </div>

                  <div className="aw-detail-item">
                    <span>Email</span>
                    <strong>
                      {selectedWithdrawal.user?.email || "—"}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="aw-detail-section">
                <div className="aw-section-heading">
                  <h3>Payout details</h3>

                  <button
                    type="button"
                    className="aw-text-button"
                    onClick={() =>
                      setShowSensitiveDetails((previous) => !previous)
                    }
                  >
                    {showSensitiveDetails
                      ? "Hide sensitive details"
                      : "Reveal sensitive details"}
                  </button>
                </div>

                <div className="aw-detail-grid">
                  <div className="aw-detail-item">
                    <span>Method</span>
                    <strong>{details.method || "Not recorded"}</strong>
                  </div>

                  {details.method === "UPI" && (
                    <div className="aw-detail-item aw-detail-item-wide">
                      <span>UPI ID</span>
                      <strong>{details.upiId || "Not provided"}</strong>
                    </div>
                  )}

                  {details.method === "BANK" && (
                    <>
                      <div className="aw-detail-item">
                        <span>Account holder</span>
                        <strong>
                          {details.accountHolderName || "Not provided"}
                        </strong>
                      </div>

                      <div className="aw-detail-item">
                        <span>Bank name</span>
                        <strong>{details.bankName || "Not provided"}</strong>
                      </div>

                      <div className="aw-detail-item">
                        <span>Account number</span>
                        <strong>
                          {maskAccountNumber(details.accountNumber)}
                        </strong>
                      </div>

                      <div className="aw-detail-item">
                        <span>IFSC code</span>
                        <strong>{details.ifscCode || "Not provided"}</strong>
                      </div>
                    </>
                  )}
                </div>
              </section>

              <section className="aw-detail-section">
                <h3>Request timeline</h3>

                <div className="aw-detail-grid">
                  <div className="aw-detail-item">
                    <span>Requested</span>
                    <strong>
                      {formatDate(
                        selectedWithdrawal.requestedAt ||
                          selectedWithdrawal.createdAt
                      )}
                    </strong>
                  </div>

                  <div className="aw-detail-item">
                    <span>Last processed</span>
                    <strong>
                      {formatDate(selectedWithdrawal.processedAt)}
                    </strong>
                  </div>

                  <div className="aw-detail-item">
                    <span>Payout reference</span>
                    <strong>
                      {selectedWithdrawal.payoutReference || "—"}
                    </strong>
                  </div>

                  {selectedWithdrawal.failureReason && (
                    <div className="aw-detail-item aw-detail-item-wide">
                      <span>Failure / rejection reason</span>
                      <strong>{selectedWithdrawal.failureReason}</strong>
                    </div>
                  )}
                </div>
              </section>

              {isPending && (
                <section className="aw-action-section">
                  <h3>Start processing</h3>
                  <p>
                    Mark this request as processing when you are ready
                    to handle the payout.
                  </p>

                  <button
                    type="button"
                    className="aw-button aw-button-primary"
                    onClick={handleStartProcessing}
                    disabled={Boolean(actionLoading)}
                  >
                    {actionLoading === "process"
                      ? "Updating..."
                      : "Mark as processing"}
                  </button>
                </section>
              )}

              {isProcessing && (
                <section className="aw-action-section">
                  <h3>Complete payout</h3>
                  <p>
                    Enter the transfer reference only after verifying
                    that the payment was actually completed.
                  </p>

                  <form onSubmit={handleCompleteWithdrawal}>
                    <label htmlFor="aw-payout-reference">
                      Verified payout reference
                    </label>

                    <input
                      id="aw-payout-reference"
                      value={payoutReference}
                      onChange={(event) =>
                        setPayoutReference(event.target.value)
                      }
                      placeholder="Enter UTR or transfer reference"
                      maxLength={200}
                      required
                    />

                    <button
                      type="submit"
                      className="aw-button aw-button-primary"
                      disabled={Boolean(actionLoading)}
                    >
                      {actionLoading === "success"
                        ? "Completing..."
                        : "Confirm successful payout"}
                    </button>
                  </form>
                </section>
              )}

              {canFailOrReject && (
                <section className="aw-action-section aw-action-danger">
                  <h3>Fail or reject request</h3>
                  <p>
                    The backend will release the reserved coins if the
                    request is failed or rejected.
                  </p>

                  <form onSubmit={handleFailOrReject}>
                    <label htmlFor="aw-failure-reason">
                      Reason
                    </label>

                    <textarea
                      id="aw-failure-reason"
                      value={failureReason}
                      onChange={(event) =>
                        setFailureReason(event.target.value)
                      }
                      placeholder="Explain why the request is being failed or rejected"
                      rows={3}
                      maxLength={500}
                      required
                    />

                    <div className="aw-action-buttons">
                      <button
                        type="button"
                        className="aw-button aw-button-danger"
                        onClick={() => setFinalAction("fail")}
                        disabled={Boolean(actionLoading)}
                      >
                        Fail request
                      </button>

                      <button
                        type="button"
                        className="aw-button aw-button-warning"
                        onClick={() => setFinalAction("reject")}
                        disabled={Boolean(actionLoading)}
                      >
                        Reject request
                      </button>
                    </div>

                    {finalAction && (
                      <div className="aw-confirm-box">
                        <p>
                          Confirm you want to{" "}
                          <strong>{finalAction}</strong> this request.
                          Reserved coins will be released.
                        </p>

                        <div className="aw-action-buttons">
                          <button
                            type="submit"
                            className="aw-button aw-button-danger"
                            disabled={Boolean(actionLoading)}
                          >
                            {actionLoading === finalAction
                              ? "Updating..."
                              : `Confirm ${finalAction}`}
                          </button>

                          <button
                            type="button"
                            className="aw-button aw-button-secondary"
                            onClick={() => setFinalAction("")}
                            disabled={Boolean(actionLoading)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </form>
                </section>
              )}

              {!canFailOrReject && !isProcessing && (
                <div className="aw-terminal-notice">
                  This withdrawal is no longer actionable through
                  the available admin endpoints.
                </div>
              )}
            </div>

            <footer className="aw-modal-footer">
              <button
                type="button"
                className="aw-button aw-button-secondary"
                onClick={closeReview}
                disabled={Boolean(actionLoading)}
              >
                Close review
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
