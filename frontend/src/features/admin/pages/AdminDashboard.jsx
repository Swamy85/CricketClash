import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { adminFetch } from "../services/adminSession";

const DASHBOARD_API = "/api/admin/dashboard";
const MATCHES_API = "/api/admin/matches?recent=true&limit=5";

function MetricCard({ icon, label, value, description }) {
  return (
    <article className="admin-metric-card">
      <div className="admin-metric-icon" aria-hidden="true">{icon}</div>
      <div className="admin-metric-details">
        <p>{label}</p>
        <h2>{value}</h2>
        <span>{description}</span>
      </div>
    </article>
  );
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || "The request could not be completed.");
  }
  return data;
}

function formatStatus(status) {
  if (!status) return "Unknown";
  return String(status)
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function AdminDashboard() {
  const { admin } = useOutletContext();
  const [stats, setStats] = useState(null);
  const [matches, setMatches] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [matchesError, setMatchesError] = useState("");
  const requestRef = useRef(null);

  const loadDashboard = useCallback(async ({ initial = false } = {}) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoading(true);
    else setRefreshing(true);

    const [summaryResult, matchesResult] = await Promise.allSettled([
      adminFetch(DASHBOARD_API, { signal: controller.signal }).then(readResponse),
      adminFetch(MATCHES_API, { signal: controller.signal }).then(readResponse),
    ]);

    if (requestRef.current === controller) {
      if (summaryResult.status === "fulfilled") {
        const data = summaryResult.value;
        setStats(data.stats || null);
        setUsers(Array.isArray(data.recentUsers) ? data.recentUsers : []);
        setStatsError("");
      } else if (summaryResult.reason?.name !== "AbortError") {
        setStatsError(summaryResult.reason?.message || "Unable to load dashboard statistics.");
      }

      if (matchesResult.status === "fulfilled") {
        setMatches(Array.isArray(matchesResult.value.matches) ? matchesResult.value.matches : []);
        setMatchesError("");
      } else if (matchesResult.reason?.name !== "AbortError") {
        setMatchesError(matchesResult.reason?.message || "Unable to load recent matches.");
      }

      requestRef.current = null;
      if (initial) setLoading(false);
      else setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard({ initial: true });
    const refresh = () => {
      if (document.visibilityState === "visible") void loadDashboard();
    };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
    };
  }, [loadDashboard]);

  const metricValue = (key) => {
    if (loading && !stats) return "\u2026";
    const value = stats?.[key];
    return Number.isFinite(value) ? value.toLocaleString() : "\u2014";
  };

  return (
    <>
      <div className="admin-breadcrumb">
        <span>CricketClash</span>
        <span>/</span>
        <strong>Dashboard</strong>
      </div>

      <section className="admin-welcome-banner">
        <div className="admin-welcome-copy">
          <span className="admin-welcome-eyebrow">ADMINISTRATION OVERVIEW</span>
          <h1>Welcome back, {admin?.username || "Admin"}!</h1>
          <p>Manage your CricketClash platform from one place.</p>
          <div className="admin-welcome-badge">
            <span className="admin-status-dot" />
            Secure administrator access
          </div>
        </div>

        <div className="admin-stadium-art" aria-hidden="true">
          <span className="stadium-circle stadium-circle--one" />
          <span className="stadium-circle stadium-circle--two" />
          <span className="stadium-pillar stadium-pillar--one" />
          <span className="stadium-pillar stadium-pillar--two" />
          <span className="stadium-bat">{"\u{1F3CF}"}</span>
          <span className="stadium-ball">{"\u25CF"}</span>
        </div>
      </section>

      <div className="admin-section-heading">
        <div>
          <h2>Platform overview</h2>
          <p>Your management workspace at a glance.</p>
        </div>
        <span className="admin-live-label" aria-live="polite">
          <span className="admin-status-dot" />
          {refreshing ? "Updating" : "Live data"}
        </span>
      </div>

      {statsError && <div className="admin-dashboard-error" role="alert">{statsError}</div>}
      <section className="admin-metrics-grid" aria-busy={loading || refreshing}>
        <MetricCard icon={"\u{1F465}"} label="Total users" value={metricValue("totalUsers")}
          description="Registered player accounts" />
        <MetricCard icon={"\u{1F3C6}"} label="Active contests" value={metricValue("activeContests")}
          description="Open, waiting, full, or locked" />
        <MetricCard icon={"\u25C9"} label="Upcoming matches" value={metricValue("upcomingMatches")}
          description="Scheduled in the future" />
        <MetricCard icon={"\u{1F4B3}"} label="Transactions" value={metricValue("transactions")}
          description="Recorded wallet transactions" />
      </section>

      <section className="admin-panel admin-quick-actions">
        <div className="admin-panel-heading">
          <div>
            <h2>Quick actions</h2>
            <p>Shortcuts for common administration tasks.</p>
          </div>
        </div>

        <div className="admin-actions-grid">
          {[
            { icon: "\u25C9", label: "Manage matches", to: "/admin/matches" },
            { icon: "\u{1F3C6}", label: "Manage contests", to: "/admin/contests" },
          ].map((action) => (
            <Link key={action.to} to={action.to} className="admin-action-card">
              <span className="admin-action-icon">{action.icon}</span>
              <span>{action.label}</span>
              <span className="admin-action-arrow">{"\u203A"}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="admin-bottom-grid">
        <article className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Recent matches</h2>
              <p>Latest match activity</p>
            </div>
            <Link to="/admin/matches" className="admin-text-button">View all {"\u2192"}</Link>
          </div>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead><tr><th>Match</th><th>Format</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} className="admin-table-empty">Loading recent matches{"\u2026"}</td></tr>
                ) : matchesError ? (
                  <tr><td colSpan={3} className="admin-table-empty" role="alert">{matchesError}</td></tr>
                ) : matches.length === 0 ? (
                  <tr><td colSpan={3} className="admin-table-empty">No matches have been added yet.</td></tr>
                ) : matches.map((match) => (
                  <tr key={match._id}>
                    <td>{match.teamA} vs {match.teamB}</td>
                    <td>{match.format || "\u2014"}</td>
                    <td>{formatStatus(match.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <h2>Recent users</h2>
              <p>Latest account activity</p>
            </div>
          </div>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead><tr><th>User</th><th>Status</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={2} className="admin-table-empty">Loading recent users{"\u2026"}</td></tr>
                ) : statsError ? (
                  <tr><td colSpan={2} className="admin-table-empty" role="alert">{statsError}</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={2} className="admin-table-empty">No user accounts have been created yet.</td></tr>
                ) : users.map((user) => (
                  <tr key={user._id}>
                    <td>
                      {user.username || "Unknown user"}
                      {user.userId && <small>{user.userId}</small>}
                    </td>
                    <td>{user.isEmailVerified ? "Verified" : "Pending verification"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <footer className="admin-dashboard-footer">
        <span>CricketClash</span>
        <span>{"\u2022"}</span>
        <span>Secure management workspace</span>
      </footer>
    </>
  );
}
