import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
const RESET_EMAIL_KEY = "cc_admin_password_reset_email";

export default function AdminResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email] = useState(() => sessionStorage.getItem(RESET_EMAIL_KEY) || "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) navigate("/admin/forgot-password", { replace: true });
  }, [email, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otp.trim(), password, confirmPassword }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to reset the password.");
      sessionStorage.removeItem(RESET_EMAIL_KEY);
      navigate("/admin/login", { replace: true, state: { notice: data.message } });
    } catch (err) {
      setError(err.message || "Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  if (!email) return null;

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-card" aria-labelledby="admin-reset-title">
        <Link className="admin-auth-brand" to="/admin/login">Cricket<span>Clash</span></Link>
        <div className="admin-auth-icon" aria-hidden="true">⌑</div>
        <div className="admin-auth-eyebrow">ADMINISTRATOR ACCESS</div>
        <h1 id="admin-reset-title">Reset password</h1>
        <p className="admin-auth-description" role="status">{location.state?.notice || "Enter the six-digit code sent to your registered administrator email and choose a new password."}</p>
        {error && <div className="admin-auth-error" role="alert">{error}</div>}
        <form className="admin-auth-form" onSubmit={handleSubmit}>
          <label htmlFor="admin-reset-otp">Verification code</label>
          <input id="admin-reset-otp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Six-digit code" />
          <label htmlFor="admin-new-password">New password</label>
          <input id="admin-new-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Use upper/lowercase, number, symbol" />
          <label htmlFor="admin-confirm-password">Confirm new password</label>
          <input id="admin-confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter the password again" />
          <button type="submit" disabled={loading}>{loading ? "Resetting…" : "Reset administrator password"}</button>
        </form>
        <Link className="admin-auth-back" to="/admin/forgot-password">Request another code</Link>
      </section>
    </main>
  );
}
