
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  adminFetch,
  saveAdminSession,
} from "../services/adminSession";

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await adminFetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success || !data.sessionId) {
        throw new Error(data.message || "Admin sign-in failed.");
      }

      saveAdminSession(data.sessionId);
      navigate("/admin/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login">
      <section className="admin-login-brand">
        <div className="admin-brand-top">
          <div className="admin-brand-mark">C</div>
          <div>
            <div className="admin-brand-name">
              <span>Cricket</span>
              <span>Clash</span>
            </div>
            <div className="admin-brand-caption">
              Administration
            </div>
          </div>
        </div>

        <div className="admin-brand-content">
          <span className="admin-overline">
            <span className="admin-status-dot" />
            ADMINISTRATOR ACCESS
          </span>

          <h1>
            Manage the game.
            <br />
            <span>Lead the action.</span>
          </h1>

          <p>
            Your central workspace for managing fixtures, contests,
            players and platform operations.
          </p>

          <div className="admin-feature-list">
            <div className="admin-feature">
              <span className="admin-feature-number">01</span>
              <div>
                <strong>Match operations</strong>
                <small>Manage fixtures and match schedules</small>
              </div>
            </div>

            <div className="admin-feature">
              <span className="admin-feature-number">02</span>
              <div>
                <strong>Contest management</strong>
                <small>Configure contests and prize structures</small>
              </div>
            </div>

            <div className="admin-feature">
              <span className="admin-feature-number">03</span>
              <div>
                <strong>Platform oversight</strong>
                <small>Manage players and platform activity</small>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-brand-footer">
          <span>CRICKETCLASH ADMINISTRATION</span>
          <span>AUTHORIZED PERSONNEL ONLY</span>
        </div>
      </section>

      <section className="admin-login-panel">
        <div className="admin-login-panel-top">
          <span>SECURE ACCESS</span>
          <span className="admin-lock-symbol" aria-hidden="true">◆</span>
        </div>

        <div className="admin-login-form-wrap">
          <div className="admin-mobile-brand">
            <div className="admin-brand-mark">C</div>
            <div className="admin-brand-name">
              <span>Cricket</span>
              <span>Clash</span>
            </div>
          </div>

          <div className="admin-form-heading">
            <span className="admin-form-eyebrow">ADMIN PORTAL</span>
            <h2>Welcome back</h2>
            <p>Sign in with your administrator credentials.</p>
          </div>

          {new URLSearchParams(location.search).get("reason") === "expired" && (
            <div className="admin-login-error" role="status">
              Your administrator session expired or was revoked. Please sign in again.
            </div>
          )}

          <form className="admin-login-form" onSubmit={handleSubmit}>
            <label htmlFor="admin-email">Administrator email</label>
            <input
              id="admin-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />

            <div className="admin-password-label">
              <label htmlFor="admin-password">Password</label>
            </div>

            <div className="admin-password-wrap">
              <input
                id="admin-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                className="admin-password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {error && (
              <div className="admin-login-error" role="alert">
                {error}
              </div>
            )}

            <button
              className="admin-signin-button"
              type="submit"
              disabled={loading}
            >
              {loading ? "Authenticating..." : "Sign in to administration"}
              {!loading && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <div className="admin-security-note">
            <span aria-hidden="true">◆</span>
            <p>
              Restricted access. Your administrator credentials
              are verified securely.
            </p>
          </div>

          <div className="admin-login-back">
            <Link to="/login">← Return to player login</Link>
          </div>
        </div>

        <div className="admin-login-back">
          <Link to="/admin/forgot-password">Forgot Password?</Link>
        </div>

        <div className="admin-login-copyright">
          © CricketClash · Administration Portal
        </div>
      </section>
    </main>
  );
}
