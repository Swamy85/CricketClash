import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  PASSWORD_RESET_EMAIL_KEY,
  PASSWORD_RESET_EXPIRY_KEY,
  PASSWORD_RESET_RESEND_KEY,
  PASSWORD_RESET_TOKEN_KEY,
  resendPasswordResetOtp,
  verifyPasswordResetOtp,
} from "../services/authService";

function secondsRemaining(key) {
  const deadline = Number(sessionStorage.getItem(key));
  return deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0;
}

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function VerifyPasswordResetOtpPage() {
  const navigate = useNavigate();
  const email = sessionStorage.getItem(PASSWORD_RESET_EMAIL_KEY) || "";
  const [otp, setOtp] = useState("");
  const [remaining, setRemaining] = useState(() => secondsRemaining(PASSWORD_RESET_EXPIRY_KEY));
  const [resendRemaining, setResendRemaining] = useState(() => secondsRemaining(PASSWORD_RESET_RESEND_KEY));
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("error");

  useEffect(() => {
    if (!email) {
      navigate("/forgot-password", { replace: true });
      return undefined;
    }

    const interval = window.setInterval(() => {
      setRemaining(secondsRemaining(PASSWORD_RESET_EXPIRY_KEY));
      setResendRemaining(secondsRemaining(PASSWORD_RESET_RESEND_KEY));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [email, navigate]);

  async function handleVerify(event) {
    event.preventDefault();
    if (busy || otp.length !== 6) return;

    setBusy(true);
    setMessage("");
    try {
      const result = await verifyPasswordResetOtp(email, otp);
      sessionStorage.setItem(PASSWORD_RESET_TOKEN_KEY, result.resetToken);
      navigate("/reset-password");
    } catch (error) {
      setMessage(error.message || "Invalid or expired code. Request a new code and try again.");
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (busy || resending || resendRemaining > 0) return;

    setResending(true);
    setMessage("");
    try {
      await resendPasswordResetOtp(email);
      const now = Date.now();
      sessionStorage.setItem(PASSWORD_RESET_EXPIRY_KEY, String(now + 5 * 60 * 1000));
      sessionStorage.setItem(PASSWORD_RESET_RESEND_KEY, String(now + 60 * 1000));
      setOtp("");
      setRemaining(300);
      setResendRemaining(60);
      setMessage("If an account exists, a new code has been sent.");
      setMessageType("success");
    } catch (error) {
      setMessage(error.message || "Unable to resend the code. Please try again.");
      setMessageType("error");
    } finally {
      setResending(false);
    }
  }

  if (!email) return null;
  const expired = remaining <= 0;

  return (
    <main className="otp-page">
      <div className="otp-glow otp-glow-one" />
      <div className="otp-glow otp-glow-two" />
      <section className="otp-card">
        <Link to="/" className="otp-brand">
          <span className="otp-brand-icon">C</span>
          <span>Cricket<span>Clash</span></span>
        </Link>
        <div className="otp-icon">✉️</div>
        <span className="otp-eyebrow">PASSWORD RECOVERY</span>
        <h1>Verify your code</h1>
        <p className="otp-description">Enter the six-digit code sent to</p>
        <p className="otp-email">{email}</p>
        <div className={`otp-timer ${expired ? "otp-timer-expired" : ""}`}>
          <span className="otp-timer-icon">◷</span>
          <div>
            <span className="otp-timer-label">{expired ? "Code expired" : "Time remaining"}</span>
            <strong>{formatTime(remaining)}</strong>
          </div>
          <span className="otp-timer-badge">{expired ? "EXPIRED" : "5 MIN"}</span>
        </div>

        <form onSubmit={handleVerify}>
          <label className="otp-label" htmlFor="password-reset-otp">Reset code</label>
          <input
            id="password-reset-otp"
            className="otp-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={otp}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy || expired}
            required
          />
          <p className="otp-hint">The code expires after five minutes. Never share it with anyone.</p>
          {message && (
            <div
              className={`otp-message ${messageType === "success" ? "otp-message-success" : ""}`}
              role={messageType === "error" ? "alert" : "status"}
            >
              {message}
            </div>
          )}
          <button
            type="submit"
            className="otp-verify-button"
            disabled={busy || expired || otp.length !== 6}
          >
            {busy ? "Verifying..." : "Verify code →"}
          </button>
        </form>

        <div className="otp-resend">
          <span>Didn't receive the code?</span>
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || busy || resendRemaining > 0}
          >
            {resending ? "Sending..." : resendRemaining > 0 ? `Resend in ${resendRemaining}s` : "Resend code"}
          </button>
        </div>
        <Link className="otp-back-link" to="/forgot-password">Use a different email</Link>
      </section>
    </main>
  );
}
