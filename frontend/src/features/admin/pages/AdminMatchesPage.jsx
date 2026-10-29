
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch } from "../services/adminSession";
import { filterAdminPublishedMatches, paginateItems } from "../utils/adminMatchListUtils.js";
import MatchCompetitionFields from "../components/MatchCompetitionFields";
import { formatIndiaDateTime, toIndiaDateTimeInput, parseIndiaDateTimeInput } from "../../../utils/dateTime";

import "../styles/admin-matches.css";

const API_URL = "/api/admin/matches";
const MATCHES_PER_PAGE = 20;

const MATCH_FORMATS = ["T10", "T20", "ODI", "TEST", "HUNDRED"];
const STATUSES = ["upcoming", "live", "completed", "cancelled", "abandoned"];
const FINAL_RESULTS = ["tie", "no_result"];
const CONTEST_TEMPLATES = [
  ["FREE", "Free", 0, 0], ["BRONZE", "Bronze", 50, 100],
  ["SILVER", "Silver", 100, 200], ["GOLD", "Gold", 250, 500],
  ["PLATINUM", "Platinum", 500, 1000], ["DIAMOND", "Diamond", 1000, 2000],
  ["ELITE", "Elite", 2500, 5000], ["CHAMPION", "Champion", 5000, 10000],
];

const EMPTY_FORM = {
  title: "",
  imageUrl: "",
  competition: "",
  teamA: "",
  teamB: "",
  format: "T20",
  status: "upcoming",
  result: "",
  startTime: "",
};

function toLocalDateTime(value) {
  return toIndiaDateTimeInput(value);
}

function formatDate(value) {
  if (!value) return "Not scheduled";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return formatIndiaDateTime(date);
}

function formatCountdown(value, now) {
  const start = new Date(value).getTime();
  if (!Number.isFinite(start)) return "Schedule unavailable";

  const remaining = start - now;
  if (remaining <= 0) return "Started";

  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const leftSeconds = seconds % 60;

  return days
    ? `${days}d ${hours}h ${minutes}m`
    : `${hours}h ${minutes}m ${leftSeconds}s`;
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "The request could not be completed.");
  }

  return data;
}

export default function AdminMatchesPage() {
  const [matches, setMatches] = useState([]);
  const [serverCounts, setServerCounts] = useState({ total: 0, upcoming: 0, live: 0, completed: 0 });
  const [teamsByName, setTeamsByName] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [resultOnly, setResultOnly] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [correctionId, setCorrectionId] = useState("");
  const [correctionResult, setCorrectionResult] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [now, setNow] = useState(Date.now());
  const requestRef = useRef(null);
  const creationRequestIdRef = useRef("");
  const matchSliderRef = useRef(null);

  function scrollMatchCards(direction) {
    matchSliderRef.current?.scrollBy({ left: direction * 320, behavior: "smooth" });
  }

  const loadMatches = useCallback(async ({ silent = false, initial = false } = {}) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoading(true);
    if (!silent && !initial) {
      setRefreshing(true);
      setError("");
      setNotice("");
    }

    try {
      const response = await adminFetch(`${API_URL}?limit=1000`, { signal: controller.signal });
      const data = await readResponse(response);

      setMatches(Array.isArray(data.matches) ? data.matches : []);
      if (data.counts) setServerCounts(data.counts);
      setError("");
      if (!silent && !initial) setNotice("Matches updated.");
    } catch (err) {
      if (!silent && err.name !== "AbortError") {
        setError(err.message || "Could not load matches.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        if (initial) setLoading(false);
        if (!silent && !initial) setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadMatches({ initial: true });
    return () => {
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
    };
  }, [loadMatches]);

  useEffect(() => {
    const refreshPublishedMatches = () => void loadMatches({ silent: true });
    window.addEventListener("cricketclash:matches-updated", refreshPublishedMatches);
    return () => window.removeEventListener("cricketclash:matches-updated", refreshPublishedMatches);
  }, [loadMatches]);

  useEffect(() => {
    const controller = new AbortController();
    adminFetch("/api/admin/teams?limit=1000", { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (data.success && Array.isArray(data.teams)) {
          setTeamsByName(Object.fromEntries(data.teams.map((team) => [team.name, team])));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const refreshTimer = window.setInterval(
      () => void loadMatches({ silent: true }),
      15_000
    );

    return () => {
      window.clearInterval(timer);
      window.clearInterval(refreshTimer);
    };
  }, [loadMatches]);

  const counts = serverCounts;
  const editingMatch = matches.find((match) => match._id === editingId);
  const editingFinalized = Boolean(editingMatch && ["completed", "cancelled", "abandoned"].includes(editingMatch.status));
  const correctionMatch = matches.find((match) => match._id === correctionId);

  const filteredMatches = filterAdminPublishedMatches(matches, { query: search, status: statusFilter, format: formatFilter });
  const pagination = paginateItems(filteredMatches, page, MATCHES_PER_PAGE);
  const { pageCount, items: visibleMatches } = pagination;

  useEffect(() => setPage(1), [search, statusFilter, formatFilter]);
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  function openCreateForm() {
    setResultOnly(false);
    setEditingId("");
    creationRequestIdRef.current = window.crypto?.randomUUID?.()
      || `match_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
    setForm({
      ...EMPTY_FORM,
      startTime: "",
    });
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function openEditForm(match) {
    setResultOnly(false);
    setEditingId(match._id);
    setForm({
      title: match.title || `${match.teamA} vs ${match.teamB}`,
      imageUrl: match.imageUrl || "",
      competition: match.competition || "",
      teamA: match.teamA || "",
      teamB: match.teamB || "",
      format: match.format || "T20",
      status: match.status || "upcoming",
      result: match.result || "",
      startTime: toLocalDateTime(match.startTime),
    });
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function openResultForm(match) {
    if (["completed", "cancelled", "abandoned"].includes(match.status)) {
      if (match.status === "completed") openCorrectionForm(match);
      else setNotice("This match outcome is already finalized.");
      return;
    }
    setEditingId(match._id);
    setResultOnly(true);
    setForm({
      ...EMPTY_FORM,
      title: match.title || `${match.teamA} vs ${match.teamB}`,
      competition: match.competition || "",
      teamA: match.teamA || "",
      teamB: match.teamB || "",
      format: match.format || "T20",
      status: "completed",
      result: "",
      startTime: toLocalDateTime(match.startTime),
    });
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function handleCardKeyDown(event, match) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openEditForm(match);
    }
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setResultOnly(false);
    setEditingId("");
    setForm(EMPTY_FORM);
  }

  function openCorrectionForm(match) {
    const pending = match.pendingResultCorrection;
    setCorrectionId(match._id);
    setCorrectionResult(pending?.result || "");
    setCorrectionReason(pending?.reason || "");
    setError("");
    setNotice("");
  }

  async function submitResultCorrection(event) {
    event.preventDefault();
    if (!correctionId || !correctionResult || !correctionReason.trim()) {
      setError("Select a corrected result and provide a reason.");
      return;
    }

    setCorrecting(true);
    setError("");
    setNotice("");

    try {
      const response = await adminFetch(
        `${API_URL}/${correctionId}/correct-result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            result: correctionResult,
            reason: correctionReason.trim(),
          }),
        }
      );
      const data = await readResponse(response);
      setNotice(data.message || "Match result corrected.");
      setCorrectionId("");
      setCorrectionResult("");
      setCorrectionReason("");
      await loadMatches({ silent: true });
    } catch (err) {
      setError(err.message || "Could not correct the match result.");
    } finally {
      setCorrecting(false);
    }
  }

  function updateField(event) {
    const { name, value } = event.target;
    const nextValue = event.target.type === "checkbox" ? event.target.checked : value;
    setForm((current) => ({ ...current, [name]: nextValue }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const teamA = form.teamA.trim();
    const teamB = form.teamB.trim();
    let payload;

    if (resultOnly) {
      if (!editingId || !["completed", "cancelled", "abandoned"].includes(form.status)) {
        setError("Choose a final match outcome before saving.");
        return;
      }
      if (form.status === "completed" && !["teamA", "teamB", "tie", "no_result"].includes(form.result)) {
        setError("Choose the winner, a tie, or no result before completing this match.");
        return;
      }
      payload = {
        status: form.status,
        ...(form.status === "completed" ? { result: form.result } : {}),
      };
    } else {
      if (!form.title.trim() || !form.competition || !teamA || !teamB || !form.startTime) {
        setError("Enter a match title, choose a competition and both teams, and set a start time.");
        return;
      }
      if (teamA.toLowerCase() === teamB.toLowerCase()) {
        setError("Select two different competing teams.");
        return;
      }
      if (form.status === "completed" && !form.result) {
        setError("Select the official match result before completing the match.");
        return;
      }
      const startTime = new Date(form.startTime);
      if (Number.isNaN(startTime.getTime())) {
        setError("Please enter a valid match start time.");
        return;
      }
      payload = {
        title: form.title.trim(),
        imageUrl: form.imageUrl.trim(),
        competition: form.competition,
        teamA,
        teamB,
        format: form.format,
        status: form.status,
        startTime: parseIndiaDateTimeInput(form.startTime).toISOString(),
        ...(!editingId ? {
          creationRequestId: creationRequestIdRef.current,
          automaticContestGeneration: true,
          automaticContestTiers: CONTEST_TEMPLATES.map(([tier]) => tier),
        } : {}),
        ...(["completed", "cancelled", "abandoned"].includes(form.status)
          ? { result: form.status === "cancelled" ? "cancelled" : form.status === "abandoned" ? "abandoned" : form.result }
          : {}),
      };
    }

    setSaving(true);

    try {
      const isEditing = Boolean(editingId);
      const response = await adminFetch(
        isEditing ? `${API_URL}/${editingId}` : API_URL,
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      await readResponse(response);

      setFormOpen(false);
      setResultOnly(false);
      setEditingId("");
      creationRequestIdRef.current = "";
      setForm(EMPTY_FORM);
      setNotice(resultOnly
        ? "Match result saved. Contest settlements were triggered automatically."
        : isEditing
        ? "Match updated successfully."
        : "Match created successfully.");

      await loadMatches({ silent: true });
    } catch (err) {
      setError(err.message || "Could not save the match.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(match) {
    const confirmed = window.confirm(
      `Delete ${match.teamA} vs ${match.teamB}? This action cannot be undone.`
    );

    if (!confirmed) return;

    setError("");
    setNotice("");
    setDeletingId(match._id);

    try {
      const response = await adminFetch(`${API_URL}/${match._id}`, {
        method: "DELETE",
      });

      await readResponse(response);

      setNotice("Match deleted successfully.");
      await loadMatches({ silent: true });
    } catch (err) {
      setError(err.message || "Could not delete the match.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className="admin-matches-page">
      <div className="admin-matches-breadcrumb">
        <Link to="/admin/dashboard">Dashboard</Link>
        <span>/</span>
        <strong>Matches</strong>
      </div>

      <header className="admin-matches-heading">
        <div>
          <span className="admin-matches-eyebrow">MATCH OPERATIONS</span>
          <h1>Match Management</h1>
          <p>Create, schedule, and manage matches displayed to players.</p>
        </div>

        <button
          type="button"
          className="admin-matches-primary-btn"
          onClick={openCreateForm}
        >
          <span aria-hidden="true">＋</span> Create match
        </button>
      </header>

      {error && (
        <div className="admin-matches-alert admin-matches-alert--error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className="admin-matches-alert admin-matches-alert--success" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}

      <div className="admin-matches-stats">
        <article className="admin-matches-stat">
          <span className="admin-matches-stat-icon">▦</span>
          <div>
            <span>Total matches</span>
            <strong>{counts.total}</strong>
          </div>
        </article>

        <article className="admin-matches-stat">
          <span className="admin-matches-stat-icon">◷</span>
          <div>
            <span>Upcoming</span>
            <strong>{counts.upcoming}</strong>
          </div>
        </article>

        <article className="admin-matches-stat">
          <span className="admin-matches-stat-icon">●</span>
          <div>
            <span>Live now</span>
            <strong>{counts.live}</strong>
          </div>
        </article>

        <article className="admin-matches-stat">
          <span className="admin-matches-stat-icon">✓</span>
          <div>
            <span>Completed</span>
            <strong>{counts.completed}</strong>
          </div>
        </article>
      </div>

      {formOpen && (
        <div className="admin-matches-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeForm()}>
          <section className={`admin-matches-form-card admin-matches-modal${resultOnly ? " admin-matches-modal--result-only" : ""}`} role="dialog" aria-modal="true" aria-labelledby="match-modal-title">
            <div className="admin-matches-form-heading"><div><h2 id="match-modal-title">{resultOnly ? "Update match result" : editingId ? "Edit match" : "Create a match"}</h2><p>{resultOnly ? "Finalize the official result to trigger contest settlement." : editingFinalized ? "This result is finalized. Use the audited correction flow to change it." : editingId ? "Update match details and record the official outcome when finalized." : "Choose a competition and teams, then set the start time."}</p></div><button type="button" className="admin-matches-close-btn" onClick={closeForm} disabled={saving} aria-label="Close match form">×</button></div>
            <form onSubmit={handleSubmit}>
              <div className={`admin-matches-form-grid${resultOnly ? " admin-matches-form-grid--result-only" : ""}`}>
                {resultOnly && <div className="admin-matches-result-summary admin-matches-form-full"><span>{form.competition || "Match"}</span><strong>{form.teamA} <small>vs</small> {form.teamB}</strong><small>{formatDate(editingMatch?.startTime)}</small></div>}
                {resultOnly && <label className="admin-matches-form-full admin-matches-result-only-field">Final status<select name="status" value={form.status} onChange={updateField} required><option value="completed">Completed</option><option value="abandoned">Abandoned</option><option value="cancelled">Cancelled</option></select></label>}
                {resultOnly && form.status === "completed" && <label className="admin-matches-form-full admin-matches-result-only-field">Official result<select name="result" value={form.result} onChange={updateField} required><option value="">Select the result</option><option value="teamA">{form.teamA} wins</option><option value="teamB">{form.teamB} wins</option><option value="tie">Tie</option><option value="no_result">No result</option></select><small>Choose No result for a completed match without a winner, or select Abandoned above.</small></label>}
                <MatchCompetitionFields form={form} setForm={setForm} disabled={editingFinalized || resultOnly} />
                <label className="admin-matches-form-full">Match title<input type="text" name="title" value={form.title} onChange={updateField} maxLength={140} required disabled={editingFinalized || resultOnly} /></label>
                <label>Scheduled start<input type="datetime-local" name="startTime" value={form.startTime} onChange={updateField} required disabled={editingFinalized || resultOnly} /></label>
                <label>Match status<select name="status" value={form.status} onChange={updateField} disabled={editingFinalized || resultOnly}>{STATUSES.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}</select></label>
                <label className="admin-matches-form-full">Match image URL (optional)<input type="url" name="imageUrl" value={form.imageUrl} onChange={updateField} maxLength={500} placeholder="https://example.com/match-banner.jpg" disabled={editingFinalized || resultOnly} /></label>
                {!resultOnly && form.status === "completed" && <label className="admin-matches-form-full">Official result<select name="result" value={form.result} onChange={updateField} required disabled={editingFinalized}><option value="">Select finalized result</option><option value="teamA">{form.teamA || "First competing team"} wins</option><option value="teamB">{form.teamB || "Second competing team"} wins</option><option value="tie">Tie</option><option value="no_result">No result</option></select><small>A winner is optional for a tie or no result. Use Abandoned status when play is abandoned.</small></label>}
              </div>
              <div className="admin-matches-form-actions">
                {editingFinalized && editingMatch?.status === "completed" && <button type="button" className="admin-matches-secondary-btn" onClick={() => openCorrectionForm(editingMatch)}>{editingMatch.pendingResultCorrection ? "Resume result correction" : "Correct published result"}</button>}
                <button type="button" className="admin-matches-secondary-btn" onClick={closeForm} disabled={saving}>Close</button>
                {!editingFinalized && <button type="submit" className="admin-matches-primary-btn" disabled={saving}>{saving ? resultOnly ? "Updating result..." : "Saving..." : resultOnly ? "Save result & settle contests" : editingId ? "Save changes" : "Create match"}</button>}
              </div>
            </form>
          </section>
        </div>
      )}

      {correctionId && correctionMatch && (
        <div className="admin-matches-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !correcting && setCorrectionId("")}>
          <section className="admin-matches-form-card admin-matches-modal" role="dialog" aria-modal="true" aria-labelledby="result-correction-title">
            <div className="admin-matches-form-heading"><div><h2 id="result-correction-title">Correct published result</h2><p>{correctionMatch.teamA} vs {correctionMatch.teamB}. Corrections are audited and recalculate affected contests.</p></div><button type="button" className="admin-matches-close-btn" onClick={() => setCorrectionId("")} disabled={correcting} aria-label="Close result correction form">×</button></div>
            <form onSubmit={submitResultCorrection}>
              <div className="admin-matches-form-grid">
                <label className="admin-matches-form-full">Correct official result<select value={correctionResult} onChange={(event) => setCorrectionResult(event.target.value)} required><option value="">Select result</option><option value="teamA">{correctionMatch.teamA} wins</option><option value="teamB">{correctionMatch.teamB} wins</option><option value="tie">Tie</option><option value="no_result">No result</option></select></label>
                <label className="admin-matches-form-full">Correction reason<textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={500} rows={3} required /></label>
              </div>
              <div className="admin-matches-form-actions"><button type="button" className="admin-matches-secondary-btn" onClick={() => setCorrectionId("")} disabled={correcting}>Cancel</button><button type="submit" className="admin-matches-primary-btn" disabled={correcting}>{correcting ? "Correcting..." : "Apply correction"}</button></div>
            </form>
          </section>
        </div>
      )}
      <section className="admin-matches-list-card">
        <div className="admin-matches-list-heading">
          <div>
            <h2>All matches</h2>
            <p>Matches currently available in the system.</p>
          </div>

          <button
            type="button"
            className="admin-matches-refresh-btn"
            onClick={() => loadMatches()}
            disabled={loading || refreshing}
          >
            {refreshing ? "Refreshing..." : "↻ Refresh"}
          </button>
        </div>

        <div className="admin-matches-filters">
          <label className="admin-matches-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search teams, title, or series..."
              aria-label="Search matches"
            />
          </label>

          <div className="admin-matches-status-tabs" role="group" aria-label="Filter matches by status">
            {[["all", "All Matches"], ["upcoming", "Upcoming"], ["live", "Live"], ["completed", "Completed"]].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={statusFilter === value ? "is-active" : ""}
                onClick={() => setStatusFilter(value)}
              >
                {label} <span>{value === "all" ? counts.total : counts[value]}</span>
              </button>
            ))}
          </div>

          <select
            value={formatFilter}
            onChange={(event) => setFormatFilter(event.target.value)}
            aria-label="Filter by format"
          >
            <option value="all">All formats</option>
            {MATCH_FORMATS.map((format) => (
              <option key={format} value={format}>{format}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="admin-matches-empty">
            <span className="admin-matches-spinner" />
            <p>Loading matches...</p>
          </div>
        ) : filteredMatches.length === 0 ? (
          <div className="admin-matches-empty">
            <span className="admin-matches-empty-icon">🏏</span>
            <h3>{matches.length ? "No matches found" : "No matches yet"}</h3>
            <p>
              {matches.length
                ? "Try changing your search or filters."
                : "Create your first match to get started."}
            </p>
            {!matches.length && (
              <button
                type="button"
                className="admin-matches-primary-btn"
                onClick={openCreateForm}
              >
                Create your first match
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="admin-matches-slider-wrap">
              <button type="button" className="admin-matches-slider-arrow" onClick={() => scrollMatchCards(-1)} aria-label="Scroll matches left">‹</button>
              <div className="admin-matches-card-grid" ref={matchSliderRef}>
              {visibleMatches.map((match) => (
                <article key={match._id} className="admin-match-card" role="group" tabIndex={0} onClick={() => openEditForm(match)} onKeyDown={(event) => handleCardKeyDown(event, match)} aria-label={`Open ${match.teamA} vs ${match.teamB}`}>
                  <div className="admin-match-card-top"><span className={`admin-matches-status admin-matches-status--${match.status}`}><span />{match.status}</span><span className="admin-matches-format">{match.format === "HUNDRED" ? "Hundred" : match.format}</span>{match.providerSource === "CRICAPI" && <span className="admin-provider-review">CRICAPI: {match.published ? "PUBLISHED" : "REVIEW"}</span>}</div>
                  <div className="admin-match-card-contests"><Link to="/admin/contests" state={{ matchId: match._id }} onClick={(event) => event.stopPropagation()}>View contests</Link></div>
                  {match.imageUrl && <img className="admin-match-card-image" src={match.imageUrl} alt="" loading="lazy" />}
                  <div className="admin-match-card-teams">
                    <div className="admin-match-card-team"><span className="admin-matches-team-flag">{teamsByName[match.teamA]?.flag || "🏏"}</span><strong>{match.teamA}</strong></div>
                    <span className="admin-match-card-versus">vs</span>
                    <div className="admin-match-card-team"><span className="admin-matches-team-flag">{teamsByName[match.teamB]?.flag || "🏏"}</span><strong>{match.teamB}</strong></div>
                  </div>
                  <h3>{match.title || `${match.teamA} vs ${match.teamB}`}</h3>
                  <p className="admin-match-card-competition">{match.competition || "Competition not set"}</p>
                  {match.providerSource === "CRICAPI" && <p className="admin-match-provider-data">CricAPI: {match.providerStatus || "Status unavailable"}{(match.providerScoreSummary || [match.providerScoreA, match.providerScoreB].filter(Boolean).join(" | ")) ? ` | ${match.providerScoreSummary || [match.providerScoreA, match.providerScoreB].filter(Boolean).join(" | ")}` : ""}</p>}
                  <div className="admin-match-card-time"><span>{formatDate(match.startTime)}</span><span>{formatCountdown(match.startTime, now)}</span></div>
                  {match.result && <p className="admin-matches-result">Result: {match.result === "teamA" ? `${match.teamA} wins` : match.result === "teamB" ? `${match.teamB} wins` : match.result.replace("_", " ")}</p>}
                  <div className="admin-match-card-actions"><button type="button" className="admin-match-result-btn" onClick={(event) => { event.stopPropagation(); openResultForm(match); }}>{match.status === "completed" ? "Correct result" : ["cancelled", "abandoned"].includes(match.status) ? "View result" : "Update result"}</button><button type="button" className="admin-matches-delete-btn" onClick={(event) => { event.stopPropagation(); void handleDelete(match); }} disabled={Boolean(deletingId)}>{deletingId === match._id ? "Deleting..." : "Delete"}</button></div>
                </article>
              ))}
              </div>
              <button type="button" className="admin-matches-slider-arrow" onClick={() => scrollMatchCards(1)} aria-label="Scroll matches right">›</button>
            </div>
            <div className="admin-matches-list-footer">
              <span>Showing {filteredMatches.length ? (page - 1) * MATCHES_PER_PAGE + 1 : 0}–{Math.min(page * MATCHES_PER_PAGE, filteredMatches.length)} of {filteredMatches.length} published matches</span>
              <div className="admin-matches-pagination" aria-label="Published match pages">
                <button type="button" className="admin-matches-secondary-btn" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</button>
                <span>Page {page} of {pageCount}</span>
                <button type="button" className="admin-matches-secondary-btn" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
