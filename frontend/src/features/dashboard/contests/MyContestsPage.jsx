import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { notifySessionExpired } from "../../auth/services/authService";
import { getTeamCatalog } from "../../../services/matchService";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import { fetchContestPageData } from "./contestPageApi.js";
import { getContestLobbyView } from "./contestLobbyView.js";
import { MatchCard } from "../matches/MatchCard";
import "./MyContestsPage.css";
import "../matches/MatchesPage.css";

const API_BASE = `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api`;
const TOTAL_SLOTS = 2;
const TIERS = {
  FREE: { label: "Free", color: "free" }, BRONZE: { label: "Bronze", color: "bronze" },
  SILVER: { label: "Silver", color: "silver" }, GOLD: { label: "Gold", color: "gold" },
  PLATINUM: { label: "Platinum", color: "platinum" }, DIAMOND: { label: "Diamond", color: "diamond" },
  ELITE: { label: "Elite", color: "elite" }, CHAMPION: { label: "Champion", color: "champion" },
};

function formatCoins(value) {
  return `${Number(value ?? 0).toLocaleString("en-IN")} coins`;
}

function calculatedPrizePool(contest) {
  const grossPrizePool = Math.max(0, Number(contest.prizePool) || 0);
  const storedPayout = Number(contest.winnerPayout);
  if (Number.isFinite(storedPayout) && (storedPayout > 0 || grossPrizePool === 0)) return storedPayout;

  const platformFee = Number(contest.platformFee);
  const feePercentage = Number.isFinite(Number(contest.platformFeePercentage))
    ? Number(contest.platformFeePercentage)
    : 10;
  const calculatedFee = Number.isFinite(platformFee) && platformFee > 0
    ? platformFee
    : Math.round((grossPrizePool * feePercentage) / 100);
  return Math.max(0, grossPrizePool - calculatedFee);
}

function getSessionId() {
  return sessionStorage.getItem("cc_session_id");
}

function displayTeamName(name) {
  return String(name || "").replace(/\s*\[[A-Z0-9]{2,8}\]\s*$/, "").trim();
}

function matchTabStatus(matchStatus) {
  const status = String(matchStatus || "").toLowerCase();
  if (status === "live") return "live";
  if (status === "upcoming") return "upcoming";
  return "completed";
}

function teamCatalogItem(name, teams) {
  const normalized = displayTeamName(name).toLowerCase();
  return teams.find((team) => [team.name, team.shortName, ...(team.aliases || [])]
    .some((candidate) => displayTeamName(candidate).toLowerCase() === normalized));
}

function normalizeTeamName(name) {
  return displayTeamName(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findProviderFixture(match, providerMatches) {
  const teamA = normalizeTeamName(match.teamA);
  const teamB = normalizeTeamName(match.teamB);
  const candidates = providerMatches.filter((provider) => {
    const providerA = normalizeTeamName(provider.teamA);
    const providerB = normalizeTeamName(provider.teamB);
    return (providerA === teamA && providerB === teamB) || (providerA === teamB && providerB === teamA);
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

function groupJoinedMatches(contests, matches) {
  const byId = new Map(matches.map((match) => [String(match._id), match]));
  const grouped = new Map();
  contests.forEach((contest) => {
    const storedMatch = typeof contest.match === "object" ? contest.match : null;
    const id = String(storedMatch?._id || contest.match || "");
    if (!id) return;
    if (!grouped.has(id)) grouped.set(id, { ...(byId.get(id) || {}), ...(storedMatch || {}) });
    else if (storedMatch?.status) grouped.get(id).status = storedMatch.status;
  });
  return [...grouped.values()].filter(Boolean);
}

function HorizontalCardRow({ children, className = "", label }) {
  const trackRef = useRef(null);
  const scrollByPage = (direction) => {
    const track = trackRef.current;
    if (track) track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.82, 280), behavior: "smooth" });
  };
  return <div className={`cc-horizontal-card-row ${className}`}>
    <div className="cc-horizontal-card-controls" aria-label={`${label} controls`}>
      <button type="button" aria-label={`Scroll ${label} left`} onClick={() => scrollByPage(-1)}>‹</button>
      <button type="button" aria-label={`Scroll ${label} right`} onClick={() => scrollByPage(1)}>›</button>
    </div>
    <div className="cc-horizontal-card-track" ref={trackRef} tabIndex={0} aria-label={label}>{children}</div>
  </div>;
}

export default function MyContestsPage() {
  const navigate = useNavigate();
  const { matches = [] } = useOutletContext();
  const [searchParams] = useSearchParams();
  const matchFilter = searchParams.get("matchId");
  const availableMode = Boolean(matchFilter);
  const [contests, setContests] = useState([]);
  const [selectedMatchData, setSelectedMatchData] = useState(null);
  const [teams, setTeams] = useState([]);
  const [providerMatches, setProviderMatches] = useState([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joiningId, setJoiningId] = useState("");
  const [selectedTeams, setSelectedTeams] = useState({});
  const [sortBy, setSortBy] = useState("entryFee");
  const [notice, setNotice] = useState("");
  const requestRef = useRef(null);
  const joinInProgressRef = useRef(false);
  const joinRequestIdsRef = useRef(new Map());

  const loadContests = useCallback(async ({ silent = false, initial = false, force = false } = {}) => {
    if (requestRef.current && !force) return;
    if (requestRef.current && force) {
      requestRef.current.abort();
      requestRef.current = null;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoading(true);
    if (!silent && !initial) { setError(""); setNotice(""); }
    try {
      const sessionId = getSessionId();
      if (!sessionId) { navigate("/login", { replace: true }); return; }
      const path = availableMode ? `/contests?matchId=${encodeURIComponent(matchFilter)}` : "/contests/mine";
      const response = await fetch(`${API_BASE}${path}`, {
        headers: { "X-CricketClash-Session": sessionId },
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json();
      notifySessionExpired(response, data);
      if ([401, 403].includes(response.status)) { navigate("/login", { replace: true }); return; }
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to load contests.");
      const rows = Array.isArray(data.contests) ? data.contests : [];
      setContests(rows);
      if (availableMode) setSelectedMatchData(data.match || null);
      setCurrentUserId(data.currentUserId || "");
      setSelectedTeams((previous) => Object.fromEntries(
        Object.entries(previous).filter(([contestId, side]) => {
          const contest = rows.find((row) => String(row._id) === contestId);
          if (!contest) return false;
          const players = Array.isArray(contest.players) ? contest.players : [];
          if (players.length === 0) return ["A", "B"].includes(side);
          if (players.length === 1) return side === (players[0].selectedTeam === "A" ? "B" : "A");
          return false;
        })
      ));
      if (!silent && !initial) setNotice(availableMode ? "Available contests updated." : "Your contest matches are up to date.");
    } catch (loadError) {
      if (!silent && loadError.name !== "AbortError") setError(loadError.message || "Unable to load contests.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (initial) setLoading(false);
      }
    }
  }, [availableMode, matchFilter, navigate]);

  useEffect(() => {
    void loadContests({ initial: true });
    const controller = new AbortController();
    void getTeamCatalog({ signal: controller.signal }).then(setTeams).catch(() => {});
    void fetchContestPageData("/cricket-feed", controller.signal)
      .then(({ feed }) => setProviderMatches(Array.isArray(feed?.matches) ? feed.matches : []))
      .catch(() => {});
    return () => {
      controller.abort();
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [loadContests]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadContests({ silent: true }), 15_000);
    return () => window.clearInterval(timer);
  }, [loadContests]);

  const visibleContests = useMemo(() => availableMode
    ? getContestLobbyView(contests, { currentUserId, matchId: matchFilter, now: new Date() })
    : [], [availableMode, contests, currentUserId, matchFilter]);

  const sortedContests = useMemo(() => [...visibleContests].sort((left, right) => {
    if (sortBy === "prizePool") return calculatedPrizePool(right) - calculatedPrizePool(left);
    if (sortBy === "slots") return (TOTAL_SLOTS - (right.players?.length || 0)) - (TOTAL_SLOTS - (left.players?.length || 0));
    return Number(left.entryFee || 0) - Number(right.entryFee || 0);
  }), [visibleContests, sortBy]);

  const joinedMatches = useMemo(() => groupJoinedMatches(contests, matches)
    .map((match) => enrichMatch(match, providerMatches)), [contests, matches, providerMatches]);
  const groupedMatches = useMemo(() => {
    const groups = { live: [], upcoming: [], completed: [] };
    joinedMatches.forEach((match) => groups[matchTabStatus(match.status)].push(match));
    Object.values(groups).forEach((group) => group.sort((left, right) => new Date(left.startTime || 0) - new Date(right.startTime || 0)));
    return groups;
  }, [joinedMatches]);
  const selectedMatch = useMemo(() => {
    const internal = matches.find((match) => String(match._id) === String(matchFilter))
      || selectedMatchData
      || contests.find((contest) => String(contest.match?._id || contest.match) === String(matchFilter))?.match
      || null;
    if (!internal) return null;
    return enrichMatch(internal, providerMatches);
  }, [contests, matchFilter, matches, providerMatches, selectedMatchData]);

  async function handleJoin(contest) {
    if (joinInProgressRef.current) return;
    const selectedTeam = selectedTeams[contest._id];
    if (!selectedTeam) { setNotice("Choose a team before joining this contest."); return; }
    const sessionId = getSessionId();
    if (!sessionId) { navigate("/login", { replace: true }); return; }

    joinInProgressRef.current = true;
    setJoiningId(contest._id);
    setNotice("");
    setError("");
    const matchId = String(contest.match?._id || contest.match);
    const requestKey = `${matchId}:${contest.tier}:${selectedTeam}`;
    const storageKey = `cc-contest-join:${requestKey}`;
    const idempotencyKey = joinRequestIdsRef.current.get(requestKey)
      || sessionStorage.getItem(storageKey)
      || globalThis.crypto.randomUUID();
    joinRequestIdsRef.current.set(requestKey, idempotencyKey);
    sessionStorage.setItem(storageKey, idempotencyKey);
    try {
      const response = await fetch(`${API_BASE}/contests/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CricketClash-Session": sessionId },
        body: JSON.stringify({ matchId, tier: contest.tier, selectedTeam, idempotencyKey }),
      });
      const data = await response.json();
      notifySessionExpired(response, data);
      if ([401, 403].includes(response.status)) { navigate("/login", { replace: true }); return; }
      if (!response.ok || !data.success) {
        const requestError = new Error(data.message || "Unable to join this contest.");
        requestError.status = response.status;
        throw requestError;
      }

      setContests((previous) => previous.map((row) => String(row._id) === String(data.contest?._id) ? data.contest : row));
      setNotice(data.alreadyJoined
        ? "Your contest entry is already confirmed."
        : data.contest?.status === "FULL" && data.contest.players?.every((player) => ["PAID", "NOT_REQUIRED"].includes(player.entryPaymentStatus))
          ? "Joined successfully. You were matched with an opponent choosing the other team."
          : data.contest?.status === "FULL"
            ? "Your entry is reserved while the opponent’s payment is confirmed."
            : "Joined successfully. You are waiting for an opponent choosing the other team.");
      joinRequestIdsRef.current.delete(requestKey);
      sessionStorage.removeItem(storageKey);
      void loadContests({ silent: true, force: true });
    } catch (joinError) {
      if (joinError.status === 409) void loadContests({ silent: true, force: true });
      setError(joinError.message || "Unable to join the contest.");
    } finally {
      joinInProgressRef.current = false;
      setJoiningId("");
    }
  }

  const renderJoinedSection = (key, title) => {
    const sectionMatches = groupedMatches[key];
    return (
      <section className={`cc-my-contests-match-section ${key}`} key={key} aria-labelledby={`my-matches-${key}`}>
        <header><h2 id={`my-matches-${key}`}>{title}</h2><span>{sectionMatches.length}</span></header>
        {sectionMatches.length ? (
          <HorizontalCardRow className="cc-my-contests-match-grid" label={title}>
            {sectionMatches.map((match) => <MatchCard
              key={match._id}
              match={match}
              teams={teams}
              variant="directory"
              layout="tile"
              actionLabel="View Contests"
              actionTarget={`/dashboard/contests/activity?matchId=${encodeURIComponent(match._id)}`}
              showCountdown={key === "upcoming"}
            />)}
          </HorizontalCardRow>
        ) : <div className="cc-match-section-empty">No joined {title.toLowerCase()}.</div>}
      </section>
    );
  };

  return (
    <section className="cc-feature-page cc-contests-page cc-contest-lobby-page">
      <div className="cc-feature-heading cc-contest-lobby-heading">
        <div>
          <span className="cc-feature-eyebrow">{availableMode ? "MATCH CONTESTS" : "YOUR MATCHES"}</span>
          <h1>{availableMode ? "Available Contests" : "My Contests"}</h1>
          <p>{availableMode ? "Review contest details and choose where to play." : "Matches where you have joined at least one contest."}</p>
        </div>
      </div>

      {availableMode && <button type="button" className="cc-my-contests-browse" onClick={() => navigate("/dashboard/matches")}>← Back to Matches</button>}
      {notice && <div className="cc-contest-notice" role="status">{notice}</div>}
      {error && <div className="cc-contest-error" role="alert">{error}<button type="button" onClick={() => loadContests({ force: true })}>Try again</button></div>}

      {loading ? <div className="cc-contest-state"><span className="cc-contest-spinner" /><p>{availableMode ? "Loading available contests..." : "Loading your joined matches..."}</p></div> : availableMode ? (
        <>
          {selectedMatch && <section className="cc-selected-match-summary" aria-label="Selected match details">
            <div className="cc-selected-match-teams">
              {[selectedMatch.teamA, "VS", selectedMatch.teamB].map((teamName, index) => {
                if (index === 1) return <span className="cc-match-vs" key="selected-match-versus">VS</span>;
                const teamIndex = index === 0 ? 0 : 1;
                const catalogTeam = teamCatalogItem(teamName, teams);
                const logo = selectedMatch[teamIndex === 0 ? "teamALogo" : "teamBLogo"] || catalogTeam?.logo;
                return <div className="cc-selected-match-team" key={`${teamName}-${teamIndex}`}><span className="cc-match-team-logo">{catalogTeam?.flag || displayTeamName(teamName).slice(0, 2).toUpperCase()}{logo && <img src={logo} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}</span><strong>{displayTeamName(teamName)}</strong></div>;
              })}
            </div>
            <div className="cc-selected-match-info"><strong>{selectedMatch.competition || selectedMatch.format || "Cricket match"}</strong><span>{selectedMatch.startTime ? formatIndiaDateTime(selectedMatch.startTime, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Schedule to be announced"}</span>{selectedMatch.venue && <span>{selectedMatch.venue}</span>}</div>
            <span className={`cc-match-status-badge ${String(selectedMatch.status || "upcoming").toLowerCase()}`}>{String(selectedMatch.status || "upcoming")}</span>
          </section>}
          <section className="cc-my-selected-contests" aria-live="polite">
            <header className="cc-my-selected-contests-heading">
              <div><span className="cc-feature-eyebrow">AVAILABLE CONTESTS</span><h2>{selectedMatch ? `${displayTeamName(selectedMatch.teamA)} vs ${displayTeamName(selectedMatch.teamB)}` : "Selected match"}</h2></div>
              <label className="cc-contest-sort">Sort by<select value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="entryFee">Lowest entry fee</option><option value="prizePool">Highest prize pool</option><option value="slots">Most available slots</option></select></label>
            </header>
            {sortedContests.length === 0 ? <div className="cc-feature-empty"><h2>No joinable contests for this match</h2><p>All contests may be full, cancelled, completed, or unavailable for entry.</p></div> : (
              <HorizontalCardRow className="cc-selected-contest-grid" label="Available contests">
                {sortedContests.map((contest) => {
                  const match = typeof contest.match === "object" ? contest.match : selectedMatch;
                  const tier = TIERS[contest.tier] || { label: contest.tier || "Contest", color: "default" };
                  const players = Array.isArray(contest.players) ? contest.players : [];
                  const openSlot = contest.status === "OPEN" && players.length === 0;
                  const waitingForOpponent = contest.status === "WAITING" && players.length === 1;
                  const availableSlots = Math.max(0, TOTAL_SLOTS - players.length);
                  const requiredSide = waitingForOpponent ? (players[0].selectedTeam === "A" ? "B" : "A") : "";
                  return <article className="cc-contest-card cc-lobby-contest-card" key={contest._id}>
                    <div className="cc-contest-card-top"><span className={`cc-contest-tier ${tier.color}`}>{tier.label}</span><span className="cc-contest-status open">{waitingForOpponent ? "1 slot left" : "Open"}</span></div>
                    <div className="cc-lobby-contest-title"><h3>{tier.label} Contest</h3><span>Head-to-head</span></div>
                    <div className="cc-lobby-contest-metrics"><div><span>Entry fee</span><strong>{formatCoins(contest.entryFee)}</strong></div><div className="prize"><span>Prize pool</span><strong>{formatCoins(calculatedPrizePool(contest))}</strong></div></div>
                    <div className="cc-lobby-contest-slots"><div><span>Total</span><strong>{TOTAL_SLOTS}</strong></div><div><span>Joined</span><strong>{players.length}</strong></div><div><span>Available</span><strong>{availableSlots}</strong></div></div>
                    {(openSlot || waitingForOpponent) && <div className="cc-contest-join">
                      <label htmlFor={`team-${contest._id}`}>Pick your team</label>
                      <select id={`team-${contest._id}`} value={selectedTeams[contest._id] || ""} disabled={Boolean(joiningId)} onChange={(event) => setSelectedTeams((previous) => ({ ...previous, [contest._id]: event.target.value }))}>
                        <option value="">Choose a team</option>
                        {(!requiredSide || requiredSide === "A") && <option value="A">{displayTeamName(match?.teamA || "Team A")}</option>}
                        {(!requiredSide || requiredSide === "B") && <option value="B">{displayTeamName(match?.teamB || "Team B")}</option>}
                      </select>
                      <small className="cc-contest-team-hint">{waitingForOpponent ? "Choose the opposite team to join this contest." : "You will be matched with someone choosing the opposite team."}</small>
                      <button type="button" className="cc-button cc-button-maroon" disabled={Boolean(joiningId)} onClick={() => handleJoin(contest)}>{joiningId === contest._id ? "Joining..." : "Join"}</button>
                    </div>}
                  </article>;
                })}
              </HorizontalCardRow>
            )}
          </section>
        </>
      ) : contests.length === 0 ? (
        <div className="cc-feature-empty"><h2>You haven’t joined any contests yet</h2><p>Browse Matches and join a contest to see your matches here.</p><button type="button" className="cc-button cc-button-maroon" onClick={() => navigate("/dashboard/matches")}>Browse Matches</button></div>
      ) : (
        <div className="cc-my-contests-match-sections">
          {renderJoinedSection("live", "Live Matches")}
          {renderJoinedSection("upcoming", "Upcoming Matches")}
          {renderJoinedSection("completed", "Completed Matches")}
        </div>
      )}
    </section>
  );
}
