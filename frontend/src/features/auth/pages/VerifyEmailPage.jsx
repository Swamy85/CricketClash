
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000";

function getSecondsRemaining(key) {
  const expiry = Number(sessionStorage.getItem(key));

  return expiry
    ? Math.max(0, Math.ceil((expiry - Date.now()) / 1000))
    : 0;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function VerifyEmailPage() {
  const navigate = useNavigate();

  // Read registration information when the page mounts.
  const email = sessionStorage.getItem("cc_pending_email") || "";

  const [otp, setOtp] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    getSecondsRemaining("cc_otp_expires_at")
  );
  const [resendSeconds, setResendSeconds] = useState(() =>
    getSecondsRemaining("cc_otp_resend_at")
  );
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("error");

  useEffect(() => {
    function updateTimers() {
      setRemainingSeconds(
        getSecondsRemaining("cc_otp_expires_at")
      );
      setResendSeconds(
        getSecondsRemaining("cc_otp_resend_at")
      );
    }

    updateTimers();

    const interval = setInterval(updateTimers, 1000);

    return () => clearInterval(interval);
  }, []);

  async function handleVerify(event) {
    event.preventDefault();

    if (busy) return;

    setMessage("");

    if (!email) {
      setMessage(
        "Registration email is missing. Please register again."
      );
      setMessageType("error");
      return;
    }

    if (getSecondsRemaining("cc_otp_expires_at") <= 0) {
      setRemainingSeconds(0);
      setMessage("Your OTP has expired. Request a new code.");
      setMessageType("error");
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      setMessage("Enter the complete six-digit OTP.");
      setMessageType("error");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(
        `${API_URL}/api/auth/verify-otp`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, otp }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(
          data.message || "OTP verification failed."
        );
        setMessageType("error");
        return;
      }

      // Keep registration state until navigation begins.
      // This prevents a re-render from invalidating this page.
      setMessageType("success");
      setMessage("Email verified! Redirecting to login...");

      // Allow the success message to be displayed.
      setTimeout(() => {
        // Navigate away before cleaning up the OTP state.
        navigate("/login", {
          replace: true,
          state: {
            email,
            verified: true,
          },
        });

        sessionStorage.removeItem("cc_pending_email");
        sessionStorage.removeItem("cc_registration_pending");
        sessionStorage.removeItem("cc_otp_expires_at");
        sessionStorage.removeItem("cc_otp_resend_at");
      }, 900);
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (
      getSecondsRemaining("cc_otp_resend_at") > 0 ||
      resending ||
      busy
    ) {
      return;
    }

    if (!email) {
      setMessage("Registration email is missing. Please register again.");
      setMessageType("error");
      return;
    }

    setResending(true);
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/api/auth/resend-otp`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(
          data.message || "Could not resend OTP."
        );
        setMessageType("error");
        return;
      }

      const now = Date.now();

      sessionStorage.setItem(
        "cc_otp_expires_at",
        String(now + 5 * 60 * 1000)
      );

      sessionStorage.setItem(
        "cc_otp_resend_at",
        String(now + 60 * 1000)
      );

      setOtp("");
      setRemainingSeconds(300);
      setResendSeconds(60);
      setMessage("A new OTP has been sent to your email.");
      setMessageType("success");
    } catch {
      setMessage(
        "Unable to connect to the server. Please try again."
      );
      setMessageType("error");
    } finally {
      setResending(false);
    }
  }

  const expired = remainingSeconds <= 0;

  return (
    <main className="otp-page">
      <div className="otp-glow otp-glow-one" />
      <div className="otp-glow otp-glow-two" />

      <section className="otp-card">
        <div className="otp-brand">
          <span className="otp-brand-icon">C</span>
          <span>
            Cricket<span>Clash</span>
          </span>
        </div>

        <div className="otp-icon">✉️</div>
        <span className="otp-eyebrow">ONE LAST STEP</span>
        <h1>Verify your email</h1>

        <p className="otp-description">
          Enter the six-digit code sent to
        </p>

        <p className="otp-email">{email}</p>

        <div
          className={`otp-timer ${
            expired ? "otp-timer-expired" : ""
          }`}
        >
          <span className="otp-timer-icon">◷</span>

          <div>
            <span className="otp-timer-label">
              {expired ? "OTP expired" : "Time remaining"}
            </span>

            <strong>{formatTime(remainingSeconds)}</strong>
          </div>

          <span className="otp-timer-badge">
            {expired ? "EXPIRED" : "5 MIN"}
          </span>
        </div>

        <form onSubmit={handleVerify}>
          <label
            className="otp-label"
            htmlFor="verification-otp"
          >
            Verification code
          </label>

          <input
            id="verification-otp"
            className="otp-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={otp}
            onChange={(event) =>
              setOtp(
                event.target.value
                  .replace(/\D/g, "")
                  .slice(0, 6)
              )
            }
            disabled={busy || expired}
            required
          />

          <p className="otp-hint">
            Check your inbox and spam folder if you can't find
            the email.
          </p>

          {message && (
            <div
              className={`otp-message ${
                messageType === "success"
                  ? "otp-message-success"
                  : ""
              }`}
              role="status"
            >
              {message}
            </div>
          )}

          <button
            type="submit"
            className="otp-verify-button"
            disabled={busy || expired || otp.length !== 6}
          >
            {busy ? "Verifying..." : "Verify email →"}
          </button>
        </form>

        <div className="otp-resend">
          <span>Didn't receive the code?</span>

          <button
            type="button"
            onClick={handleResend}
            disabled={
              resending ||
              busy ||
              resendSeconds > 0
            }
          >
            {resending
              ? "Sending..."
              : resendSeconds > 0
                ? `Resend in ${resendSeconds}s`
                : "Resend OTP"}
          </button>
        </div>

        <p className="otp-security-note">
          🔒 Never share your verification code with anyone.
        </p>

        <Link className="otp-back-link" to="/register">
          Back to registration
        </Link>
      </section>
    </main>
  );
}
