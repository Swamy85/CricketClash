import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PASSWORD_RESET_EMAIL_KEY,
  PASSWORD_RESET_EXPIRY_KEY,
  PASSWORD_RESET_RESEND_KEY,
  PASSWORD_RESET_TOKEN_KEY,
  resetPassword,
  SESSION_STORAGE_KEY,
} from "../services/authService";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const email = sessionStorage.getItem(PASSWORD_RESET_EMAIL_KEY) || "";
  const resetToken = sessionStorage.getItem(PASSWORD_RESET_TOKEN_KEY) || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!email || !resetToken) {
      navigate("/forgot-password", { replace: true });
    }
  }, [email, navigate, resetToken]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    try {
      await resetPassword({ email, resetToken, password, confirmPassword });
      sessionStorage.removeItem(PASSWORD_RESET_EMAIL_KEY);
      sessionStorage.removeItem(PASSWORD_RESET_EXPIRY_KEY);
      sessionStorage.removeItem(PASSWORD_RESET_RESEND_KEY);
      sessionStorage.removeItem(PASSWORD_RESET_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem("cc_last_activity");
      window.location.replace("/login?passwordReset=success");
    } catch (requestError) {
      setError(requestError.message || "Unable to reset your password. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!email || !resetToken) return null;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link to="/" className="auth-brand">CricketClash</Link>
        <h1>Set a new password</h1>
        <p className="auth-subtitle">
          Choose a strong password for <strong>{email}</strong>. You’ll need to log in again on all devices.
        </p>
        {error && <div className="auth-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <small className="password-strength-hint">
            Use 8–72 bytes with uppercase and lowercase letters, a number, and a special character.
          </small>
          <label htmlFor="reset-password-confirm">Confirm password</label>
          <input
            id="reset-password-confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? "Updating password..." : "Reset password"}
          </button>
        </form>
      </section>
    </main>
  );
}
