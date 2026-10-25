import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { getTeamCatalog } from "../../../services/matchService";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import { MatchCountdown } from "../matches/MatchCard";
import { fetchContestPageData, formatContestCoins, matchResultLabel } from "./contestPageApi";
import "./MyContestsPage.css";

const FILTERS = [
  { id: "all", label: "All Contests" },
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
];

function getUserId(player) {
  return typeof player?.user === "object" ? player.user?.userId : player?.user;
}

function displayTeamName(name) {
  return String(name || "").replace(/\s*\[[A-Z0-9]{2,8}\]\s*$/, "").trim();
}

function teamInitials(name) {
  return displayTeamName(name).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function normalizeTeamName(name) {
  return displayTeamName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findProviderFixture(match, providerMatches) {
  if (!match) return null;
  const teamA = normalizeTeamName(match.teamA);
  const teamB = normalizeTeamName(match.teamB);
  const candidates = providerMatches.filter((fixture) => {
    const fixtureA = normalizeTeamName(fixture.teamA);
    const fixtureB = normalizeTeamName(fixture.teamB);
    return (fixtureA === teamA && fixtureB === teamB) || (fixtureA === teamB && fixtureB === teamA);
  });
  if (!candidates.length) return null;
  const matchTime = new Date(match.startTime || 0).getTime();
  return candidates.sort((left, right) =>
    Math.abs(new Date(left.startTime || 0).getTime() - matchTime)
    - Math.abs(new Date(right.startTime || 0).getTime() - matchTime)
  )[0];
}

function enrichMatch(match, providerMatches) {
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
}

function teamDisplay(name, teams) {
  const normalized = normalizeTeamName(name);
  const catalogTeam = teams.find((team) => [team.name, team.shortName, ...(team.aliases || [])]
    .some((candidate) => normalizeTeamName(candidate) === normalized));
  return { badge: catalogTeam?.flag || teamInitials(name), logo: catalogTeam?.logo || "" };
}

function selectedTeam(selection, match) {
  if (selection === "A") return displayTeamName(match?.teamA || "Team A");
  if (selection === "B") return displayTeamName(match?.teamB || "Team B");
  return "Not selected";
}

function matchCategory(match) {
  const status = String(match?.status || "").toLowerCase();
  if (status === "live") return "live";
  if (status === "upcoming") return "upcoming";
  return "completed";
}

function statusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "live") return "Live";
  if (normalized === "upcoming") return "Upcoming";
  if (normalized === "completed") return "Completed";
  if (normalized === "cancelled") return "Cancelled";
  if (normalized === "abandoned") return "Abandoned";
  return "Completed";
}

function contestName(tier) {
  const name = String(tier || "Standard").toLowerCase();
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} Contest`;
}

function getRank(isWinner, isLoser, isRefunded) {
  if (isRefunded) return "—";
  if (isWinner) return "#1";
  if (isLoser) return "#2";
  return "—";
}

export default function ContestActivityPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [searchParams] = useSearchParams();
  const matchFilter = searchParams.get("matchId");
  const [contests, setContests] = useState([]);
  const [teams, setTeams] = useState([]);
  const [providerMatches, setProviderMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedContestIds, setExpandedContestIds] = useState(() => new Set());
  const activityScrollerRef = useRef(null);

  function scrollActivity(direction) {
    const scroller = activityScrollerRef.current;
    if (scroller) scroller.scrollBy({ left: direction * Math.max(scroller.clientWidth * 0.82, 300), behavior: "smooth" });
  }

  useEffect(() => {
    const controller = new AbortController();
    let requestActive = false;
    async function loadActivity(initial = false) {
      if (requestActive) return;
      requestActive = true;
      if (initial) { setLoading(true); setError(""); }
      try {
        const data = await fetchContestPageData("/contests/mine", controller.signal);
        setContests(Array.isArray(data.contests) ? data.contests : []);
      } catch (loadError) {
        if (loadError.name === "AbortError") return;
        if ([401, 403].includes(loadError.status)) {
          navigate("/login", { replace: true });
          return;
        }
        setError(loadError.message || "Unable to load your contest activity.");
      } finally {
        requestActive = false;
        if (initial && !controller.signal.aborted) setLoading(false);
      }
    }
    void getTeamCatalog({ signal: controller.signal }).then(setTeams).catch(() => {});
    void fetchContestPageData("/cricket-feed", controller.signal)
      .then(({ feed }) => setProviderMatches(Array.isArray(feed?.matches) ? feed.matches : []))
      .catch(() => {});
    void loadActivity(true);
    const refreshTimer = window.setInterval(() => void loadActivity(), 15_000);
    const feedTimer = window.setInterval(() => {
      void fetchContestPageData("/cricket-feed", controller.signal)
        .then(({ feed }) => setProviderMatches(Array.isArray(feed?.matches) ? feed.matches : []))
        .catch(() => {});
    }, 60_000);
    return () => { window.clearInterval(refreshTimer); window.clearInterval(feedTimer); controller.abort(); };
  }, [navigate]);

  const enrichedContests = contests.map((contest) => ({
    ...contest,
    match: typeof contest.match === "object" ? enrichMatch(contest.match, providerMatches) : contest.match,
  }));
  const visibleContests = enrichedContests.filter((contest) =>
    !matchFilter || String(contest.match?._id || contest.match) === matchFilter
  );
  const counts = useMemo(() => visibleContests.reduce((result, contest) => {
    result.all += 1;
    result[matchCategory(contest.match)] += 1;
    return result;
  }, { all: 0, live: 0, upcoming: 0, completed: 0 }), [visibleContests]);
  const filteredContests = visibleContests.filter((contest) =>
    activeFilter === "all" || matchCategory(contest.match) === activeFilter
  );

  function toggleDetails(contestId) {
    setExpandedContestIds((current) => {
      const next = new Set(current);
      if (next.has(contestId)) next.delete(contestId);
      else next.add(contestId);
      return next;
    });
  }

  return (
    <section className="cc-feature-page cc-contests-page cc-activity-page">
      <header className="cc-activity-banner">
        <div className="cc-activity-banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M7 3h10v2h3v2a5 5 0 0 1-4 4.9A6 6 0 0 1 13 15v3h4v3H7v-3h4v-3a6 6 0 0 1-3-3.1A5 5 0 0 1 4 7V5h3V3Zm0 4H6v1a3 3 0 0 0 2.2 2.9A9 9 0 0 1 7 7Zm11 0a9 9 0 0 1-1.2 3A3 3 0 0 0 19 8V7h-1Z" /></svg></div>
        <div><span>YOUR CONTEST ACTIVITY</span><p>Track your joined contests, live status, winnings and more.</p></div>
        <button type="button" className="cc-activity-back" onClick={() => navigate("/dashboard/contests")}>Back to contests</button>
      </header>

      {error && <div className="cc-contest-error" role="alert">{error}</div>}

      <nav className="cc-activity-filters" aria-label="Filter contest activity">
        {FILTERS.map((filter) => (
          <button type="button" key={filter.id} className={activeFilter === filter.id ? "active" : ""} aria-pressed={activeFilter === filter.id} onClick={() => setActiveFilter(filter.id)}>
            {filter.label}<span>{counts[filter.id]}</span>
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="cc-contest-state"><span className="cc-contest-spinner" /><p>Loading activity...</p></div>
      ) : filteredContests.length === 0 ? (
        <div className="cc-feature-empty">{visibleContests.length ? `No ${activeFilter} contests to show.` : `You have not joined a contest${matchFilter ? " for this match" : ""} yet.`}</div>
      ) : (
        <div className="cc-activity-carousel">
        <div className="cc-activity-carousel-controls" aria-label="Contest activity carousel controls">
          <button type="button" aria-label="Scroll contest activity left" onClick={() => scrollActivity(-1)}>‹</button>
          <button type="button" aria-label="Scroll contest activity right" onClick={() => scrollActivity(1)}>›</button>
        </div>
        <div className="cc-activity-cards" ref={activityScrollerRef} tabIndex={0} aria-label="Your contest activity">
          {filteredContests.map((contest) => {
            const match = typeof contest.match === "object" ? contest.match : null;
            const players = Array.isArray(contest.players) ? contest.players : [];
            const ownPlayer = players.find((player) => String(getUserId(player) || "") === String(user?.userId || ""));
            const opponent = players.find((player) => String(getUserId(player) || "") !== String(user?.userId || ""));
            const winnerId = typeof contest.winnerId === "object" ? contest.winnerId?.userId : contest.winnerId;
            const isSettled = contest.settlementStatus === "SETTLED";
            const isWinner = isSettled && String(winnerId || "") === String(user?.userId || "");
            const isLoser = isSettled && Boolean(winnerId) && !isWinner;
            const isRefunded = contest.status === "REFUNDED" || contest.settlementStatus === "REFUNDED";
            const category = matchCategory(match);
            const badgeText = statusLabel(match?.status);
            const teamA = teamDisplay(match?.teamA, teams);
            const teamB = teamDisplay(match?.teamB, teams);
            const joinedCount = players.length;
            const rank = getRank(isWinner, isLoser, isRefunded);
            const winnings = isWinner
              ? formatContestCoins(contest.winnerPayout)
              : isLoser || isRefunded
                ? formatContestCoins(0)
                : formatContestCoins(contest.winnerPayout ?? contest.prizePool);
            const expanded = expandedContestIds.has(contest._id);

            return (
              <article className={`cc-activity-card ${category} ${isWinner ? "winner" : ""}`} key={contest._id}>
                <div className="cc-activity-match-column">
                  <div className="cc-activity-card-meta">
                    <span className={`cc-activity-badge ${category}`}>{badgeText}</span>
                    <span className="cc-activity-competition">{match?.competition || match?.format || "Cricket"}</span>
                    {match?.format && <span className="cc-activity-format">{match.format}</span>}
                  </div>
                  <div className="cc-activity-team-versus">
                    <div className="cc-activity-team"><span>{teamA.badge}{(match?.teamALogo || teamA.logo) && <img src={match.teamALogo || teamA.logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}</span><strong>{displayTeamName(match?.teamA || "Team A")}</strong></div>
                    <span className="cc-activity-versus">VS</span>
                    <div className="cc-activity-team"><span>{teamB.badge}{(match?.teamBLogo || teamB.logo) && <img src={match.teamBLogo || teamB.logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}</span><strong>{displayTeamName(match?.teamB || "Team B")}</strong></div>
                  </div>
                  <p className="cc-activity-match-time">{match?.startTime ? formatIndiaDateTime(match.startTime, { dateStyle: "medium", timeStyle: "short" }) : "Match time unavailable"}</p>
                  {category === "upcoming" && match?.startTime && <MatchCountdown startTime={match.startTime} className="cc-activity-countdown" />}
                  {match?.venue && <p className="cc-activity-match-venue">{match.venue}</p>}
                </div>

                <div className="cc-activity-contest-column">
                  <div className="cc-activity-contest-title"><div><h2>{contestName(contest.tier)}</h2><p>{formatContestCoins(contest.entryFee)} entry <span>•</span> 2 spots</p></div></div>
                  <div className="cc-activity-slots" aria-label={`${joinedCount} of 2 players joined`}><span><i style={{ width: `${Math.min(100, joinedCount * 50)}%` }} /></span><strong>{joinedCount} / 2 joined</strong><small>{Math.max(0, 2 - joinedCount)} left</small></div>
                  <div className="cc-activity-stats">
                    <div><span>Your rank</span><strong>{rank}</strong></div>
                    <div><span>Your team</span><strong>{selectedTeam(ownPlayer?.selectedTeam, match)}</strong></div>
                    <div><span>{isSettled ? "Winnings" : "Potential winnings"}</span><strong className={isWinner ? "positive" : ""}>{winnings}</strong></div>
                  </div>
                </div>

                <aside className="cc-activity-action-column">
                  <div className="cc-activity-entry"><span>Entry fee</span><strong>{formatContestCoins(contest.entryFee)}</strong></div>
                  <div className="cc-activity-entry"><span>Joined on</span><strong>{ownPlayer?.joinedAt ? formatIndiaDateTime(ownPlayer.joinedAt, { dateStyle: "medium", timeStyle: "short" }) : "Date unavailable"}</strong></div>
                  <button type="button" className="cc-activity-details-button" aria-expanded={expanded} aria-controls={`contest-details-${contest._id}`} onClick={() => toggleDetails(contest._id)}>
                    {expanded ? "Hide Details" : "View Details"}<span aria-hidden="true">›</span>
                  </button>
                </aside>

                {expanded && <div className="cc-activity-expanded-details" id={`contest-details-${contest._id}`}>
                  <div><span>Opponent</span><strong>{getUserId(opponent) || (players.length < 2 ? "Waiting for opponent" : "No opponent")}</strong><small>{selectedTeam(opponent?.selectedTeam, match)}</small></div>
                  <div><span>Match result</span><strong>{matchResultLabel(match)}</strong><small>Match {match?.status || "status unavailable"}</small></div>
                  <div><span>Contest settlement</span><strong>{contest.settlementStatus || "Pending"}</strong><small>{isRefunded ? `Refund status: ${ownPlayer?.refundStatus || "pending"}` : contest.settledAt ? `Settled ${formatIndiaDateTime(contest.settledAt)}` : "Settlement pending"}</small></div>
                </div>}
              </article>
            );
          })}
        </div>
        </div>
      )}
    </section>
  );
}
