
import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { MatchCard } from "./MatchCard";

const MATCH_CATEGORIES = [
  ["upcoming", "Upcoming"],
  ["live", "Live"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["abandoned", "Abandoned"],
];

export default function MatchesPage() {
  const {
    matches,
    refreshMatches,
    matchesLoading,
    matchesError,
    matchesRefreshing,
    matchesRefreshNotice,
  } = useOutletContext();
  const [activeStatus, setActiveStatus] = useState("upcoming");
  const categorizedMatches = matches.filter(
    (match) => String(match.status || "upcoming").toLowerCase() === activeStatus
  );

  return (
    <section className="cc-feature-page cc-matches-page">
      <div className="cc-feature-heading">
        <div>
          <span className="cc-feature-eyebrow">
            PUBLIC MATCH CENTER
          </span>
          <h1>All matches</h1>
          <p>
            Match listings shared across the CricketClash lobby.
          </p>
        </div>

        <button
          type="button"
          className="cc-button cc-button-maroon"
          onClick={() => refreshMatches()}
          disabled={matchesLoading || matchesRefreshing}
        >
          {matchesRefreshing ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {matchesRefreshNotice && (
        <p className="cc-feature-success" role="status">
          {matchesRefreshNotice}
        </p>
      )}

      {matchesError && (
        <div className="cc-feature-alert" role="alert">
          <span>{matchesError}</span>
          <button type="button" onClick={() => refreshMatches()}>
            Retry
          </button>
        </div>
      )}

      <div className="cc-match-status-tabs" role="tablist" aria-label="Match status">
        {MATCH_CATEGORIES.map(([status, label]) => {
          const count = matches.filter(
            (match) => String(match.status || "upcoming").toLowerCase() === status
          ).length;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={activeStatus === status}
              key={status}
              className={activeStatus === status ? "active" : ""}
              onClick={() => setActiveStatus(status)}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {matchesLoading && matches.length === 0 ? (
        <div className="cc-feature-empty">Loading matches...</div>
      ) : categorizedMatches.length === 0 ? (
        <div className="cc-feature-empty">
          <span className="cc-empty-icon">🏟️</span>
          <h3>No {activeStatus} matches</h3>
          <p>Matches move between categories when their status changes.</p>
        </div>
      ) : (
        <div className="cc-match-grid">
          {categorizedMatches.map((match) => (
            <MatchCard key={match._id} match={match} />
          ))}
        </div>
      )}
    </section>
  );
}
