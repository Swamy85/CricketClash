
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatIndiaDateTime } from "../../../utils/dateTime";

export function formatMatchDate(value) {
  if (!value) return "Schedule to be announced";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Schedule to be announced";
  }

  return formatIndiaDateTime(date, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCountdown(startTime, now) {
  const remaining = new Date(startTime).getTime() - now;

  if (!Number.isFinite(remaining)) return "Schedule to be announced";
  if (remaining <= 0) return "Starting now";

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : `${hours}h ${minutes}m ${seconds}s`;
}

function formatStatus(status) {
  if (!status) return "Upcoming";

  return String(status)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function MatchCard({ match }) {
  const [now, setNow] = useState(Date.now());
  const navigate = useNavigate();
  const scheduledStart = new Date(match.startTime).getTime();
  const storedStatus = String(match.status || "upcoming").toLowerCase();
  const status = storedStatus === "upcoming" && scheduledStart <= now
    ? "live"
    : storedStatus;

  const isLive =
    status.includes("live") || status.includes("progress");
  const canJoin = status === "upcoming";
  const resultText = match.result === "teamA"
    ? `${match.teamA} won`
    : match.result === "teamB"
      ? `${match.teamB} won`
      : match.result === "tie"
        ? "Tie"
        : match.result === "no_result"
          ? "No result"
          : match.result === "abandoned"
            ? "Abandoned"
            : match.result === "cancelled"
              ? "Cancelled"
              : "Head-to-head";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <article className="cc-match-card">
      <div className="cc-match-card-header">
        <span className={`cc-match-status ${isLive ? "live" : ""}`}>
          <span className="cc-status-dot" />
          {formatStatus(status)}
        </span>

        <span className="cc-match-format">
          {match.format || "Cricket"}
        </span>
      </div>

      <div className="cc-match-teams">
        <div className="cc-match-team">
          <span className="cc-team-mark">
            {(match.teamA || "A").slice(0, 3).toUpperCase()}
          </span>
          <strong>{match.teamA || "Team A"}</strong>
        </div>

        <span className="cc-match-vs">VS</span>

        <div className="cc-match-team">
          <span className="cc-team-mark">
            {(match.teamB || "B").slice(0, 3).toUpperCase()}
          </span>
          <strong>{match.teamB || "Team B"}</strong>
        </div>
      </div>

      <div className="cc-match-card-footer">
        <span>
          ◷ {formatMatchDate(match.startTime)}
          {canJoin && match.startTime && (
            <small className="cc-match-countdown">
              Starts in {formatCountdown(match.startTime, now)}
            </small>
          )}
        </span>
        <span>{resultText}</span>
      </div>

      <button
        type="button"
        className="cc-button cc-button-maroon cc-match-join-button"
        disabled={!canJoin}
        onClick={() =>
          navigate(`/dashboard/contests?matchId=${encodeURIComponent(match._id)}`)
        }
      >
        {canJoin ? "Join Contest" : isLive ? "Match is live" : "Entries closed"}
      </button>
    </article>
  );
}
