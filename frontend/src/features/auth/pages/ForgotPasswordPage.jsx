import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PASSWORD_RESET_EMAIL_KEY,
  PASSWORD_RESET_EXPIRY_KEY,
  PASSWORD_RESET_RESEND_KEY,
  PASSWORD_RESET_TOKEN_KEY,
  requestPasswordReset,
} from "../services/authService";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await requestPasswordReset(normalizedEmail);
      const now = Date.now();
      sessionStorage.setItem(PASSWORD_RESET_EMAIL_KEY, normalizedEmail);
      sessionStorage.setItem(PASSWORD_RESET_EXPIRY_KEY, String(now + 5 * 60 * 1000));
      sessionStorage.setItem(PASSWORD_RESET_RESEND_KEY, String(now + 60 * 1000));
      sessionStorage.removeItem(PASSWORD_RESET_TOKEN_KEY);
      navigate("/verify-reset-otp");
    } catch (requestError) {
      setError(requestError.message || "Unable to process your request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link to="/" className="auth-brand">CricketClash</Link>
        <h1>Forgot password?</h1>
        <p className="auth-subtitle">
          Enter the email address registered to your player account. If an account
          exists, we’ll email a six-digit reset code.
        </p>

        {error && <div className="auth-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="forgot-password-email">Email address</label>
          <input
            id="forgot-password-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? "Sending code..." : "Send reset code"}
          </button>
        </form>

        <p className="auth-switch">
          Remembered your password? <Link to="/login">Back to login</Link>
        </p>
      </section>
    </main>
  );
}
