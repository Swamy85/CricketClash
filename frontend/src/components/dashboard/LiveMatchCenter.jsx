import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../../features/dashboard/matches/LiveMatchCenter.css";
import { countProviderMatches, filterAndSortProviderMatches } from "../../features/dashboard/matches/liveMatchCenterUtils.js";
import { formatIndiaDateTime } from "../../utils/dateTime";

const FILTERS = [
  ["live", "Live"],
  ["upcoming", "Upcoming"],
  ["completed", "Completed"],
  ["uncertain", "Other"],
];

function formatDate(value) {
  if (!value) return "Start time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Start time unavailable" : formatIndiaDateTime(date, {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function Team({ name, logo, score }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const initials = String(name || "?").split(/\s+/).slice(0, 3).map((part) => part[0]).join("").toUpperCase();
  return <div className="cc-live-team">
    {logo && !logoFailed ? <img src={logo} alt="" loading="lazy" onError={() => setLogoFailed(true)} /> : <span className="cc-live-team-placeholder" aria-hidden="true">{initials}</span>}
    <strong>{name || "Team unavailable"}</strong>
    {score ? <span className="cc-live-score">{score}</span> : null}
  </div>;
}

function Scorecard({ innings }) {
  if (!Array.isArray(innings) || !innings.length) return null;
  return <details className="cc-live-scorecard">
    <summary>Scorecard details</summary>
    {innings.map((entry, index) => <div className="cc-live-innings" key={`${entry.innings || "innings"}-${index}`}>
      <h4>{entry.innings || `Innings ${index + 1}`}</h4>
      <p className="cc-live-innings-total">{entry.runs ?? "—"}/{entry.wickets ?? "—"}{entry.overs != null ? ` (${entry.overs} overs)` : ""}</p>
      {entry.batting?.length > 0 && <div className="cc-live-score-table-wrap"><table className="cc-live-score-table"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th><th>Dismissal</th></tr></thead><tbody>{entry.batting.map((player, playerIndex) => <tr key={`${player.name}-${playerIndex}`}><td>{player.name}</td><td>{player.runs ?? "—"}</td><td>{player.balls ?? "—"}</td><td>{player.fours ?? "—"}</td><td>{player.sixes ?? "—"}</td><td>{player.strikeRate ?? "—"}</td><td>{player.dismissal || "—"}</td></tr>)}</tbody></table></div>}
      {entry.bowling?.length > 0 && <div className="cc-live-score-table-wrap"><table className="cc-live-score-table"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>{entry.bowling.map((player, playerIndex) => <tr key={`${player.name}-${playerIndex}`}><td>{player.name}</td><td>{player.overs ?? "—"}</td><td>{player.maidens ?? "—"}</td><td>{player.runs ?? "—"}</td><td>{player.wickets ?? "—"}</td><td>{player.economy ?? "—"}</td></tr>)}</tbody></table></div>}
      {entry.extras && <p className="cc-live-extras">Extras: {entry.extras.r ?? "—"}{[entry.extras.b != null && `, byes ${entry.extras.b}`, entry.extras.lb != null && `, leg byes ${entry.extras.lb}`, entry.extras.w != null && `, wides ${entry.extras.w}`, entry.extras.nb != null && `, no-balls ${entry.extras.nb}`, entry.extras.p != null && `, penalty ${entry.extras.p}`].filter(Boolean).join("")}</p>}
    </div>)}
  </details>;
}

export default function LiveMatchCenter({
  feed, loading, error, onRetry, onCreateMatch, actionBusy = false,
  internalMatches = [], userView = false,
}) {
  const [category, setCategory] = useState("upcoming");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("soonest");
  const matches = feed?.matches || [];
  const counts = useMemo(() => countProviderMatches(matches), [matches]);
  const visibleMatches = useMemo(() => filterAndSortProviderMatches(matches, { category, query, sort }), [category, matches, query, sort]);
  const updated = feed?.lastUpdatedAt ? new Date(feed.lastUpdatedAt) : null;
  const stale = !updated || !Number.isFinite(updated.getTime()) || Date.now() - updated.getTime() > 20 * 60 * 1000;

  function getInternalMatch(providerMatch) {
    const start = new Date(providerMatch.startTime || 0).getTime();
    return internalMatches.find((match) => match.teamA === providerMatch.teamA && match.teamB === providerMatch.teamB
      && Math.abs(new Date(match.startTime).getTime() - start) < 60_000);
  }

  return <section className="cc-feature-page cc-live-center">
    <header className="cc-feature-heading cc-live-heading">
      <div><span className="cc-feature-eyebrow">SHARED CRICKET DATA</span><h1>Live Match Center</h1><p>Live scores, upcoming fixtures, and completed results from the shared provider feed.</p></div>
      <div className={`cc-live-updated ${stale ? "stale" : ""}`} aria-live="polite">{updated && Number.isFinite(updated.getTime()) ? <>Last successful update<br />{formatIndiaDateTime(updated)}</> : "Waiting for a successful provider refresh"}{stale && updated ? <strong> · Data may be stale</strong> : null}</div>
    </header>
    <div className="cc-live-toolbar">
      <div className="cc-live-tabs" role="tablist" aria-label="Match category">{FILTERS.map(([key, label]) => <button type="button" key={key} role="tab" aria-selected={category === key} className={category === key ? "active" : ""} onClick={() => setCategory(key)}>{label}<span>{counts[key] ?? 0}</span></button>)}</div>
      <div className="cc-live-controls"><label><span className="sr-only">Search matches</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teams or series" /></label><label><span className="sr-only">Sort matches</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="soonest">Nearest first</option><option value="latest">Latest first</option></select></label><button type="button" className="cc-button cc-button-maroon" disabled={loading} onClick={onRetry}>{loading ? "Refreshing…" : "Refresh view"}</button></div>
    </div>
    {error && <div className="cc-feature-alert" role="alert">{error}</div>}
    {loading && !feed ? <div className="cc-feature-empty">Loading shared match data…</div> : visibleMatches.length === 0 ? <div className="cc-feature-empty"><h2>{query ? "No matches found" : `No ${category} matches available`}</h2><p>{feed?.lastUpdatedAt ? `Last successful update: ${formatDate(feed.lastUpdatedAt)}. Refresh status: ${feed.outcome || "unknown"}.` : `The provider feed has not completed a successful refresh. Refresh status: ${feed?.outcome || "not yet checked"}.`}</p></div> : <div className="cc-live-match-grid">{visibleMatches.map((match) => {
      const internal = userView ? getInternalMatch(match) : null;
      return <article className={`cc-live-match-card ${match.category === "live" ? "is-live" : ""}`} key={match.externalId}>
        <div className="cc-live-card-top"><span className={`cc-live-status ${match.category}`}><i />{match.category}</span><span className="cc-live-format">{match.format || "Format unavailable"}</span><span className="cc-live-source">Provider</span></div>
        <div className="cc-live-teams"><Team name={match.teamA} logo={match.teamALogo} score={match.scoreA} /><span className="cc-live-vs">VS</span><Team name={match.teamB} logo={match.teamBLogo} score={match.scoreB} /></div>
        {match.scoreSummary && <p className="cc-live-score-summary">{match.scoreSummary}</p>}
        <p className="cc-live-status-description">{match.status || "Status unavailable"}</p>
        <div className="cc-live-meta">{match.series && <strong>{match.series}</strong>}<span>{formatDate(match.startTime)}</span></div>
        <Scorecard innings={match.innings} />
        {userView && internal && <Link className="cc-live-contests-link" to={`/dashboard/contests?matchId=${encodeURIComponent(internal._id)}`}>View contests for this match</Link>}
        {onCreateMatch && match.category === "upcoming" && match.startTime && new Date(match.startTime) > new Date() && <button type="button" className="cc-live-admin-action" disabled={actionBusy} onClick={() => onCreateMatch(match)}>{actionBusy ? "Adding match…" : "Add to CricketClash and set up contests"}</button>}
      </article>;
    })}</div>}
  </section>;
}
