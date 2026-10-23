
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { notifySessionExpired } from "../../auth/services/authService";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import { DEFAULT_CONTEST_CATEGORY, getContestLobbyView, getJoinedContestStatus, getJoinedContestView } from "./contestLobbyView.js";
import { fetchContestPageData, formatContestCoins, matchResultLabel } from "./contestPageApi.js";

import "./MyContestsPage.css";

const API_BASE = `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api`;

const TIERS = {
  FREE: { label: "Free", color: "free" },
  BRONZE: { label: "Bronze", color: "bronze" },
  SILVER: { label: "Silver", color: "silver" },
  GOLD: { label: "Gold", color: "gold" },
  PLATINUM: { label: "Platinum", color: "platinum" },
  DIAMOND: { label: "Diamond", color: "diamond" },
  ELITE: { label: "Elite", color: "elite" },
  CHAMPION: { label: "Champion", color: "champion" },
};

function formatCoins(value) {
  return `${Number(value ?? 0).toLocaleString("en-IN")} coins`;
}

function getSessionId() {
  return sessionStorage.getItem("cc_session_id");
}

function getPublicPlayerId(player) {
  return typeof player?.user === "object" ? player.user?.userId : "";
}

function selectedTeamName(selection, match) {
  if (selection === "A") return match?.teamA || "Team A";
  if (selection === "B") return match?.teamB || "Team B";
  return "—";
}

function JoinedContestList({ contests, user, loading, error, onRetry }) {
  if (loading && contests.length === 0) {
    return <div className="cc-contest-state"><span className="cc-contest-spinner" /><p>Loading your joined contests...</p></div>;
  }
  if (error && contests.length === 0) {
    return <div className="cc-contest-error" role="alert">{error}<button type="button" onClick={onRetry}>Try again</button></div>;
  }
  if (contests.length === 0) {
    return <div className="cc-feature-empty"><span className="cc-empty-icon">🏏</span><h2>No joined contests yet</h2><p>Join an available contest and your entries will appear here with match, opponent, and result details.</p></div>;
  }

  return (
    <div className="cc-contest-match-groups">
      <div className="cc-my-contest-list">
        {contests.map((contest) => {
          const match = typeof contest.match === "object" ? contest.match : null;
          const players = Array.isArray(contest.players) ? contest.players : [];
          const ownPlayer = players.find((player) => String(getPublicPlayerId(player) || "") === String(user?.userId || ""));
          const opponent = players.find((player) => String(getPublicPlayerId(player) || "") !== String(user?.userId || ""));
          const { label: statusLabel, won, lost, refunded } = getJoinedContestStatus(contest, user?.userId);

          return (
            <article className={`cc-my-contest-row cc-contest-activity-row ${won ? "winner" : ""} ${lost ? "loser" : ""}`} key={contest._id}>
              <div><span>{contest.tier} · {statusLabel}</span><strong>{match ? `${match.teamA} vs ${match.teamB}` : "Match details unavailable"}</strong><small>{match?.format || "Cricket"} · Match {match?.status || "status unavailable"}</small></div>
              <div><span>Your selected team</span><strong>{selectedTeamName(ownPlayer?.selectedTeam, match)}</strong><small>Contest {contest.status}</small></div>
              <div><span>Opponent</span><strong>{getPublicPlayerId(opponent) || (players.length < 2 ? "Waiting for opponent" : "Unavailable")}</strong><small>{selectedTeamName(opponent?.selectedTeam, match)}</small></div>
              <div><span>Match result</span><strong>{matchResultLabel(match)}</strong><small>{contest.settlementStatus || "Settlement pending"}</small></div>
              <div><span>Entry and prize</span><strong>{formatCoins(contest.entryFee)} entry</strong><small>Prize pool {formatCoins(contest.prizePool)}</small></div>
              <div><span>Your outcome</span><strong>{won ? `Won · ${formatCoins(contest.winnerPayout)}` : lost ? "Lost" : refunded ? `Refunded · ${formatCoins(contest.entryFee)}` : statusLabel}</strong><small>{refunded ? `Refund ${ownPlayer?.refundStatus || "pending"}` : `Potential payout ${formatCoins(contest.winnerPayout)}`}</small></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default function MyContestsPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [searchParams] = useSearchParams();
  const matchFilter = searchParams.get("matchId");

  const [contests, setContests] = useState([]);
  const [joinedContests, setJoinedContests] = useState([]);
  const [joinedLoading, setJoinedLoading] = useState(true);
  const [joinedError, setJoinedError] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState(DEFAULT_CONTEST_CATEGORY);
  const [joiningId, setJoiningId] = useState("");
  const [selectedTeams, setSelectedTeams] = useState({});
  const [notice, setNotice] = useState("");
  const requestRef = useRef(null);
  const joinedRequestRef = useRef(null);
  const joinInProgressRef = useRef(false);
  const joinRequestIdsRef = useRef(new Map());

  const loadContests = useCallback(async ({ silent = false, initial = false, force = false } = {}) => {
    if (requestRef.current && !force) return;
    if (requestRef.current && force) {
      const previous = requestRef.current;
      requestRef.current = null;
      previous.abort();
    }

    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoading(true);
    if (!silent && !initial) {
      setRefreshing(true);
      setError("");
      setNotice("");
    }
    try {
      const sessionId = getSessionId();

      if (!sessionId) {
        if (!silent) navigate("/login", { replace: true });
        return;
      }

      const headers = { "X-CricketClash-Session": sessionId };
      const requestOptions = { headers, signal: controller.signal, cache: "no-store" };
      const response = await fetch(`${API_BASE}/contests`, requestOptions);
      const data = await response.json();

      notifySessionExpired(response, data);

      if ([401, 403].includes(response.status)) {
        navigate("/login");
        return;
      }

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(data.message || "Failed to load contests.");
      }

      const nextContests = Array.isArray(data.contests) ? data.contests : [];
      setContests(nextContests);
      setSelectedTeams((previous) => Object.fromEntries(
        Object.entries(previous).filter(([contestId, side]) => {
          const current = nextContests.find((contest) => String(contest._id) === contestId);
          if (!current) return false;
          const players = Array.isArray(current.players) ? current.players : [];
          const validSides = players.length === 0
            ? ["A", "B"]
            : players.length === 1
              ? [players[0].selectedTeam === "A" ? "B" : "A"]
              : [];
          return validSides.includes(side);
        })
      ));
      setCurrentUserId(data.currentUserId || "");
      if (!silent && !initial) setNotice("Contests updated.");
    } catch (err) {
      if (!silent && err.name !== "AbortError") {
        setError(err.message || "Unable to load contests.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (initial) setLoading(false);
        if (!silent && !initial) setRefreshing(false);
      }
    }
  }, [navigate]);

  const loadJoinedContests = useCallback(async ({ silent = false, force = false } = {}) => {
    if (joinedRequestRef.current && !force) return;
    if (joinedRequestRef.current && force) {
      const previous = joinedRequestRef.current;
      joinedRequestRef.current = null;
      previous.abort();
    }
    const controller = new AbortController();
    joinedRequestRef.current = controller;
    if (!silent) {
      setJoinedLoading(true);
      setJoinedError("");
    }
    try {
      const data = await fetchContestPageData("/contests/mine", controller.signal);
      setJoinedContests(Array.isArray(data.contests) ? data.contests : []);
    } catch (err) {
      if (err.name === "AbortError") return;
      if ([401, 403].includes(err.status)) {
        navigate("/login", { replace: true });
        return;
      }
      if (!silent) setJoinedError(err.message || "Unable to load joined contests.");
    } finally {
      if (joinedRequestRef.current === controller) {
        joinedRequestRef.current = null;
        if (!silent) setJoinedLoading(false);
      }
    }
  }, [navigate]);

  useEffect(() => {
    void loadContests({ initial: true });
    void loadJoinedContests();
    return () => {
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
      const joinedRequest = joinedRequestRef.current;
      joinedRequestRef.current = null;
      joinedRequest?.abort();
    };
  }, [loadContests, loadJoinedContests]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadContests({ silent: true });
      void loadJoinedContests({ silent: true });
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [loadContests, loadJoinedContests]);

  async function handleJoin(contest) {
    if (joinInProgressRef.current) return;

    const selectedTeam = selectedTeams[contest._id];

    if (!selectedTeam) {
      setNotice("Please select one of the teams first.");
      return;
    }

    joinInProgressRef.current = true;
    setJoiningId(contest._id);
    setNotice("");
    setError("");

    try {
      const requestKey = `${contest.match?._id || contest.match}:${contest.tier}:${selectedTeam}`;
      const storageKey = `cc-contest-join:${requestKey}`;
      const idempotencyKey = joinRequestIdsRef.current.get(requestKey)
        || sessionStorage.getItem(storageKey)
        || globalThis.crypto.randomUUID();
      joinRequestIdsRef.current.set(requestKey, idempotencyKey);
      sessionStorage.setItem(storageKey, idempotencyKey);
      const response = await fetch(
        `${API_BASE}/contests/join`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CricketClash-Session": getSessionId(),
          },
          body: JSON.stringify({
            matchId: String(contest.match?._id || contest.match),
            tier: contest.tier,
            selectedTeam,
            idempotencyKey,
          }),
        }
      );

      const data = await response.json();

      if (response.status === 401 || response.status === 403) {
        navigate("/login");
        return;
      }

      if (!response.ok || !data.success) {
        if (response.status === 409) await loadContests({ silent: true });
        throw new Error(data.message || "Unable to join this contest.");
      }

      setNotice(
        data.contest?.status === "FULL" && data.contest.players?.every((player) => ["PAID", "NOT_REQUIRED"].includes(player.entryPaymentStatus))
          ? "You were automatically matched with an opponent who chose the other team."
          : data.contest?.status === "FULL"
            ? "Your entry is reserved while the opponent's payment is confirmed."
            : "Entry accepted. You are waiting for an opponent to choose the other team."
      );
      joinRequestIdsRef.current.delete(requestKey);
      sessionStorage.removeItem(storageKey);
      await Promise.all([
        loadContests({ silent: true, force: true }),
        loadJoinedContests({ silent: true, force: true }),
      ]);
    } catch (err) {
      setError(err.message || "Unable to join the contest.");
    } finally {
      joinInProgressRef.current = false;
      setJoiningId("");
    }
  }

  const visibleContests = getContestLobbyView(contests, {
    currentUserId,
    matchId: matchFilter,
    now: new Date(),
  });
  const visibleJoinedContests = getJoinedContestView(joinedContests, matchFilter);
  const groupedContests = visibleContests.reduce((groups, contest) => {
    const match = contest.match && typeof contest.match === "object" ? contest.match : null;
    const key = String(match?._id || contest.match || "unknown-match");
    if (!groups.has(key)) groups.set(key, { match, contests: [] });
    groups.get(key).contests.push(contest);
    return groups;
  }, new Map());
  return (
    <section className="cc-feature-page cc-contests-page cc-contest-lobby-page">
      <div className="cc-feature-heading cc-contest-lobby-heading">
        <div>
          <span className="cc-feature-eyebrow">MATCH CONTESTS</span>
          <h1>My Contests</h1>
          <p>
            Choose a match, entry tier, and team. We automatically match you with an opponent who chooses the other team; if none is waiting, your entry waits for one.
          </p>
        </div>

        <button
          type="button"
          className="cc-contest-refresh"
          onClick={() => filter === "JOINED" ? loadJoinedContests() : loadContests()}
          disabled={filter === "JOINED" ? joinedLoading : loading || refreshing}
        >
          {(filter === "JOINED" ? joinedLoading : refreshing) ? "Updating..." : "Refresh"}
        </button>
      </div>

      <div className="cc-contest-lobby-toolbar">
      <div className="cc-contest-filters" aria-label="Filter contests">
        {[
          ["AVAILABLE", "Available Contests"],
          ["JOINED", "Joined Contests"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="cc-contest-result-count">{filter === "JOINED" ? visibleJoinedContests.length : visibleContests.length} {(filter === "JOINED" ? visibleJoinedContests.length : visibleContests.length) === 1 ? "contest" : "contests"}</span>
      </div>

      {notice && (
        <div className="cc-contest-notice" role="status">
          {notice}
        </div>
      )}

      {error && (
        <div className="cc-contest-error" role="alert">
          {error}
          <button type="button" onClick={loadContests}>
            Try again
          </button>
        </div>
      )}

      {filter === "JOINED" ? (
        <JoinedContestList
          contests={visibleJoinedContests}
          user={user}
          loading={joinedLoading}
          error={joinedError}
          onRetry={() => loadJoinedContests()}
        />
      ) : loading && contests.length === 0 ? (
        <div className="cc-contest-state">
          <span className="cc-contest-spinner" />
          <p>Loading contests...</p>
        </div>
      ) : visibleContests.length === 0 ? (
        <div className="cc-feature-empty">
          <span className="cc-empty-icon">⚔️</span>
          <h2>{contests.length ? "No contests here yet" : "No contests available yet"}</h2>
          <p>
            {contests.length
              ? "No eligible contests are open right now. Check back when upcoming match contests become available."
              : "New contests will appear here when upcoming matches are available. Refresh after a match is added."}
          </p>
        </div>
      ) : (
        <div className="cc-contest-match-groups">
          {[...groupedContests].map(([matchId, group]) => (
            <details className="cc-contest-match-group cc-contest-lobby-match-group" key={matchId} open>
              <summary>
                <span>
                  <strong>{group.match ? `${group.match.teamA} vs ${group.match.teamB}` : "Match details unavailable"}</strong>
                  <small>{group.match?.format || "Cricket"} · {group.match?.status || "Status unavailable"} · {group.contests.length} contest(s)</small>
                </span>
                <span className="cc-contest-group-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div className="cc-contest-grid">
          {group.contests.map((contest) => {
            const match =
              contest.match && typeof contest.match === "object"
                ? contest.match
                : null;

            const tier = TIERS[contest.tier] || {
              label: contest.tier || "Contest",
              color: "default",
            };

            const players = Array.isArray(contest.players)
              ? contest.players
              : [];
            const canJoin = contest.status === "OPEN" && players.length === 0;

            return (
              <article className="cc-contest-card" key={contest._id}>
                <div className="cc-contest-card-top">
                  <span className={`cc-contest-tier ${tier.color}`}>
                    {tier.label}
                  </span>
                  <span className="cc-contest-status open">Available</span>
                </div>

                <div className="cc-contest-match cc-contest-lobby-card-match">
                  <h2>{match ? `${match.teamA} vs ${match.teamB}` : "Match details unavailable"}</h2>
                  {match?.startTime && (
                    <p>Starts {formatIndiaDateTime(match.startTime, { dateStyle: "medium", timeStyle: "short" })}</p>
                  )}
                </div>

                <div className="cc-contest-prizes cc-contest-lobby-prizes">
                  <div>
                    <span>Entry fee</span>
                    <strong>{formatCoins(contest.entryFee)}</strong>
                  </div>
                  <div>
                    <span>Prize pool</span>
                    <strong>{formatCoins(contest.prizePool)}</strong>
                  </div>
                </div>

                {canJoin ? (
                  <div className="cc-contest-join">
                    <label htmlFor={`team-${contest._id}`}>
                      Pick your team
                    </label>
                    <select
                      id={`team-${contest._id}`}
                      value={selectedTeams[contest._id] || ""}
                      disabled={Boolean(joiningId)}
                      onChange={(event) =>
                        setSelectedTeams((previous) => ({
                          ...previous,
                          [contest._id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Choose a team</option>
                      <option value="A">{match?.teamA || "Team A"}</option>
                      <option value="B">{match?.teamB || "Team B"}</option>
                    </select>
                    <small className="cc-contest-team-hint">We’ll automatically match you with someone choosing the opposite team.</small>

                    <button
                      type="button"
                      className="cc-button cc-button-maroon"
                      disabled={Boolean(joiningId)}
                      onClick={() => handleJoin(contest)}
                    >
                      {joiningId === contest._id
                        ? "Joining..."
                        : "Join Contest"}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
              </div>
            </details>
          ))}
        </div>
      )}

      <section className="cc-contest-tools">
        <Link
          className="cc-contest-tool-card"
          to={`/dashboard/contests/activity${matchFilter ? `?matchId=${encodeURIComponent(matchFilter)}` : ""}`}
        >
          <span className="cc-feature-eyebrow">YOUR CONTEST ACTIVITY</span>
          <strong>Open full contest activity</strong>
          <span>Review your entries, opponents, selected teams, results, and settlement details.</span>
        </Link>
        <Link className="cc-contest-tool-card" to="/dashboard/contests/leaderboard">
          <span className="cc-feature-eyebrow">VERIFIED RESULTS</span>
          <strong>Open full leaderboard</strong>
          <span>Browse rankings and player statistics from completed, settled contests.</span>
        </Link>
      </section>
    </section>
  );
}
