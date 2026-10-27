
import { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { getTeamCatalog } from "../../../services/matchService";
import { fetchContestPageData } from "../contests/contestPageApi.js";
import { MatchCard } from "../matches/MatchCard";

function normalizeTeamName(value) {
  return String(value || "").replace(/\s*\[[A-Z0-9]{2,8}\]\s*$/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findProviderFixture(match, providerMatches) {
  const teamA = normalizeTeamName(match.teamA);
  const teamB = normalizeTeamName(match.teamB);
  const matches = providerMatches.filter((provider) => {
    const providerA = normalizeTeamName(provider.teamA);
    const providerB = normalizeTeamName(provider.teamB);
    return (providerA === teamA && providerB === teamB) || (providerA === teamB && providerB === teamA);
  });
  if (!matches.length) return null;
  const matchTime = new Date(match.startTime || 0).getTime();
  return matches.sort((left, right) => Math.abs(new Date(left.startTime || 0).getTime() - matchTime) - Math.abs(new Date(right.startTime || 0).getTime() - matchTime))[0];
}

export default function LobbyPage() {
  const {
    user,
    matches,
    refreshMatches,
    matchesLoading,
    matchesError,
    matchesRefreshing,
    matchesRefreshNotice,
  } = useOutletContext();

  const navigate = useNavigate();
  const username = user?.username || "Player";
  const [now, setNow] = useState(Date.now());
  const [teams, setTeams] = useState([]);
  const [providerMatches, setProviderMatches] = useState([]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getTeamCatalog({ signal: controller.signal }).then(setTeams).catch(() => {});
    void fetchContestPageData("/cricket-feed", controller.signal)
      .then(({ feed }) => setProviderMatches(Array.isArray(feed?.matches) ? feed.matches : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const availableMatches = matches.map((match) => {
    const fixture = findProviderFixture(match, providerMatches);
    if (!fixture) return match;
    const sameOrder = normalizeTeamName(fixture.teamA) === normalizeTeamName(match.teamA);
    return {
      ...match,
      competition: fixture.series || match.competition,
      format: fixture.format || match.format,
      startTime: fixture.startTime || match.startTime,
      venue: match.venue || fixture.venue,
      teamALogo: match.teamALogo || (sameOrder ? fixture.teamALogo : fixture.teamBLogo),
      teamBLogo: match.teamBLogo || (sameOrder ? fixture.teamBLogo : fixture.teamALogo),
    };
  }).filter((match) => {
    const startTime = new Date(match.startTime).getTime();
    return (
      String(match.status || "").toLowerCase() === "upcoming" &&
      Number.isFinite(startTime) &&
      startTime > now
    );
  });

  return (
    <div className="cc-feature-page cc-lobby-page">
      <section className="cc-lobby-hero">
        <div className="cc-lobby-hero-copy">
          <span className="cc-feature-eyebrow">
            <span className="cc-gold-dot" />
            THE PLAYER LOBBY
          </span>

          <h1>
            Welcome to the
            <span> lobby, {username}.</span>
          </h1>

          <p>
            Your cricket community starts here. Explore fixtures,
            discover head-to-head opportunities and get ready to play.
          </p>

          <div className="cc-lobby-actions">
            <button
              type="button"
              className="cc-button cc-button-gold"
              onClick={() => navigate("/dashboard/matches")}
            >
              Explore matches <span>↗</span>
            </button>

            <button
              type="button"
              className="cc-button cc-button-light"
              onClick={() => navigate("/dashboard/profile")}
            >
              View my profile
            </button>
          </div>
        </div>

        <div className="cc-lobby-hero-art" aria-hidden="true">
          <div className="cc-lobby-art-ring cc-lobby-art-ring-one" />
          <div className="cc-lobby-art-ring cc-lobby-art-ring-two" />
          <div className="cc-lobby-art-ball">🏏</div>

          <div className="cc-lobby-art-caption">
            <span>ONE GAME</span>
            <strong>YOUR RIVALRY</strong>
          </div>
        </div>
      </section>

      <section className="cc-lobby-stats">
        <article className="cc-lobby-stat">
          <span>🏏</span>
          <div>
            <strong>{availableMatches.length}</strong>
            <small>Upcoming matches</small>
          </div>
        </article>

        <article className="cc-lobby-stat">
          <span>⚔</span>
          <div>
            <strong>1 vs 1</strong>
            <small>Head-to-head format</small>
          </div>
        </article>

        <article className="cc-lobby-stat">
          <span>✓</span>
          <div>
            <strong>Verified</strong>
            <small>Email status</small>
          </div>
        </article>
      </section>

      <section className="cc-feature-section">
        <div className="cc-feature-heading">
          <div>
            <span className="cc-feature-eyebrow">
              THE MATCH CENTER
            </span>
            <h2>Matches in the lobby</h2>
            <p>Public match listings shared with every player.</p>
          </div>

          <button
            type="button"
            className="cc-text-button"
            onClick={() => navigate("/dashboard/matches")}
          >
            View all matches →
          </button>
        </div>

        {matchesError && (
          <div className="cc-feature-alert" role="alert">
            <span>{matchesError}</span>
            <button type="button" onClick={() => refreshMatches()}>
              Retry
            </button>
          </div>
        )}

        {matchesRefreshNotice && (
          <p role="status" className="cc-feature-success">
            {matchesRefreshNotice}
          </p>
        )}

        {matchesLoading && matches.length === 0 ? (
          <div className="cc-feature-empty">
            Loading match listings...
          </div>
        ) : availableMatches.length === 0 ? (
          <div className="cc-feature-empty">
            <span className="cc-empty-icon">🏟️</span>
            <h3>The pitch is being prepared</h3>
            <p>
              There are no public matches listed yet. New fixtures
              will appear here for everyone in the lobby.
            </p>
            <button
              type="button"
              className="cc-button cc-button-maroon"
              onClick={() => refreshMatches()}
              disabled={matchesRefreshing}
            >
              {matchesRefreshing ? "Refreshing..." : "Refresh matches"}
            </button>
          </div>
        ) : (
          <div className="cc-match-grid" aria-label="Upcoming matches">
            {availableMatches.map((match) => (
              <MatchCard key={match._id} match={match} teams={teams} />
            ))}
          </div>
        )}
      </section>

      <section className="cc-lobby-privacy">
        <div className="cc-lobby-privacy-icon">♙</div>
        <div>
          <span className="cc-feature-eyebrow">
            YOUR ACCOUNT, YOUR SPACE
          </span>
          <h2>Keep your player details private.</h2>
          <p>
            Your username, email and unique Player ID are available
            in your personal Profile section.
          </p>
        </div>
        <button
          type="button"
          className="cc-button cc-button-light"
          onClick={() => navigate("/dashboard/profile")}
        >
          Open profile →
        </button>
      </section>
    </div>
  );
}
