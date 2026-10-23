import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
const RESET_EMAIL_KEY = "cc_admin_password_reset_email";

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to process the request.");
      sessionStorage.setItem(RESET_EMAIL_KEY, email.trim().toLowerCase());
      navigate("/admin/reset-password", { replace: true, state: { notice: data.message } });
    } catch (err) {
      setError(err.message || "Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-card" aria-labelledby="admin-forgot-title">
        <Link className="admin-auth-brand" to="/admin/login">Cricket<span>Clash</span></Link>
        <div className="admin-auth-icon" aria-hidden="true">✉</div>
        <div className="admin-auth-eyebrow">ADMINISTRATOR ACCESS</div>
        <h1 id="admin-forgot-title">Forgot password?</h1>
        <p className="admin-auth-description">Enter your registered administrator email. If the account is eligible, we’ll send a six-digit reset code.</p>
        {error && <div className="admin-auth-error" role="alert">{error}</div>}
        <form className="admin-auth-form" onSubmit={handleSubmit}>
          <label htmlFor="admin-reset-email">Administrator email</label>
          <input id="admin-reset-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" />
          <button type="submit" disabled={loading}>{loading ? "Sending…" : "Send reset code"}</button>
        </form>
        <Link className="admin-auth-back" to="/admin/login">Return to administrator sign in</Link>
      </section>
    </main>
  );
}
