export default function SessionTimeoutModal({
  open,
  secondsRemaining = 60,
  onStayLoggedIn,
  onLogout,
  busy = false,
  error = "",
}) {
  if (!open) return null;
  const mm = String(Math.floor(secondsRemaining / 60)).padStart(2, "0");
  const ss = String(secondsRemaining % 60).padStart(2, "0");
  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 18, 25, .68)", display: "grid", placeItems: "center", padding: 20 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="cc-timeout-title" style={{ width: "min(440px, 100%)", background: "#fff", color: "#252329", borderRadius: 18, padding: 28, boxShadow: "0 24px 80px rgba(0,0,0,.25)" }}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>⏱️</div>
        <h2 id="cc-timeout-title" style={{ margin: "0 0 10px", fontSize: 22 }}>Still playing?</h2>
        <p style={{ lineHeight: 1.55, color: "#666", margin: "0 0 18px" }}>You’ve been inactive for 14 minutes. For your security, CricketClash will log this tab out in:</p>
        <div aria-live="polite" style={{ fontSize: 34, fontWeight: 800, letterSpacing: 2, marginBottom: 22 }}>{mm}:{ss}</div>
        {error && <p role="alert" style={{ color: "#a51d2d", margin: "0 0 16px" }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={onStayLoggedIn} disabled={busy} style={{ flex: 1, minHeight: 44, border: 0, borderRadius: 10, color: "#fff", background: "#7d1735", fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>{busy ? "Checking…" : "Stay logged in"}</button>
          <button type="button" onClick={onLogout} disabled={busy} style={{ minHeight: 44, padding: "0 16px", border: "1px solid #ddd", borderRadius: 10, background: "#fff", fontWeight: 600, cursor: "pointer" }}>Log out</button>
        </div>
      </section>
    </div>
  );
}
