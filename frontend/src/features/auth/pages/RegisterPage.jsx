
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { registerUser } from "../services/authService";

export default function RegisterPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");

  function handleChange(event) {
    setForm((previous) => ({
      ...previous,
      [event.target.name]: event.target.value,
    }));
    setError("");
    setErrorCode("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (busy) return;

    setError("");
    setErrorCode("");

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }

    setBusy(true);

    try {
      const data = await registerUser(form);
      const pendingEmail = (
        data.email || form.email
      ).trim().toLowerCase();

      sessionStorage.setItem("cc_pending_email", pendingEmail);
      sessionStorage.setItem("cc_registration_pending", "true");
      sessionStorage.setItem("cc_verification_mode", "registration");
      sessionStorage.setItem("cc_otp_delivery_sent", String(data.sent === true));
      sessionStorage.setItem(
        "cc_otp_expires_at",
        String(Date.now() + 5 * 60 * 1000)
      );
      sessionStorage.setItem(
        "cc_otp_resend_at",
        String(Date.now() + 60 * 1000)
      );

      navigate("/verify-email", {
        replace: true,
        state: {
          email: pendingEmail,
          mode: "registration",
        },
      });
    } catch (err) {
      setErrorCode(err.code || "");

      if (err.code === "EMAIL_DELIVERY_FAILED") {
        setError(
          "We couldn't send your verification email. Please retry using the same email address."
        );
      } else if (
        err.code === "LEGACY_VERIFICATION_REQUIRED" ||
        err.code === "EMAIL_NOT_VERIFIED"
      ) {
        setError(
          "This account already exists but is not verified. Sign in to request a verification code."
        );
      } else if (err.code === "ACCOUNT_ALREADY_VERIFIED") {
        setError(
          "This email already has a verified account. Please sign in."
        );
      } else {
        setError(err.message || "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

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
            YOUR CRICKET JOURNEY STARTS HERE
          </span>

          <h1>
            Don't just
            <br />
            watch cricket.
            <br />
            <span>Play to win.</span>
          </h1>

          <p>
            Create your account, challenge other players, and turn
            your passion for cricket into exciting one-on-one battles.
          </p>

          <div className="split-auth-features">
            <div className="split-auth-feature">
              <span className="split-auth-feature-icon">🎯</span>
              <div>
                <strong>Quick registration</strong>
                <small>Get started in just a few steps</small>
              </div>
            </div>

            <div className="split-auth-feature">
              <span className="split-auth-feature-icon">✉️</span>
              <div>
                <strong>Verified account</strong>
                <small>Confirm your email with a secure OTP</small>
              </div>
            </div>

            <div className="split-auth-feature">
              <span className="split-auth-feature-icon">🔥</span>
              <div>
                <strong>Ready for the clash</strong>
                <small>Join the action after verification</small>
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

        <div className="split-auth-form-wrap split-auth-register-wrap">
          <div className="split-auth-heading">
            <span className="split-auth-eyebrow">JOIN THE COMMUNITY</span>
            <h2>Create your account</h2>
            <p>Set up your profile and get ready to compete.</p>
          </div>

          {error && (
            <div className="auth-error" role="alert">
              {error}
              {(
                errorCode === "ACCOUNT_ALREADY_VERIFIED" ||
                errorCode === "LEGACY_VERIFICATION_REQUIRED" ||
                errorCode === "EMAIL_NOT_VERIFIED"
              ) && (
                <>
                  {" "}
                  <Link
                    to="/login"
                    state={{ email: form.email.trim().toLowerCase() }}
                  >
                    {errorCode === "ACCOUNT_ALREADY_VERIFIED"
                      ? "Sign in"
                      : "Sign in to verify your existing account"}
                  </Link>
                </>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="split-auth-form">
            <div className="split-auth-field">
              <label htmlFor="register-username">Username</label>
              <input
                id="register-username"
                type="text"
                name="username"
                placeholder="Choose your username"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
                minLength={3}
                maxLength={24}
                required
              />
            </div>

            <div className="split-auth-field">
              <label htmlFor="register-email">Email address</label>
              <input
                id="register-email"
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
              <label htmlFor="register-password">Password</label>
              <input
                id="register-password"
                type="password"
                name="password"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={handleChange}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <div className="split-auth-field">
              <label htmlFor="register-confirm-password">
                Confirm password
              </label>
              <input
                id="register-confirm-password"
                type="password"
                name="confirmPassword"
                placeholder="Re-enter your password"
                value={form.confirmPassword}
                onChange={handleChange}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <button
              className="split-auth-submit"
              type="submit"
              disabled={busy}
            >
              {busy ? "Creating account..." : "Create account"}
              {!busy && <span>→</span>}
            </button>
          </form>

          <p className="split-auth-switch">
            Already have an account? <Link to="/login">Login</Link>
          </p>

          <p className="split-auth-terms">
            We'll send a six-digit verification code to your email.
            Your account will be activated after verification.
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
