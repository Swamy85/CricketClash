import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatIndiaDateTime } from "../../../utils/dateTime";

function teamDisplay(name, teams) {
  const normalized = String(name || "").replace(/\s*\[[A-Z0-9]{2,8}\]\s*$/, "").trim();
  const team = teams.find((item) => [item.name, item.shortName, ...(item.aliases || [])]
    .some((candidate) => String(candidate || "").replace(/\s*\[[A-Z0-9]{2,8}\]\s*$/, "").trim().toLowerCase() === normalized.toLowerCase()));
  const initials = normalized.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return { name: normalized || "Team", flag: team?.flag || "", logo: team?.logo || "", initials };
}

function Team({ name, logo, teams, score }) {
  const team = teamDisplay(name, teams);
  return (
    <div className="cc-match-team">
      <span className="cc-match-team-logo" aria-hidden="true">
        {team.flag || team.initials}
        {(logo || team.logo) && <img src={logo || team.logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
      </span>
      <strong>{team.name}</strong>
      {score && <small className="cc-match-team-score">{score}</small>}
    </div>
  );
}

export function MatchCountdown({ startTime, className = "cc-match-countdown-line" }) {
  const [now, setNow] = useState(Date.now());
  const target = new Date(startTime).getTime();

  useEffect(() => {
    if (!Number.isFinite(target) || target <= Date.now()) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  const remaining = target - now;
  if (!Number.isFinite(target) || remaining <= 0) return null;

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const pad = (value) => String(value).padStart(2, "0");
  const countdown = days > 0
    ? `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;

  return <span className={className} aria-label={`Match starts in ${countdown}`}><span aria-hidden="true">Starts in</span><strong>{countdown}</strong></span>;
}

function LegacyMatchCard({ match, teams = [] }) {
  const [now, setNow] = useState(Date.now());
  const navigate = useNavigate();
  const storedStatus = String(match.status || "upcoming").toLowerCase();
  const startTime = new Date(match.startTime).getTime();
  const status = storedStatus === "upcoming" && startTime <= now ? "live" : storedStatus;
  const canJoin = status === "upcoming";
  const teamA = teamDisplay(match.teamA, teams);
  const teamB = teamDisplay(match.teamB, teams);
  const remaining = Number.isFinite(startTime) ? Math.max(0, startTime - now) : 0;
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const pad = (value) => String(value).padStart(2, "0");
  const countdown = days > 0
    ? `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
    : `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <article className="cc-match-card">
      <div className="cc-match-card-header"><span className={`cc-match-status ${status === "live" ? "live" : ""}`}><span className="cc-status-dot" />{status.replace(/[-_]/g, " ")}</span><span className="cc-match-format">{match.format || "Cricket"}</span></div>
      {match.competition && <strong className="cc-lobby-match-competition">{match.competition}</strong>}
      <div className="cc-match-teams"><div className="cc-match-team"><span className="cc-team-mark">{teamA.flag || teamA.initials}{(match.teamALogo || teamA.logo) && <img src={match.teamALogo || teamA.logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}</span><strong>{teamA.name}</strong></div><span className="cc-match-vs">VS</span><div className="cc-match-team"><span className="cc-team-mark">{teamB.flag || teamB.initials}{(match.teamBLogo || teamB.logo) && <img src={match.teamBLogo || teamB.logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}</span><strong>{teamB.name}</strong></div></div>
      <div className="cc-match-card-footer"><span>{match.startTime ? formatIndiaDateTime(match.startTime, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Schedule to be announced"}{canJoin && Number.isFinite(startTime) && <small className="cc-match-countdown">Starts in {countdown}</small>}{match.venue && <small className="cc-lobby-match-venue">{match.venue}</small>}</span></div>
      <button type="button" className="cc-button cc-button-maroon cc-match-join-button" disabled={!canJoin} onClick={() => navigate(`/dashboard/contests?matchId=${encodeURIComponent(match._id)}`)}>{canJoin ? "Join Contest" : status === "live" ? "Match is live" : "Entries closed"}</button>
    </article>
  );
}

export function MatchCard({ match, contestsCount, teams = [], variant = "legacy", layout = "row", actionLabel = "View Contests", actionTarget = "", showCountdown = false }) {
  if (variant !== "directory") return <LegacyMatchCard match={match} teams={teams} />;
  const navigate = useNavigate();
  const status = String(match.status || "upcoming").toLowerCase();
  const completed = ["completed", "cancelled", "abandoned"].includes(status);
  const resultText = match.result === "teamA"
    ? `${match.teamA} won`
    : match.result === "teamB"
      ? `${match.teamB} won`
      : match.result === "tie"
        ? "Match tied"
        : match.result === "no_result"
          ? "No result"
          : status === "cancelled" ? "Match cancelled" : status === "abandoned" ? "Match abandoned" : match.providerScoreSummary || (match.providerScoreA || match.providerScoreB ? `${match.teamA} ${match.providerScoreA || ""} · ${match.teamB} ${match.providerScoreB || ""}` : "Result unavailable");
  const formattedDate = match.startTime
    ? formatIndiaDateTime(match.startTime, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "Schedule to be announced";

  return (
    <article className={`cc-match-card cc-match-card-redesign ${status} ${layout === "tile" ? "tile" : ""}`}>
      <div className="cc-match-main">
        <div className="cc-match-card-header">
          <span className={`cc-match-status-badge ${completed ? "completed" : status}`}>
            <i aria-hidden="true" />{status.replace(/[-_]/g, " ")}
          </span>
          <span className="cc-match-format">{match.format || "Cricket"}</span>
        </div>
        <div className="cc-match-teams cc-match-teams-redesign">
          <Team name={match.teamA} logo={match.teamALogo} teams={teams} score={match.providerScoreA} />
          <span className="cc-match-vs">VS</span>
          <Team name={match.teamB} logo={match.teamBLogo} teams={teams} score={match.providerScoreB} />
        </div>
      </div>
      <div className="cc-match-information">
        <strong className="cc-match-competition">{match.competition || "Tournament not specified"}</strong>
        <span className="cc-match-date-line">{formattedDate}</span>
        {(showCountdown || status === "upcoming") && match.startTime && <MatchCountdown startTime={match.startTime} />}
        {(match.venue || match.stadium) && <span className="cc-match-venue">{match.venue || match.stadium}</span>}
        {match.providerStatus && <span className="cc-match-provider-update">{match.providerStatus}</span>}
        {completed && <span className="cc-match-result">{resultText}</span>}
      </div>
      <div className="cc-match-action-panel">
        {completed ? (
          <>
            <span className="cc-match-action-label">Result</span>
            <strong className="cc-match-action-value">{resultText}</strong>
            <Link className="cc-match-action-button secondary" to={actionTarget || `/dashboard/contests/activity?matchId=${encodeURIComponent(match._id)}`}>{actionTarget ? actionLabel : "View Details"} <span aria-hidden="true">→</span></Link>
          </>
        ) : (
          <>
            <span className="cc-match-action-label">Contests Available</span>
            <strong className="cc-match-action-value">{Number.isFinite(contestsCount) ? contestsCount : "—"}</strong>
            <button className="cc-match-action-button" type="button" onClick={() => navigate(actionTarget || `/dashboard/contests?matchId=${encodeURIComponent(match._id)}`)}>{actionLabel} <span aria-hidden="true">→</span></button>
          </>
        )}
      </div>
    </article>
  );
}
