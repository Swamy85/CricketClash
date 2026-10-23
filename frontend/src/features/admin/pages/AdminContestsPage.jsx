
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import {
  adminFetch,
  getAdminSession,
  clearAdminSession,
} from "../services/adminSession";
import "../styles/AdminContestsPage.css";

const CONTEST_TIERS = [
  { value: "FREE", label: "Free", entryFee: 0, prizePool: 0 },
  { value: "BRONZE", label: "Bronze", entryFee: 50, prizePool: 100 },
  { value: "SILVER", label: "Silver", entryFee: 100, prizePool: 200 },
  { value: "GOLD", label: "Gold", entryFee: 250, prizePool: 500 },
  { value: "PLATINUM", label: "Platinum", entryFee: 500, prizePool: 1000 },
  { value: "DIAMOND", label: "Diamond", entryFee: 1000, prizePool: 2000 },
  { value: "ELITE", label: "Elite", entryFee: 2500, prizePool: 5000 },
  { value: "CHAMPION", label: "Champion", entryFee: 5000, prizePool: 10000 },
];

const STATUS_OPTIONS = [
  "ALL",
  "OPEN",
  "WAITING",
  "FULL",
  "LOCKED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
];

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : formatIndiaDateTime(date);
}

function formatCoins(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function getMatchName(match) {
  if (!match) return "Match unavailable";

  return `${match.teamA || "Team A"} vs ${match.teamB || "Team B"}`;
}

function getStatusClass(status) {
  return String(status || "UNKNOWN").toLowerCase();
}

function getPlayerCount(contest) {
  return Array.isArray(contest.players) ? contest.players.length : 0;
}

export default function AdminContestsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [contests, setContests] = useState([]);
  const [matches, setMatches] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState("");
  const [selectedTier, setSelectedTier] = useState("BRONZE");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [ledgerContest, setLedgerContest] = useState(null);
  const [ledger, setLedger] = useState({ walletEntries: [], platformEntries: [] });
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const dataRequestRef = useRef(null);

  const selectedTierDetails = CONTEST_TIERS.find(
    (tier) => tier.value === selectedTier
  );

  const loadData = useCallback(async ({ silent = false, initial = false } = {}) => {
    if (!getAdminSession()) {
      if (!silent) navigate("/admin/login", { replace: true });
      return;
    }

    if (dataRequestRef.current) return;
    const controller = new AbortController();
    dataRequestRef.current = controller;
    if (initial) setLoading(true);
    if (!silent && !initial) {
      setRefreshing(true);
      setError("");
      setMessage("");
    }


    try {
      const [contestResponse, matchResponse] = await Promise.all([
        adminFetch("/api/admin/contests", { signal: controller.signal }),
        adminFetch("/api/admin/matches", { signal: controller.signal }),
      ]);

      if (
        contestResponse.status === 401 ||
        contestResponse.status === 403 ||
        matchResponse.status === 401 ||
        matchResponse.status === 403
      ) {
        clearAdminSession();
        navigate("/admin/login", { replace: true });
        return;
      }

      const [contestData, matchData] = await Promise.all([
        contestResponse.json(),
        matchResponse.json(),
      ]);

      if (!contestResponse.ok || !contestData.success) {
        throw new Error(
          contestData.message || "Unable to load contests."
        );
      }

      if (!matchResponse.ok || !matchData.success) {
        throw new Error(
          matchData.message || "Unable to load matches."
        );
      }

      const contestList = Array.isArray(contestData.contests)
        ? contestData.contests
        : [];

      const matchList = Array.isArray(matchData.matches)
        ? matchData.matches
        : [];

      setContests(contestList);
      setMatches(matchList);
      setError("");
      if (!silent && !initial) setMessage("Contest data updated.");

      // Prefer an upcoming match whose start time is still in the future.
      const now = Date.now();
      const eligibleMatches = matchList.filter(
        (match) =>
          match.status === "upcoming" &&
          Number.isFinite(new Date(match.startTime).getTime()) &&
          new Date(match.startTime).getTime() > now
      );

      setSelectedMatch((previous) => {
        const requestedMatchId = location.state?.matchId;
        if (requestedMatchId && eligibleMatches.some((match) => match._id === requestedMatchId)) {
          return requestedMatchId;
        }
        return previous || eligibleMatches[0]?._id || "";
      });
    } catch (err) {
      if (!silent && err.name !== "AbortError") {
        setError(err.message || "Unable to load contest management data.");
      }
    } finally {
      if (dataRequestRef.current === controller) {
        dataRequestRef.current = null;
        if (initial) setLoading(false);
        if (!silent && !initial) setRefreshing(false);
      }
    }
  }, [location.state?.matchId, navigate]);

  useEffect(() => {
    void loadData({ initial: true });
    const timer = window.setInterval(
      () => void loadData({ silent: true }),
      15_000
    );
    return () => {
      window.clearInterval(timer);
      const request = dataRequestRef.current;
      dataRequestRef.current = null;
      request?.abort();
    };
  }, [loadData]);

  const eligibleMatches = useMemo(() => {
    const now = Date.now();

    return matches.filter(
      (match) =>
        match.status === "upcoming" &&
        Number.isFinite(new Date(match.startTime).getTime()) &&
        new Date(match.startTime).getTime() > now
    );
  }, [matches]);

  const filteredContests = useMemo(() => {
    const query = search.trim().toLowerCase();

    return contests.filter((contest) => {
      const matchesStatus =
        statusFilter === "ALL" || contest.status === statusFilter;

      const searchableText = [
        contest._id,
        contest.tier,
        contest.status,
        getMatchName(contest.match),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesStatus && searchableText.includes(query);
    });
  }, [contests, search, statusFilter]);

  const contestsByMatch = useMemo(() => {
    const grouped = new Map();
    for (const contest of filteredContests) {
      const matchId = String(contest.match?._id || contest.match || "unknown");
      if (!grouped.has(matchId)) {
        grouped.set(matchId, {
          id: matchId,
          match: contest.match && typeof contest.match === "object"
            ? contest.match
            : null,
          contests: [],
        });
      }
      grouped.get(matchId).contests.push(contest);
    }
    return [...grouped.values()].sort((left, right) => {
      const leftStart = new Date(left.match?.startTime || 0).getTime();
      const rightStart = new Date(right.match?.startTime || 0).getTime();
      return rightStart - leftStart;
    });
  }, [filteredContests]);

  const metrics = useMemo(() => ({
    total: contests.length,
    open: contests.filter(
      (contest) => ["OPEN", "WAITING"].includes(contest.status)
    ).length,
    full: contests.filter((contest) => contest.status === "FULL").length,
    completed: contests.filter(
      (contest) => contest.status === "COMPLETED"
    ).length,
  }), [contests]);

  async function loadContestLedger(contest) {
    setLedgerContest(contest);
    setLedgerLoading(true);
    setError("");

    try {
      const response = await adminFetch(
        `/api/admin/contests/${contest._id}/ledger`
      );

      if (response.status === 401 || response.status === 403) {
        clearAdminSession();
        navigate("/admin/login", { replace: true });
        return;
      }

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load the contest ledger.");
      }

      setLedger({
        walletEntries: Array.isArray(data.walletEntries) ? data.walletEntries : [],
        platformEntries: Array.isArray(data.platformEntries) ? data.platformEntries : [],
      });
    } catch (err) {
      setError(err.message || "Unable to load the contest ledger.");
      setLedgerContest(null);
    } finally {
      setLedgerLoading(false);
    }
  }

  async function handleCreateContest(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!eligibleMatches.some((match) => match._id === selectedMatch)) {
      setError("Select an eligible upcoming match first.");
      return;
    }
    setCreating(true);

    try {
      const response = await adminFetch("/api/admin/contests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matchId: selectedMatch,
          tier: selectedTier,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminSession();
        navigate("/admin/login", { replace: true });
        return;
      }

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to create contest.");
      }

      setMessage(data.message || "Contest created successfully.");
      await loadData({ silent: true });
    } catch (err) {
      setError(err.message || "Unable to create contest.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="admin-contests-page">
      <header className="ac-page-header">
        <div>
          <p className="ac-eyebrow">CRICKETCLASH ADMIN</p>
          <h1>Contest Management</h1>
          <p className="ac-subtitle">
            Create head-to-head contests and monitor their status.
          </p>
        </div>

        <button
          type="button"
          className="ac-button ac-button-secondary"
          onClick={() => loadData()}
          disabled={refreshing || loading}
        >
          {refreshing ? "Refreshing..." : "↻ Refresh"}
        </button>
      </header>

      {error && (
        <div className="ac-alert ac-alert-error" role="alert">
          {error}
        </div>
      )}

      {message && (
        <div className="ac-alert ac-alert-success" role="status">
          {message}
        </div>
      )}

      <div className="ac-metrics">
        <article className="ac-metric">
          <span>Total contests</span>
          <strong>{metrics.total}</strong>
        </article>
        <article className="ac-metric">
          <span>Open / waiting</span>
          <strong>{metrics.open}</strong>
        </article>
        <article className="ac-metric">
          <span>Full contests</span>
          <strong>{metrics.full}</strong>
        </article>
        <article className="ac-metric">
          <span>Completed</span>
          <strong>{metrics.completed}</strong>
        </article>
      </div>

      <section className="ac-panel">
        <div className="ac-section-heading">
          <div>
            <h2>Create a contest</h2>
            <p>Choose an upcoming match and a predefined prize tier.</p>
          </div>
        </div>

        <form className="ac-create-form" onSubmit={handleCreateContest}>
          <label className="ac-field">
            <span>Match</span>
            <select
              value={selectedMatch}
              onChange={(event) => setSelectedMatch(event.target.value)}
              required
              disabled={creating || eligibleMatches.length === 0}
            >
              <option value="">Select an upcoming match</option>
              {selectedMatch &&
                !eligibleMatches.some((match) => match._id === selectedMatch) && (
                  <option value={selectedMatch}>
                    {getMatchName(matches.find((match) => match._id === selectedMatch))} — no longer eligible
                  </option>
                )}
              {eligibleMatches.map((match) => (
                <option key={match._id} value={match._id}>
                  {getMatchName(match)} — {formatDate(match.startTime)}
                </option>
              ))}
            </select>
          </label>

          <label className="ac-field">
            <span>Contest tier</span>
            <select
              value={selectedTier}
              onChange={(event) => setSelectedTier(event.target.value)}
              disabled={creating}
            >
              {CONTEST_TIERS.map((tier) => (
                <option key={tier.value} value={tier.value}>
                  {tier.label} — Entry {formatCoins(tier.entryFee)}
                </option>
              ))}
            </select>
          </label>

          <div className="ac-prize-preview">
            <div>
              <span>Entry per player</span>
              <strong>{formatCoins(selectedTierDetails?.entryFee)}</strong>
            </div>
            <div>
              <span>Prize pool</span>
              <strong>{formatCoins(selectedTierDetails?.prizePool)}</strong>
            </div>
            <div>
              <span>Platform fee (10%)</span>
              <strong>
                {formatCoins(Math.round((selectedTierDetails?.prizePool || 0) * 0.1))}
              </strong>
            </div>
            <div>
              <span>Winner payout</span>
              <strong>
                {formatCoins(
                  (selectedTierDetails?.prizePool || 0) * 0.9
                )}
              </strong>
            </div>
          </div>

          {eligibleMatches.length === 0 && (
            <p className="ac-empty-note">
              No eligible upcoming matches found. Create or update a match
              with status Upcoming and a future start time first.
            </p>
          )}

          <button
            type="submit"
            className="ac-button ac-button-primary"
            disabled={creating || !eligibleMatches.some((match) => match._id === selectedMatch)}
          >
            {creating ? "Creating..." : "+ Create contest"}
          </button>
        </form>
      </section>

      <section className="ac-panel">
        <div className="ac-section-heading ac-list-heading">
          <div>
            <h2>All contests</h2>
            <p>{filteredContests.length} contest(s) shown</p>
          </div>

          <div className="ac-filters">
            <input
              type="search"
              placeholder="Search match, tier, or ID..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search contests"
            />

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter contests by status"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status === "ALL" ? "All statuses" : status}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="ac-empty-state">Loading contests...</div>
        ) : contestsByMatch.length === 0 ? (
          <div className="ac-empty-state">
            <span className="ac-empty-icon">🏏</span>
            <h3>No contests found</h3>
            <p>Create a contest above or change your search filters.</p>
          </div>
        ) : (
          <div className="ac-match-groups">
            {contestsByMatch.map(({ id, match, contests: matchContests }) => (
              <details className="ac-match-group" key={id}>
                <summary className="ac-match-group-summary">
                  <span className="ac-match-group-chevron" aria-hidden="true">›</span>
                  <span className="ac-match-group-title">
                    <strong>{getMatchName(match)}</strong>
                    <small>
                      {match?.competition ? `${match.competition} · ` : ""}
                      {match?.format || "Match"} · {formatDate(match?.startTime)}
                    </small>
                  </span>
                  <span className={`ac-status ac-status-${getStatusClass(match?.status)}`}>
                    {match?.status || "UNKNOWN"}
                  </span>
                  <span className="ac-match-group-count">
                    {matchContests.length} contest{matchContests.length === 1 ? "" : "s"}
                  </span>
                </summary>

                <div className="ac-match-contests">
                  {matchContests.map((contest) => {
                    const players = Array.isArray(contest.players) ? contest.players : [];
                    return (
                      <article className="ac-match-contest" key={contest._id}>
                        <div className="ac-match-contest-heading">
                          <span className={`ac-tier ac-tier-${String(contest.tier || "").toLowerCase()}`}>
                            {contest.tier}
                          </span>
                          <span className={`ac-status ac-status-${getStatusClass(contest.status)}`}>
                            {contest.status}
                          </span>
                          <small className="ac-id">ID: {contest._id}</small>
                        </div>

                        <div className="ac-match-contest-stats">
                          <div><span>Entry fee</span><strong>{formatCoins(contest.entryFee)}</strong></div>
                          <div><span>Prize pool</span><strong>{formatCoins(contest.prizePool)}</strong></div>
                          <div><span>Players / slots</span><strong>{getPlayerCount(contest)}/2 · {Math.max(0, 2 - getPlayerCount(contest))} available</strong></div>
                          <div><span>Platform fee</span><strong>{formatCoins(contest.platformFee)}</strong></div>
                          <div><span>Winner payout</span><strong>{formatCoins(contest.winnerPayout)}</strong></div>
                          <div><span>Settlement</span><strong>{contest.settlementStatus}</strong></div>
                        </div>

                        <div className="ac-match-contest-players">
                          {[0, 1].map((slot) => {
                            const player = players[slot];
                            const teamName = player?.selectedTeam === "A"
                              ? match?.teamA
                              : player?.selectedTeam === "B"
                                ? match?.teamB
                                : "";
                            return (
                              <span key={slot} className={player ? "filled" : ""}>
                                {player?.user?.userId ? `Player ID: ${player.user.userId}` : player ? "Player ID unavailable" : `Slot ${slot + 1} available`}
                                {teamName ? ` · ${teamName} · LOCKED` : ""}
                              </span>
                            );
                          })}
                        </div>

                        <div className="ac-match-contest-footer">
                          <small>Starts {formatDate(match?.startTime || contest.expiresAt)}</small>
                          <button
                            type="button"
                            className="ac-ledger-button"
                            onClick={() => loadContestLedger(contest)}
                          >
                            View ledger
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {ledgerContest && (
        <section className="ac-panel ac-ledger-panel">
          <div className="ac-section-heading">
            <div>
              <h2>Contest transaction audit</h2>
              <p>
                {getMatchName(ledgerContest.match)} · {ledgerContest.tier} ·
                {" "}{ledgerContest._id}
              </p>
            </div>
            <button
              type="button"
              className="ac-button ac-button-secondary"
              onClick={() => setLedgerContest(null)}
            >
              Close
            </button>
          </div>

          {ledgerLoading ? (
            <div className="ac-empty-state">Loading transaction ledger...</div>
          ) : (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ledger</th>
                    <th>Player / admin</th>
                    <th>Direction</th>
                    <th>Amount</th>
                    <th>Status / reference</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...ledger.walletEntries.map((entry) => ({
                      ...entry,
                      ledger: "Wallet",
                      actor: entry.user?.userId || "Player ID unavailable",
                      date: entry.createdAt,
                    })),
                    ...ledger.platformEntries.map((entry) => ({
                      ...entry,
                      ledger: "Platform",
                      actor: entry.initiatedBy?.username || "System",
                      date: entry.createdAt,
                      status: "COMPLETED",
                    })),
                  ]
                    .sort((a, b) => new Date(a.date) - new Date(b.date))
                    .map((entry) => (
                      <tr key={`${entry.ledger}:${entry._id}`}>
                        <td>{formatDate(entry.date)}</td>
                        <td>{entry.type}</td>
                        <td>{entry.actor}</td>
                        <td>{entry.direction}</td>
                        <td>{formatCoins(entry.amount)}</td>
                        <td>
                          {entry.status}
                          <small className="ac-ledger-reference">
                            {entry.reference}
                          </small>
                          {entry.description && (
                            <small className="ac-ledger-reference">
                              {entry.description}
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  {ledger.walletEntries.length + ledger.platformEntries.length === 0 && (
                    <tr>
                      <td colSpan="6">No transactions recorded for this contest.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
