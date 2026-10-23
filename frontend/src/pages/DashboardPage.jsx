import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSession } from "../context/SessionContext";
import { SESSION_STORAGE_KEY } from "../features/auth/services/authService";
import { formatIndiaDateTime } from "../utils/dateTime";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const TABS = [
  { id: "lobby", label: "Lobby", icon: "⌂" },
  { id: "matches", label: "Matches", icon: "🏏" },
  { id: "contests", label: "My Contests", icon: "⚔" },
  { id: "profile", label: "Profile", icon: "♙" },
];

function formatMatchDate(value) {
  if (!value) return "Schedule to be announced";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Schedule to be announced";

  return formatIndiaDateTime(date, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function statusLabel(status) {
  if (!status) return "Scheduled";
  return String(status)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MatchCard({ match }) {
  const status = String(match.status || "upcoming").toLowerCase();
  const isLive = status.includes("live") || status.includes("progress");

  return (
    <article className="dashboard-match-card lobby-match-card">
      <div className="match-card-header">
        <span className={`match-status ${isLive ? "is-live" : ""}`}>
          <span className="status-dot" />
          {statusLabel(match.status)}
        </span>
        <span className="format-tag">{match.format || "Cricket"}</span>
      </div>

      <div className="lobby-match-teams">
        <div className="lobby-team">
          <span className="lobby-team-mark">{(match.teamA || "A").slice(0, 3).toUpperCase()}</span>
          <strong>{match.teamA || "Team A"}</strong>
        </div>
        <span className="lobby-vs">VS</span>
        <div className="lobby-team">
          <span className="lobby-team-mark">{(match.teamB || "B").slice(0, 3).toUpperCase()}</span>
          <strong>{match.teamB || "Team B"}</strong>
        </div>
      </div>

      <div className="lobby-match-bottom">
        <span>◷ {formatMatchDate(match.startTime)}</span>
        <span className="lobby-match-note">Head-to-head</span>
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { setStatus, logout } = useAppSession();

  const [user, setUser] = useState(null);
  const [matches, setMatches] = useState([]);
  const [activeTab, setActiveTab] = useState("lobby");
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [error, setError] = useState("");
  const [matchesError, setMatchesError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesError("");

    try {
      const response = await fetch(`${API_URL}/api/matches`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Matches could not be loaded. Please try again.");
      }

      const data = await response.json();
      setMatches(Array.isArray(data.matches) ? data.matches : []);
    } catch (err) {
      setMatchesError(err.message || "Unable to load matches.");
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        method: "GET",
        credentials: "include",
        headers: { "X-CricketClash-Session": sessionStorage.getItem(SESSION_STORAGE_KEY) || "" },
        cache: "no-store",
      });

      if (response.status === 401 || response.status === 403) {
        setStatus("unauthenticated");
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok) {
        throw new Error("Unable to load your account. Please retry.");
      }

      const data = await response.json();

      if (!data.user) {
        throw new Error("Account information was not returned.");
      }

      setUser(data.user);
      setStatus("authenticated");
      await loadMatches();
    } catch (err) {
      setError(err.message || "Unable to load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, [loadMatches, navigate, setStatus]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function handleLogout() {
    if (loggingOut) return;

    const confirmed = window.confirm(
      "Are you sure you want to log out of CricketClash?"
    );
    if (!confirmed) return;

    setLoggingOut(true);
    setError("");

    await logout("manual");
  }

  const username = user?.username || "Player";
  const initial = username.charAt(0).toUpperCase();
  const upcomingMatches = useMemo(
    () => matches.filter((match) => {
      const status = String(match.status || "").toLowerCase();
      return !status.includes("completed") && !status.includes("finished");
    }),
    [matches]
  );

  if (loading) {
    return (
      <div className="dashboard-loading-screen">
        <div className="dashboard-loading-mark">C</div>
        <div className="dashboard-loading-spinner" />
        <p>Setting up your CricketClash lobby...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-topbar">
        <button
          type="button"
          className="dashboard-brand dashboard-brand-button"
          onClick={() => setActiveTab("lobby")}
          aria-label="Go to CricketClash lobby"
        >
          <span className="brand-mark">C</span>
          <span>
            Cricket<span className="brand-accent">Clash</span>
          </span>
        </button>

        <div className="dashboard-topbar-right">
          <span className="dashboard-online-indicator">
            <span /> Player lobby
          </span>
          <button
            type="button"
            className="button button-outline logout-button"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </header>

      <div className="dashboard-shell">
        <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
          <div className="dashboard-sidebar-label">YOUR SPACE</div>
          <nav className="dashboard-nav">
            {TABS.map((tab) => (
              <button
                type="button"
                key={tab.id}
                className={`dashboard-nav-item ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? "page" : undefined}
              >
                <span className="dashboard-nav-icon" aria-hidden="true">{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.id === "matches" && matches.length > 0 && (
                  <span className="dashboard-nav-count">{matches.length}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="dashboard-sidebar-player">
            <div className="dashboard-sidebar-avatar">{initial}</div>
            <div className="dashboard-sidebar-player-text">
              <strong>{username}</strong>
              <span>CricketClash player</span>
            </div>
          </div>
        </aside>

        <main className="dashboard-content">
          {error && (
            <div className="alert alert-error dashboard-alert" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="text-button"
                onClick={loadDashboard}
                disabled={loading}
              >
                Retry
              </button>
            </div>
          )}

          {activeTab === "lobby" && (
            <>
              <section className="lobby-hero">
                <div className="lobby-hero-copy">
                  <span className="lobby-eyebrow"><span className="lobby-gold-dot" /> THE PLAYER LOBBY</span>
                  <h1>Welcome to the <span>lobby, {username}.</span></h1>
                  <p>
                    Your cricket community starts here. Explore fixtures,
                    discover head-to-head opportunities and get ready to play.
                  </p>
                  <div className="lobby-hero-actions">
                    <button type="button" className="lobby-gold-button" onClick={() => setActiveTab("matches")}>
                      Explore matches <span aria-hidden="true">↗</span>
                    </button>
                    <button type="button" className="lobby-quiet-button" onClick={() => setActiveTab("profile")}>
                      View my profile
                    </button>
                  </div>
                </div>
                <div className="lobby-hero-art" aria-hidden="true">
                  <div className="lobby-ring lobby-ring-one" />
                  <div className="lobby-ring lobby-ring-two" />
                  <div className="lobby-ball">🏏</div>
                  <div className="lobby-art-caption">
                    <span>ONE GAME</span>
                    <strong>YOUR RIVALRY</strong>
                  </div>
                </div>
              </section>

              <section className="lobby-stats" aria-label="Lobby overview">
                <article className="lobby-stat-card">
                  <span className="lobby-stat-icon">🏏</span>
                  <div><strong>{matches.length}</strong><span>Listed matches</span></div>
                </article>
                <article className="lobby-stat-card">
                  <span className="lobby-stat-icon gold">⚔</span>
                  <div><strong>1 vs 1</strong><span>Head-to-head format</span></div>
                </article>
                <article className="lobby-stat-card">
                  <span className="lobby-stat-icon green">✓</span>
                  <div><strong>Verified</strong><span>Your email status</span></div>
                </article>
              </section>


              <section className="dashboard-lobby-section">
                <div className="dashboard-section-heading">
                  <div>
                    <span className="eyebrow">THE MATCH CENTER</span>
                    <h2>Matches in the lobby</h2>
                    <p className="dashboard-section-description">
                      Public match listings shared with every logged-in player.
                    </p>
                  </div>
                  <button type="button" className="dashboard-view-all" onClick={() => setActiveTab("matches")}>
                    View all matches <span aria-hidden="true">→</span>
                  </button>
                </div>

                {matchesError && (
                  <div className="alert alert-error" role="alert">
                    {matchesError}
                    <button type="button" className="text-button" onClick={loadMatches} disabled={matchesLoading}>Retry</button>
                  </div>
                )}

                {matchesLoading ? (
                  <div className="dashboard-empty"><span className="empty-icon">🏏</span><h3>Loading match listings...</h3></div>
                ) : upcomingMatches.length === 0 ? (
                  <div className="dashboard-empty lobby-empty">
                    <span className="empty-icon">🏟️</span>
                    <h3>The pitch is being prepared</h3>
                    <p>
                      There are no public matches listed yet. New fixtures will appear here for everyone in the lobby.
                    </p>
                    <button type="button" className="lobby-maroon-button" onClick={loadMatches}>Refresh matches</button>
                  </div>
                ) : (
                  <div className="dashboard-match-grid">
                    {upcomingMatches.slice(0, 3).map((match) => <MatchCard key={match._id} match={match} />)}
                  </div>
                )}
              </section>

              <section className="lobby-community-banner">
                <div className="lobby-community-icon">♟</div>
                <div>
                  <span className="eyebrow">YOUR ACCOUNT, YOUR SPACE</span>
                  <h2>Keep your player details private.</h2>
                  <p>Your username, email and unique Player ID are available in your personal Profile section.</p>
                </div>
                <button type="button" className="lobby-community-button" onClick={() => setActiveTab("profile")}>
                  Open profile →
                </button>
              </section>
            </>
          )}

          {activeTab === "matches" && (
            <section className="dashboard-lobby-section dashboard-tab-section">
              <div className="dashboard-section-heading">
                <div>
                  <span className="eyebrow">PUBLIC MATCH CENTER</span>
                  <h1>All matches</h1>
                  <p className="dashboard-section-description">
                    This public list is shared across the CricketClash player lobby.
                  </p>
                </div>
                <button type="button" className="dashboard-view-all" onClick={loadMatches} disabled={matchesLoading}>
                  {matchesLoading ? "Refreshing..." : "↻ Refresh"}
                </button>
              </div>

              {matchesError && <div className="alert alert-error" role="alert">{matchesError}</div>}

              {matchesLoading ? (
                <div className="dashboard-empty"><span className="empty-icon">🏏</span><h3>Loading matches...</h3></div>
              ) : matches.length === 0 ? (
                <div className="dashboard-empty lobby-empty">
                  <span className="empty-icon">🏟️</span>
                  <h3>No matches listed yet</h3>
                  <p>Once match records are added, every logged-in player will see them here.</p>
                </div>
              ) : (
                <div className="dashboard-match-grid">
                  {matches.map((match) => <MatchCard key={match._id} match={match} />)}
                </div>
              )}
            </section>
          )}

          {activeTab === "contests" && (
            <section className="dashboard-lobby-section dashboard-tab-section">
              <div className="dashboard-section-heading">
                <div>
                  <span className="eyebrow">YOUR COMPETITIONS</span>
                  <h1>My Contests</h1>
                  <p className="dashboard-section-description">
                    Your personal list of head-to-head contests will live here.
                  </p>
                </div>
              </div>
              <div className="dashboard-empty lobby-empty">
                <span className="empty-icon">⚔️</span>
                <h3>Your contests are up next</h3>
                <p>
                  Contest joining and personal contest history are not connected yet.
                  For now, explore the public match lobby.
                </p>
                <button type="button" className="lobby-maroon-button" onClick={() => setActiveTab("matches")}>
                  Explore matches
                </button>
              </div>
            </section>
          )}

          {activeTab === "profile" && (
            <section className="dashboard-profile dashboard-tab-section">
              <div className="dashboard-section-heading">
                <div>
                  <span className="eyebrow">PRIVATE ACCOUNT AREA</span>
                  <h1>My profile</h1>
                  <p className="dashboard-section-description">
                    Only your account details are shown in this section.
                  </p>
                </div>
                <span className="verified-badge"><span className="status-dot" /> Email verified</span>
              </div>

              <div className="dashboard-profile-hero">
                <div className="dashboard-profile-avatar">{initial}</div>
                <div>
                  <span className="dashboard-profile-kicker">CRICKETCLASH PLAYER</span>
                  <h2>{username}</h2>
                  <p>{user?.email || "No email available"}</p>
                </div>
              </div>

              <div className="profile-grid">
                <article className="profile-card player-id-profile">
                  <span className="profile-label">PLAYER ID</span>
                  <strong>{user?.userId || "Unavailable"}</strong>
                  <span className="profile-helper">Your unique CricketClash identity</span>
                </article>
                <article className="profile-card">
                  <span className="profile-label">USERNAME</span>
                  <strong>{user?.username || "—"}</strong>
                  <span className="profile-helper">Your player name</span>
                </article>
                <article className="profile-card">
                  <span className="profile-label">EMAIL ADDRESS</span>
                  <strong className="profile-email">{user?.email || "—"}</strong>
                  <span className="profile-helper">Your verified account email</span>
                </article>
              </div>

              <div className="dashboard-privacy-note">
                <span>🔒</span>
                <p>Your personal account details are kept in your Profile area, separate from the common lobby.</p>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
