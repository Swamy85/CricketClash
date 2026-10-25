
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
  if (!match?.teamA || !match?.teamB) return "Match unavailable";
  return `${match.teamA} vs ${match.teamB}`;
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
  const [contestName, setContestName] = useState("");
  const [editingContest, setEditingContest] = useState("");
  const [matchFilter, setMatchFilter] = useState("ALL");
  const [contestCounts, setContestCounts] = useState({ total: 0, open: 0, full: 0, live: 0, completed: 0 });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [entryFeeFilter, setEntryFeeFilter] = useState("ALL");
  const [matchViewFilter, setMatchViewFilter] = useState("ALL");
  const [teamByName, setTeamByName] = useState({});
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewContest, setViewContest] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [contestPage, setContestPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [ledgerContest, setLedgerContest] = useState(null);
  const [ledger, setLedger] = useState({ walletEntries: [], platformEntries: [] });
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const dataRequestRef = useRef(null);
  const matchRailRef = useRef(null);
  const requestedMatchAppliedRef = useRef(false);

  const selectedTierDetails = CONTEST_TIERS.find(
    (tier) => tier.value === selectedTier
  );

  const loadData = useCallback(async ({ silent = false, initial = false } = {}) => {
    if (!getAdminSession()) {
      if (!silent) navigate("/admin/login", { replace: true });
      return;
    }

    if (dataRequestRef.current) dataRequestRef.current.abort();
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
        adminFetch(`/api/admin/contests?page=${contestPage}&limit=10&matchId=${encodeURIComponent(matchFilter)}&status=${encodeURIComponent(statusFilter)}&search=${encodeURIComponent(debouncedSearch.trim())}&entryFee=${encodeURIComponent(entryFeeFilter)}`, { signal: controller.signal }),
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
      setPagination(contestData.pagination || { page: contestPage, limit: 10, total: contestList.length, totalPages: contestList.length ? 1 : 0 });
      const lastPage = Math.max(1, contestData.pagination?.totalPages || 0);
      if (contestPage > lastPage) {
        setContestPage(lastPage);
      }
      setMatches(matchList);
      if (contestData.counts) setContestCounts(contestData.counts);
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
      const requestedMatchId = location.state?.matchId;
      if (!requestedMatchAppliedRef.current && requestedMatchId && matchList.some((match) => match._id === requestedMatchId)) {
        setMatchFilter(requestedMatchId);
        requestedMatchAppliedRef.current = true;
      }

      setSelectedMatch((previous) => {
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
  }, [location.state?.matchId, navigate, contestPage, matchFilter, statusFilter, entryFeeFilter, debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setContestPage(1);
      setDebouncedSearch(search);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

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

  useEffect(() => {
    const controller = new AbortController();
    adminFetch("/api/admin/teams?limit=1000", { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (data.success && Array.isArray(data.teams)) {
          setTeamByName(Object.fromEntries(data.teams.map((team) => [team.name, team])));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const eligibleMatches = useMemo(() => {
    const now = Date.now();

    return matches.filter(
      (match) =>
        match.status === "upcoming" &&
        Number.isFinite(new Date(match.startTime).getTime()) &&
        new Date(match.startTime).getTime() > now
    );
  }, [matches]);

  const filteredContests = contests;

  const visibleMatches = useMemo(() => matches.filter((match) => {
    if (matchViewFilter === "ALL") return true;
    if (matchViewFilter === "COMPLETED") return ["completed", "cancelled", "abandoned"].includes(match.status);
    return match.status === matchViewFilter.toLowerCase();
  }), [matches, matchViewFilter]);

  function chooseMatch(matchId) {
    setContestPage(1);
    setMatchFilter(matchId);
  }

  function resetContestFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter("ALL");
    setEntryFeeFilter("ALL");
    setMatchViewFilter("ALL");
    chooseMatch("ALL");
  }

  function scrollMatchCards(direction) {
    matchRailRef.current?.scrollBy({ left: direction * 360, behavior: "smooth" });
  }

  const metrics = contestCounts;

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

  async function handleSaveContest(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!eligibleMatches.some((match) => match._id === selectedMatch)) {
      setError("Select an eligible upcoming match first.");
      return;
    }
    if (!contestName.trim()) {
      setError("Enter a contest name.");
      return;
    }
    setCreating(true);

    try {
      const response = await adminFetch(editingContest ? `/api/admin/contests/${editingContest}` : "/api/admin/contests", {
        method: editingContest ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          matchId: selectedMatch,
          tier: selectedTier,
          name: contestName.trim(),
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

      setMessage(data.message || (editingContest ? "Contest updated successfully." : "Contest created successfully."));
      setEditingContest("");
      setCreateModalOpen(false);
      setContestName("");
      await loadData({ silent: true });
    } catch (err) {
      setError(err.message || "Unable to create contest.");
    } finally {
      setCreating(false);
    }
  }

  function beginEdit(contest) {
    if (contest.status !== "OPEN" || getPlayerCount(contest) > 0 || contest.settlementStatus !== "NOT_READY") return;
    setEditingContest(contest._id);
    setCreateModalOpen(true);
    setContestName(contest.name || `${contest.tier} Head-to-Head`);
    setSelectedMatch(String(contest.match?._id || contest.match || ""));
    setSelectedTier(contest.tier);
    setError("");
    setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingContest("");
    setCreateModalOpen(false);
    setContestName("");
    setSelectedMatch(eligibleMatches[0]?._id || "");
    setSelectedTier("BRONZE");
  }

  async function handleDeleteContest(contest) {
    if (contest.status !== "OPEN" || getPlayerCount(contest) > 0 || contest.settlementStatus !== "NOT_READY") return;
    if (!window.confirm(`Delete “${contest.name || contest.tier}”? This empty contest will be permanently removed.`)) return;
    setError("");
    setMessage("");
    try {
      const response = await adminFetch(`/api/admin/contests/${contest._id}`, { method: "DELETE" });
      if ([401, 403].includes(response.status)) {
        clearAdminSession();
        navigate("/admin/login", { replace: true });
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to delete contest.");
      setMessage(data.message || "Contest deleted.");
      await loadData({ silent: true });
    } catch (err) {
      setError(err.message || "Unable to delete contest.");
    }
  }

  async function handleCancelContest(contest) {
    if (!window.confirm(`Cancel this contest? ${getPlayerCount(contest) ? "Eligible player entry fees will be refunded." : "No players have joined."}`)) return;
    setError("");
    setMessage("");
    try {
      const response = await adminFetch(`/api/admin/contests/${contest._id}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "ADMIN_CANCELLED" }),
      });
      if ([401, 403].includes(response.status)) {
        clearAdminSession();
        navigate("/admin/login", { replace: true });
        return;
      }
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to cancel contest.");
      setMessage(data.message || "Contest cancelled.");
      await loadData({ silent: true });
    } catch (err) {
      setError(err.message || "Unable to cancel contest.");
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
        <button type="button" className="ac-button ac-button-primary" onClick={() => { setEditingContest(""); setContestName(""); setCreateModalOpen(true); }}>+ Create Contest</button>
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
          <span>Open contests</span>
          <strong>{metrics.open}</strong>
        </article>
        <article className="ac-metric">
          <span>Full contests</span>
          <strong>{metrics.full}</strong>
        </article>
        <article className="ac-metric">
          <span>Live contests</span>
          <strong>{metrics.live}</strong>
        </article>
        <article className="ac-metric">
          <span>Completed</span>
          <strong>{metrics.completed}</strong>
        </article>
      </div>

      {createModalOpen && <div className="ac-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !creating && setCreateModalOpen(false)}><section id="contest-create-panel" className="ac-panel ac-create-modal" role="dialog" aria-modal="true" aria-labelledby="contest-form-title">
        <div className="ac-section-heading">
          <div>
            <h2 id="contest-form-title">{editingContest ? "Edit contest" : "Create a contest"}</h2>
            <p>Two-player head-to-head contests use the existing tier and 10% fee rules.</p>
          </div>
        </div>

        <form className="ac-create-form" onSubmit={handleSaveContest}>
          <label className="ac-field">
            <span>Contest name</span>
            <input
              value={contestName}
              onChange={(event) => setContestName(event.target.value)}
              maxLength={80}
              placeholder="Bronze Head-to-Head"
              required
              disabled={creating}
            />
          </label>

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

          <div className="ac-form-fixed-fields">
            <label className="ac-field">
              <span>Contest capacity</span>
              <input value="2 participants · Head-to-head" readOnly aria-label="Contest capacity is fixed at two participants" />
            </label>
            <label className="ac-field">
              <span>Initial status</span>
              <input value="Open" readOnly aria-label="New contests start Open" />
            </label>
          </div>

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
            {creating ? "Saving..." : editingContest ? "Save changes" : "+ Create contest"}
          </button>
          <button type="button" className="ac-button ac-button-secondary" onClick={() => { setCreateModalOpen(false); setEditingContest(""); }} disabled={creating}>Close</button>
          {editingContest && (
            <button type="button" className="ac-button ac-button-secondary" onClick={cancelEdit} disabled={creating}>
              Cancel edit
            </button>
          )}
        </form>
      </section></div>}

      <section className="ac-panel ac-match-panel">
        <div className="ac-match-panel-heading">
          <div><h2>Select match</h2><p>{matchFilter === "ALL" ? "Showing contests from every match" : `Showing contests for ${getMatchName(matches.find((item) => item._id === matchFilter))}`}</p></div>
          <div className="ac-match-tools">
            <div className="ac-match-view-filters" role="group" aria-label="Filter matches by status">
              {["ALL", "UPCOMING", "LIVE", "COMPLETED"].map((filter) => <button type="button" key={filter} className={matchViewFilter === filter ? "is-active" : ""} aria-pressed={matchViewFilter === filter} onClick={() => { setMatchViewFilter(filter); const candidates = matches.filter((match) => filter === "ALL" || (filter === "COMPLETED" ? ["completed", "cancelled", "abandoned"].includes(match.status) : match.status === filter.toLowerCase())); if (!candidates.some((match) => match._id === matchFilter)) chooseMatch(candidates[0]?._id || "ALL"); }}>{filter === "ALL" ? "All" : filter.charAt(0) + filter.slice(1).toLowerCase()}</button>)}
            </div>
            <button type="button" className="ac-match-arrow" onClick={() => scrollMatchCards(-1)} aria-label="Scroll matches left">‹</button>
            <button type="button" className="ac-match-arrow" onClick={() => scrollMatchCards(1)} aria-label="Scroll matches right">›</button>
          </div>
        </div>
        <div className="ac-match-rail" ref={matchRailRef}>
          <button type="button" className={`ac-match-card ac-all-match-card${matchFilter === "ALL" ? " is-selected" : ""}`} onClick={() => chooseMatch("ALL")} aria-pressed={matchFilter === "ALL"}><strong>All matches</strong><span>View all contests</span></button>
          {visibleMatches.map((match) => {
            const home = teamByName[match.teamA];
            const away = teamByName[match.teamB];
            const mark = (team) => team?.logo ? <img src={team.logo} alt="" loading="lazy" /> : <span>{team?.flag || "🏏"}</span>;
            return <button type="button" key={match._id} className={`ac-match-card${matchFilter === match._id ? " is-selected" : ""}`} onClick={() => chooseMatch(match._id)} aria-pressed={matchFilter === match._id}>
              <div className="ac-match-card-teams"><span className="ac-team-mark">{mark(home)}</span><strong>{match.teamA}</strong><span className="ac-match-vs">vs</span><span className="ac-team-mark">{mark(away)}</span><strong>{match.teamB}</strong></div>
              <span className="ac-match-competition">{match.competition || match.title || "Cricket match"}</span>
              <span className="ac-match-date">{formatDate(match.startTime)}</span>
              <span className={`ac-match-status ac-match-status-${String(match.status).toLowerCase()}`}>{match.status}</span>
            </button>;
          })}
          {!visibleMatches.length && <div className="ac-match-empty">No matches in this category.</div>}
        </div>
      </section>

      <section className="ac-panel">
        <div className="ac-section-heading ac-list-heading">
          <div>
            <h2>{matchFilter === "ALL" ? "All contests" : `Contests for ${getMatchName(matches.find((item) => item._id === matchFilter))}`}</h2>
            <p>{pagination.total} contest(s) matching filters · 10 per page</p>
          </div>

          <div className="ac-filters">
            <input
              type="search"
              placeholder="Search contest name or ID..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search contests"
            />

            <select
              value={statusFilter}
              onChange={(event) => { setContestPage(1); setStatusFilter(event.target.value); }}
              aria-label="Filter contests by status"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status === "ALL" ? "All statuses" : status === "LOCKED" ? "LIVE" : status === "WAITING" ? "FILLING" : status}
                </option>
              ))}
            </select>
            <select value={entryFeeFilter} onChange={(event) => { setContestPage(1); setEntryFeeFilter(event.target.value); }} aria-label="Filter by entry fee">
              <option value="ALL">All entry fees</option>
              {CONTEST_TIERS.map((tier) => <option key={tier.value} value={tier.entryFee}>{formatCoins(tier.entryFee)}</option>)}
            </select>
            <button type="button" className="ac-button ac-button-secondary ac-reset-button" onClick={resetContestFilters}>Reset</button>
          </div>
        </div>

        {loading ? (
          <div className="ac-empty-state">Loading contests...</div>
        ) : filteredContests.length === 0 ? (
          <div className="ac-empty-state">
            <span className="ac-empty-icon">🏏</span>
            <h3>No contests found</h3>
            <p>{pagination.total ? "Try changing your search or filters." : "Create a contest above to start accepting entries."}</p>
          </div>
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table ac-contest-table">
              <thead><tr><th>#</th><th>Contest ID</th><th>Contest</th><th>Match / teams</th><th>Entry fee</th><th>Prize pool</th><th>Joined / 2</th><th>Status</th><th>Created at (IST)</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredContests.map((contest, index) => {
                  const match = typeof contest.match === "object" ? contest.match : matches.find((item) => item._id === String(contest.match));
                  const players = getPlayerCount(contest);
                  const platformFeeAmount = Number.isFinite(contest.platformFee)
                    ? contest.platformFee
                    : Math.round((contest.prizePool || 0) * (contest.platformFeePercentage ?? 10) / 100);
                  const canEditOrDelete = contest.status === "OPEN" && players === 0 && contest.settlementStatus === "NOT_READY";
                  const canCancel = ["OPEN", "WAITING", "FULL", "LOCKED"].includes(contest.status);
                  const displayStatus = contest.status === "LOCKED" ? "LIVE" : contest.status === "WAITING" ? "FILLING" : contest.status;
                  return (
                    <tr key={contest._id}>
                      <td>{((contestPage - 1) * 10) + index + 1}</td>
                      <td>{String(contest._id).slice(-8).toUpperCase()}</td>
                      <td><strong>{contest.name || `${contest.tier} Head-to-Head`}</strong><small>{contest.tier} · ID: {String(contest._id).slice(-8)}</small><small>{contest.creationMethod === "AUTOMATIC" ? "Automatic" : contest.creationMethod === "MANUAL" ? "Manual" : "Legacy source unknown"}</small></td>
                      <td><strong>{getMatchName(match)}</strong><small>{match?.competition || "Cricket match"} · {formatDate(match?.startTime || contest.expiresAt)}</small></td>
                      <td>{formatCoins(contest.entryFee)}<small>per player</small></td>
                      <td>{formatCoins(contest.prizePool)}<small>{formatCoins(platformFeeAmount)} platform fee ({contest.platformFeePercentage ?? 10}%)</small></td>
                      <td><strong>{players}/2</strong><small>{Math.max(0, 2 - players)} slot{2 - players === 1 ? "" : "s"} left</small>{contest.players?.length > 0 && <small>{contest.players.map((player) => `${player.user?.username || player.user?.userId || "Player"} · ${player.selectedTeam === "A" ? (match?.teamA || "selected side") : (match?.teamB || "selected side")}`).join(" | ")}</small>}</td>
                      <td><span className={`ac-status ac-status-${getStatusClass(displayStatus)}`}>{displayStatus}</span></td>
                      <td>{formatDate(contest.createdAt)}</td>
                      <td>
                        <div className="ac-row-actions">
                          <button type="button" className="ac-action-button" onClick={() => setViewContest(contest)}>View</button>
                          <button type="button" className="ac-action-button" onClick={() => beginEdit(contest)} disabled={!canEditOrDelete} title={canEditOrDelete ? "Edit contest" : "Joined or financially active contests cannot be edited"}>Edit</button>
                          <button type="button" className="ac-ledger-button" onClick={() => loadContestLedger(contest)}>Ledger</button>
                          <button type="button" className="ac-action-button ac-action-danger" onClick={() => handleDeleteContest(contest)} disabled={!canEditOrDelete} title={canEditOrDelete ? "Delete contest" : "Contests with participants or financial activity cannot be deleted"}>Delete</button>
                          {!canEditOrDelete && canCancel && <button type="button" className="ac-action-button ac-action-danger" onClick={() => handleCancelContest(contest)}>Cancel</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && pagination.totalPages > 0 && <nav className="ac-pagination" aria-label="Contest pages">
          <button type="button" disabled={contestPage <= 1} onClick={() => setContestPage((page) => Math.max(1, page - 1))}>Previous</button>
          {Array.from({ length: pagination.totalPages }, (_, index) => index + 1).map((page) => <button type="button" key={page} className={contestPage === page ? "is-current" : ""} aria-current={contestPage === page ? "page" : undefined} onClick={() => setContestPage(page)}>{page}</button>)}
          <button type="button" disabled={contestPage >= pagination.totalPages} onClick={() => setContestPage((page) => Math.min(pagination.totalPages, page + 1))}>Next</button>
        </nav>}
      </section>

      {viewContest && <div className="ac-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setViewContest(null)}>
        <section className="ac-panel ac-view-modal" role="dialog" aria-modal="true" aria-labelledby="contest-view-title">
          <div className="ac-section-heading"><div><p className="ac-eyebrow">CONTEST DETAILS</p><h2 id="contest-view-title">{viewContest.name || `${viewContest.tier} Head-to-Head`}</h2></div><button type="button" className="ac-button ac-button-secondary" onClick={() => setViewContest(null)}>Close</button></div>
          <p className="ac-view-match">{getMatchName(viewContest.match)} · {viewContest.match?.competition || "Cricket match"}</p>
          <div className="ac-view-grid"><div><span>Entry fee</span><strong>{formatCoins(viewContest.entryFee)} / player</strong></div><div><span>Prize pool</span><strong>{formatCoins(viewContest.prizePool)}</strong></div><div><span>Participants</span><strong>{getPlayerCount(viewContest)} / 2</strong></div><div><span>Status</span><strong>{viewContest.status}</strong></div><div><span>Created (IST)</span><strong>{formatDate(viewContest.createdAt)}</strong></div><div><span>Settlement</span><strong>{viewContest.settlementStatus || "Not ready"}</strong></div></div>
          <h3 className="ac-view-participants-heading">Participants</h3>
          {viewContest.players?.length ? <ul className="ac-view-participants">{viewContest.players.map((player, index) => { const match = viewContest.match; const teamName = player.selectedTeam === "A" ? match?.teamA : match?.teamB; const team = teamByName[teamName]; return <li key={`${player.user?._id || player.user?.userId || index}`}><span>{team?.flag || "🏏"} {player.user?.username || player.user?.userId || `Player ${index + 1}`}</span><small>{teamName || "Team unavailable"} · {player.entryPaymentStatus || "No payment required"}</small></li>; })}</ul> : <p className="ac-view-empty">No players have joined this contest.</p>}
        </section>
      </div>}

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
