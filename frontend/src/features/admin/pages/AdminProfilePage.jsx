
import { useState } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
} from "react-router-dom";

import {
  adminFetch,
  clearAdminSession,
} from "../services/adminSession";
import { formatIndiaDateTime } from "../../../utils/dateTime";

export default function AdminProfilePage() {
  const { admin } = useOutletContext();
  const navigate = useNavigate();

  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setError("");

    try {
      const response = await adminFetch("/api/auth/logout", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Logout failed.");
      }

      clearAdminSession();
      navigate("/admin/login", { replace: true });
    } catch (err) {
      setError(err.message || "Unable to log out.");
      setLoggingOut(false);
    }
  }

  const username = admin?.username || "Administrator";
  const email = admin?.email || "Not available";
  const adminId = admin?.adminId || admin?.userId || "Not available";
  const role = admin?.role === "admin" ? "Administrator" : "Unknown";
  const emailVerified = admin?.isEmailVerified === true;

  function formatDate(value) {
    if (!value) return "Not available";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Not available";
    }

    return formatIndiaDateTime(date);
  }

  return (
    <section className="admin-account-page">
      <div className="admin-account-breadcrumb">
        <Link to="/admin/dashboard">Dashboard</Link>
        <span>/</span>
        <strong>My Profile</strong>
      </div>

      <div className="admin-account-heading">
        <div>
          <span className="admin-account-eyebrow">
            ACCOUNT MANAGEMENT
          </span>
          <h1>My Profile</h1>
          <p>View your administrator account information and access.</p>
        </div>
      </div>

      <article className="admin-account-card">
        <div className="admin-account-cover" />

        <div className="admin-account-identity">
          <div className="admin-account-avatar">
            {username.charAt(0).toUpperCase()}
          </div>

          <div className="admin-account-identity-text">
            <h2>{username}</h2>
            <p>{email}</p>

            <span className="admin-account-role-badge">
              <span />
              {role}
            </span>
          </div>
        </div>

        <div className="admin-account-divider" />

        <div className="admin-account-section-heading">
          <h3>Account information</h3>
          <p>Your current administrator account details.</p>
        </div>

        <div className="admin-account-details-grid">
          <div className="admin-account-detail">
            <span className="admin-account-detail-icon">♙</span>
            <div>
              <span>Username</span>
              <strong>{username}</strong>
            </div>
          </div>

          <div className="admin-account-detail">
            <span className="admin-account-detail-icon">#</span>
            <div>
              <span>Admin ID</span>
              <strong>{adminId}</strong>
            </div>
          </div>

          <div className="admin-account-detail">
            <span className="admin-account-detail-icon">@</span>
            <div>
              <span>Email address</span>
              <strong>{email}</strong>
            </div>
          </div>

          <div className="admin-account-detail">
            <span className="admin-account-detail-icon">◆</span>
            <div>
              <span>Account role</span>
              <strong>{role}</strong>
            </div>
          </div>

          <div className="admin-account-detail">
            <span className="admin-account-detail-icon">✓</span>
            <div>
              <span>Email verification</span>
              <strong>
                {emailVerified ? "Verified" : "Not verified"}
              </strong>
            </div>
          </div>

          <div className="admin-account-detail">
            <span className="admin-account-detail-icon">▦</span>
            <div>
              <span>Account created</span>
              <strong>{formatDate(admin?.createdAt)}</strong>
            </div>
          </div>

          <div className="admin-account-detail">
            <span className="admin-account-detail-icon">◷</span>
            <div>
              <span>Last activity</span>
              <strong>{formatDate(admin?.lastActivityAt)}</strong>
            </div>
          </div>
        </div>

        <div className="admin-account-security-note">
          <span className="admin-account-security-icon">✓</span>
          <div>
            <strong>Protected administrator access</strong>
            <p>
              Your admin pages are protected by the existing
              server-verified administrator session.
            </p>
          </div>
        </div>

        {error && (
          <div className="admin-dashboard-error" role="alert">
            {error}
          </div>
        )}

        <div className="admin-account-footer">
          <div>
            <h3>Sign out</h3>
            <p>End your current administrator session.</p>
          </div>

          <button
            type="button"
            className="admin-account-logout"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <span aria-hidden="true">↪</span>
            {loggingOut ? "Signing out..." : "Logout"}
          </button>
        </div>
      </article>
    </section>
  );
}
