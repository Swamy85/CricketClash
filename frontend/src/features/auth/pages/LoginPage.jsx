
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useAppSession } from "../../../context/SessionContext";
import { loginUser } from "../services/authService";

const OTP_STORAGE_KEYS = [
  "cc_pending_email",
  "cc_registration_pending",
  "cc_otp_expires_at",
  "cc_otp_resend_at",
  "cc_verification_mode",
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkSession, startSession } = useAppSession();

  const [form, setForm] = useState({
    email: location.state?.email || "",
    password: "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificationRequired, setVerificationRequired] = useState(false);

  function handleChange(event) {
    setVerificationRequired(false);
    setError("");

    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
  }

  function prepareEmailVerification() {
    const email = form.email.trim().toLowerCase();

    if (!email) return;

    sessionStorage.setItem("cc_pending_email", email);
    sessionStorage.setItem("cc_verification_mode", "legacy");
    sessionStorage.removeItem("cc_registration_pending");

    // No OTP has been requested yet. Allow the verification
    // page to request a fresh code immediately.
    sessionStorage.setItem("cc_otp_expires_at", "0");
    sessionStorage.setItem("cc_otp_resend_at", "0");
  }

  async function handleLogin(event) {
    event.preventDefault();

    if (busy) return;

    setError("");
    setVerificationRequired(false);
    setBusy(true);

    try {
      await loginUser({
        email: form.email.trim().toLowerCase(),
        password: form.password,
      });

      const started = startSession();

      if (!started) {
        throw new Error(
          "Unable to start your session. Please try again."
        );
      }

      const sessionValid = await checkSession();

      if (!sessionValid) {
        throw new Error(
          "Login succeeded, but your session could not be verified. Please try again."
        );
      }

      OTP_STORAGE_KEYS.forEach((key) =>
        sessionStorage.removeItem(key)
      );
      sessionStorage.removeItem("cc_logout_reason");

      const requestedPath = location.state?.from?.pathname;
      const restrictedPaths = [
        "/login",
        "/register",
        "/verify-email",
        "/admin/login",
      ];

      const safePath =
        requestedPath &&
        requestedPath.startsWith("/") &&
        !requestedPath.startsWith("//") &&
        !restrictedPaths.includes(requestedPath)
          ? requestedPath
          : "/dashboard";

      navigate(safePath, { replace: true });
    } catch (err) {
      setError(
        err.message || "Something went wrong. Please try again."
      );

      const needsVerification =
        err.code === "EMAIL_NOT_VERIFIED" ||
        err.code === "LEGACY_VERIFICATION_REQUIRED";

      setVerificationRequired(needsVerification);

      if (needsVerification) {
        sessionStorage.setItem(
          "cc_pending_email",
          form.email.trim().toLowerCase()
        );
        sessionStorage.setItem("cc_verification_mode", "legacy");
        sessionStorage.removeItem("cc_registration_pending");
        sessionStorage.setItem("cc_otp_expires_at", "0");
        sessionStorage.setItem("cc_otp_resend_at", "0");
      }
    } finally {
      setBusy(false);
    }
  }

  const params = new URLSearchParams(location.search);
  const logoutReason = params.get("reason");
  const passwordReset =
    params.get("passwordReset") === "success";
  const sessionExpired = ["timeout", "expired"].includes(
    logoutReason
  );

  return (
    <main className="split-auth-page">
      <section className="split-auth-hero">
        <Link to="/" className="split-auth-logo">
          <span className="split-auth-logo-icon">C</span>
          <span>
            Cricket<span>Clash</span>
          </span>
        </Link>

        <div className="split-auth-hero-content">
          <span className="split-auth-tag">
            THE ULTIMATE 1V1 CRICKET SHOWDOWN
          </span>

          <h1>
            Every ball.
            <br />
            Every run.
            <br />
            <span>One winner.</span>
          </h1>

          <p>
            Step onto the digital pitch, challenge your opponents,
            and prove your cricket skills. Your next big win starts here.
          </p>

          <div className="split-auth-features">
            <div className="split-auth-feature">
              <span className="split-auth-feature-icon">⚡</span>
              <div>
                <strong>Head-to-head battles</strong>
                <small>Challenge players one-on-one</small>
              </div>
            </div>

            <div className="split-auth-feature">
              <span className="split-auth-feature-icon">🏆</span>
              <div>
                <strong>Compete to win</strong>
                <small>Every match is a new opportunity</small>
              </div>
            </div>

            <div className="split-auth-feature">
              <span className="split-auth-feature-icon">📊</span>
              <div>
                <strong>Build your record</strong>
                <small>Track your journey on the pitch</small>
              </div>
            </div>
          </div>
        </div>

        <div className="split-auth-footer">
          <span>MADE FOR CRICKET LOVERS</span>
          <span>YOUR GAME. YOUR GLORY.</span>
        </div>

        <div className="split-auth-decoration split-auth-decoration-one" />
        <div className="split-auth-decoration split-auth-decoration-two" />
      </section>

      <section className="split-auth-form-section">
        <div className="split-auth-mobile-logo">
          <Link to="/" className="split-auth-logo">
            <span className="split-auth-logo-icon">C</span>
            <span>
              Cricket<span>Clash</span>
            </span>
          </Link>
        </div>

        <div className="split-auth-form-wrap">
          <div className="split-auth-heading">
            <span className="split-auth-eyebrow">WELCOME BACK</span>
            <h2>Login to your account</h2>
            <p>Pick up where your cricket journey left off.</p>
          </div>

          {sessionExpired && (
            <div className="auth-error" role="status">
              {logoutReason === "timeout"
                ? "Your session expired due to inactivity. Please log in again."
                : "Your session expired or was revoked. Please log in again."}
            </div>
          )}

          {location.state?.verified && (
            <div className="auth-success" role="status">
              Email verified successfully! You can now log in.
            </div>
          )}

          {(location.state?.passwordReset || passwordReset) && (
            <div className="auth-success" role="status">
              Password reset successfully. Log in with your new password.
            </div>
          )}

          {error && (
            <div className="auth-error" role="alert">
              {error}
              {verificationRequired && (
                <>
                  {" "}
                  <Link
                    to="/verify-email"
                    onClick={prepareEmailVerification}
                  >
                    Verify Email / Resend OTP
                  </Link>
                </>
              )}
            </div>
          )}

          <form onSubmit={handleLogin} className="split-auth-form">
            <div className="split-auth-field">
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                type="email"
                name="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handleChange}
                autoComplete="email"
                required
              />
            </div>

            <div className="split-auth-field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                name="password"
                placeholder="Enter your password"
                value={form.password}
                onChange={handleChange}
                autoComplete="current-password"
                required
              />
              <Link
                className="split-auth-forgot-link"
                to="/forgot-password"
              >
                Forgot Password?
              </Link>
            </div>

            <button
              className="split-auth-submit"
              type="submit"
              disabled={busy}
            >
              {busy ? "Logging in..." : "Login to CricketClash"}
              {!busy && <span>→</span>}
            </button>
          </form>

          <div className="split-auth-divider">
            <span>NEW TO CRICKETCLASH?</span>
          </div>

          <p className="split-auth-switch">
            Don't have an account? <Link to="/register">Create account</Link>
          </p>

          <p className="split-auth-admin">
            Managing CricketClash?{" "}
            <Link to="/admin/login">Administration →</Link>
          </p>

          <p className="split-auth-terms">
            By continuing, you agree to play fairly and respect
            the CricketClash community.
          </p>
        </div>

        <div className="split-auth-bottom">
          <Link to="/">← Back to home</Link>
          <span>© CricketClash</span>
        </div>
      </section>
    </main>
  );
}
