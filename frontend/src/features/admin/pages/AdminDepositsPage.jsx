
import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "../services/adminSession";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import "../styles/AdminDepositsPage.css";

const STATUSES = ["ALL", "PENDING", "PROCESSING", "APPROVED", "REJECTED"];

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : formatIndiaDateTime(date);
}

function formatAmount(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
}

export default function AdminDepositsPage() {
  const [deposits, setDeposits] = useState([]);
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notificationBusyId, setNotificationBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedProof, setSelectedProof] = useState(null);
  const [proofLoadingId, setProofLoadingId] = useState("");
  const [rejectingDeposit, setRejectingDeposit] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const requestRef = useRef(null);

  const loadDeposits = useCallback(async ({ silent = false, manual = false } = {}) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    if (!silent && !manual) setLoading(true);
    if (manual) {
      setRefreshing(true);
      setError("");
      setMessage("");
    }

    try {
      const query =
        status === "ALL" ? "" : `?status=${encodeURIComponent(status)}`;

      const response = await adminFetch(`/api/admin/deposits${query}`, {
        signal: controller.signal,
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load deposits.");
      }

      setDeposits(data.deposits || []);
      setError("");
      if (manual) setMessage("Deposit requests updated.");
    } catch (err) {
      if (!silent && err.name !== "AbortError") {
        setError(err.message || "Unable to load deposit requests.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (!silent && !manual) setLoading(false);
        if (manual) setRefreshing(false);
      }
    }
  }, [status]);

  useEffect(() => {
    void loadDeposits();
    const timer = window.setInterval(
      () => void loadDeposits({ silent: true }),
      20_000
    );
    return () => {
      window.clearInterval(timer);
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
    };
  }, [loadDeposits]);

  // Fetch protected proof through adminFetch so the admin session header is sent.
  async function viewProof(deposit) {
    setError("");
    setMessage("");
    setProofLoadingId(deposit._id);

    try {
      const response = await adminFetch(
        `/api/admin/deposits/${deposit._id}/proof`
      );

      if (!response.ok) {
        let data = {};
        try {
          data = await response.json();
        } catch {
          // The server may return a non-JSON error.
        }

        throw new Error(data.message || "Unable to load payment screenshot.");
      }

      const blob = await response.blob();

      if (!blob.type.startsWith("image/")) {
        throw new Error("The payment proof response is not an image.");
      }

      const url = URL.createObjectURL(blob);

      setSelectedProof((previous) => {
        if (previous?.url) URL.revokeObjectURL(previous.url);

        return {
          url,
          utr: deposit.utr,
          username: deposit.user?.username || "Unknown player",
        };
      });
    } catch (err) {
      setError(err.message || "Unable to display payment screenshot.");
    } finally {
      setProofLoadingId("");
    }
  }

  function closeProof() {
    setSelectedProof((previous) => {
      if (previous?.url) URL.revokeObjectURL(previous.url);
      return null;
    });
  }

  async function approveDeposit(deposit) {
    const confirmed = window.confirm(
      `Confirm that ₹${deposit.amount} was received and verified for UTR ${deposit.utr}?`
    );

    if (!confirmed) return;

    setBusyId(deposit._id);
    setError("");
    setMessage("");

    try {
      const response = await adminFetch(
        `/api/admin/deposits/${deposit._id}/approve`,
        { method: "PATCH" }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to approve deposit.");
      }

      setMessage(data.message || "Deposit approved successfully.");
      await loadDeposits({ silent: true });
    } catch (err) {
      setError(err.message || "Unable to approve deposit.");
    } finally {
      setBusyId("");
    }
  }

  function startReject(deposit) {
    setRejectingDeposit(deposit);
    setRejectionReason("");
    setError("");
    setMessage("");
  }

  async function rejectDeposit() {
    if (!rejectingDeposit) return;

    const reason = rejectionReason.trim();

    if (!reason || reason.length > 500) {
      setError("Enter a rejection reason between 1 and 500 characters.");
      return;
    }

    async function retryNotification(deposit) {
      setNotificationBusyId(deposit._id);
      setError("");
      setMessage("");
      try {
        const response = await adminFetch(
          `/api/admin/deposits/${deposit._id}/notification/retry`,
          { method: "POST" }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to retry the email notification.");
        }
        setMessage(data.message);
        await loadDeposits({ silent: true });
      } catch (err) {
        setError(err.message || "Unable to retry the email notification.");
      } finally {
        setNotificationBusyId("");
      }
    }

    const depositId = rejectingDeposit._id;
    setBusyId(depositId);
    setError("");
    setMessage("");

    try {
      const response = await adminFetch(
        `/api/admin/deposits/${depositId}/reject`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to reject deposit.");
      }

      setMessage(data.message || "Deposit rejected.");
      setRejectingDeposit(null);
      setRejectionReason("");
      await loadDeposits({ silent: true });
    } catch (err) {
      setError(err.message || "Unable to reject deposit.");
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => {
    return () => {
      if (selectedProof?.url) URL.revokeObjectURL(selectedProof.url);
    };
  }, [selectedProof]);

  return (
    <section className="admin-deposits-page">
      <div className="admin-deposits-heading">
        <div>
          <p className="admin-deposits-eyebrow">WALLET MANAGEMENT</p>
          <h1>Deposits</h1>
          <p>Review payment references and verify incoming deposits.</p>
        </div>

        <button
          type="button"
          className="admin-deposits-refresh"
          onClick={() => loadDeposits({ manual: true })}
          disabled={loading || refreshing}
        >
          {refreshing ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      <div className="admin-deposits-filters">
        {STATUSES.map((item) => (
          <button
            key={item}
            type="button"
            className={status === item ? "is-active" : ""}
            onClick={() => setStatus(item)}
          >
            {item === "ALL" ? "All deposits" : item}
          </button>
        ))}
      </div>

      {error && (
        <div className="admin-deposits-alert error" role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>×</button>
        </div>
      )}

      {message && (
        <div className="admin-deposits-alert success" role="status">
          {message}
          <button type="button" onClick={() => setMessage("")}>×</button>
        </div>
      )}

      <div className="admin-deposits-summary">
        <div>
          <span>Requests shown</span>
          <strong>{deposits.length}</strong>
        </div>
        <div>
          <span>Pending requests shown</span>
          <strong>
            {deposits.filter((deposit) => deposit.status === "PENDING").length}
          </strong>
        </div>
      </div>

      <div className="admin-deposits-table-wrap">
        {loading ? (
          <p className="admin-deposits-empty">Loading deposit requests...</p>
        ) : deposits.length === 0 ? (
          <p className="admin-deposits-empty">
            No deposit requests found for this status.
          </p>
        ) : (
          <table className="admin-deposits-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Amount</th>
                <th>UTR / Reference</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Admin email</th>
                <th>Payment proof</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit._id}>
                  <td>
                    <strong>{deposit.user?.username || "Unknown player"}</strong>
                    <small>{deposit.user?.userId || deposit.user?.email || "—"}</small>
                  </td>

                  <td className="admin-deposits-amount">
                    {formatAmount(deposit.amount)}
                  </td>

                  <td className="admin-deposits-utr">{deposit.utr || "—"}</td>
                  <td>{formatDate(deposit.createdAt)}</td>

                  <td>
                    <span
                      className={`admin-deposits-status status-${String(
                        deposit.status || ""
                      ).toLowerCase()}`}
                    >
                      {deposit.status || "UNKNOWN"}
                    </span>
                  </td>

                  <td>
                    <small>
                      {deposit.adminEmailNotification?.status || "PENDING"}
                      {deposit.adminEmailNotification?.lastErrorCode
                        ? ` (${deposit.adminEmailNotification.lastErrorCode})`
                        : ""}
                    </small>
                    {deposit.adminEmailNotification?.status !== "SENT" &&
                      deposit.adminEmailNotification?.status !== "SENDING" && (
                        <button
                          type="button"
                          className="admin-deposits-proof-button"
                          disabled={Boolean(notificationBusyId)}
                          onClick={() => retryNotification(deposit)}
                        >
                          {notificationBusyId === deposit._id ? "Sending..." : "Retry email"}
                        </button>
                      )}
                  </td>

                  <td>
                    <button
                      type="button"
                      className="admin-deposits-proof-button"
                      onClick={() => viewProof(deposit)}
                      disabled={proofLoadingId === deposit._id}
                    >
                      {proofLoadingId === deposit._id
                        ? "Opening..."
                        : "View screenshot"}
                    </button>
                  </td>

                  <td>
                    {deposit.status === "PENDING" ? (
                      <div className="admin-deposits-actions">
                        <button
                          type="button"
                          className="admin-deposits-approve"
                          disabled={Boolean(busyId)}
                          onClick={() => approveDeposit(deposit)}
                        >
                          {busyId === deposit._id ? "Please wait..." : "Approve"}
                        </button>

                        <button
                          type="button"
                          className="admin-deposits-reject"
                          disabled={Boolean(busyId)}
                          onClick={() => startReject(deposit)}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="admin-deposits-no-action">No action</span>
                    )}

                    {deposit.status === "REJECTED" && deposit.rejectionReason && (
                      <small className="admin-deposits-reason">
                        Reason: {deposit.rejectionReason}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rejectingDeposit && (
        <div className="admin-deposits-modal-backdrop">
          <section
            className="admin-deposits-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deposit-reject-title"
          >
            <h2 id="deposit-reject-title">Reject deposit</h2>
            <p>
              Request from {rejectingDeposit.user?.username || "player"} for{" "}
              {formatAmount(rejectingDeposit.amount)}.
            </p>

            <label htmlFor="deposit-rejection-reason">
              Rejection reason
            </label>
            <textarea
              id="deposit-rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              maxLength={500}
              rows={4}
              placeholder="For example, payment could not be verified."
            />

            <div className="admin-deposits-modal-actions">
              <button
                type="button"
                onClick={() => setRejectingDeposit(null)}
                disabled={Boolean(busyId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-deposits-reject"
                onClick={rejectDeposit}
                disabled={Boolean(busyId)}
              >
                {busyId === rejectingDeposit._id ? "Rejecting..." : "Confirm rejection"}
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedProof && (
        <div
          className="admin-deposits-modal-backdrop"
          onClick={closeProof}
          role="presentation"
        >
          <section
            className="admin-deposits-proof-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Payment screenshot"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-deposits-proof-heading">
              <div>
                <h2>Payment screenshot</h2>
                <p>
                  {selectedProof.username} · UTR: {selectedProof.utr}
                </p>
              </div>
              <button type="button" onClick={closeProof} aria-label="Close screenshot">
                ×
              </button>
            </div>

            <img src={selectedProof.url} alt="Submitted payment proof" />
          </section>
        </div>
      )}
    </section>
  );
}
