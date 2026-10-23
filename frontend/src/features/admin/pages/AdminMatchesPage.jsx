
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch } from "../services/adminSession";
import MatchCompetitionFields from "../components/MatchCompetitionFields";
import { formatIndiaDateTime, toIndiaDateTimeInput, parseIndiaDateTimeInput } from "../../../utils/dateTime";

import "../styles/admin-matches.css";

const API_URL = "/api/admin/matches";

const MATCH_FORMATS = ["T10", "T20", "ODI", "TEST", "HUNDRED"];
const STATUSES = ["upcoming", "live", "completed", "cancelled", "abandoned"];
const FINAL_RESULTS = [
  ["teamA", "Team A wins"],
  ["teamB", "Team B wins"],
  ["tie", "Tie"],
  ["no_result", "No result"],
];

const EMPTY_FORM = {
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [correctionId, setCorrectionId] = useState("");
  const [correctionResult, setCorrectionResult] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [now, setNow] = useState(Date.now());
  const requestRef = useRef(null);

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
      const response = await adminFetch(API_URL, { signal: controller.signal });
      const data = await readResponse(response);

      setMatches(Array.isArray(data.matches) ? data.matches : []);
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

  const counts = useMemo(() => ({
    total: matches.length,
    upcoming: matches.filter((match) => match.status === "upcoming").length,
    live: matches.filter((match) => match.status === "live").length,
    completed: matches.filter((match) => match.status === "completed").length,
  }), [matches]);

  const filteredMatches = useMemo(() => {
    const query = search.trim().toLowerCase();

    return matches.filter((match) => {
      const matchesSearch =
        !query ||
        [match.competition, match.teamA, match.teamB, match.format]
          .some((value) => String(value || "").toLowerCase().includes(query));

      const matchesStatus =
        statusFilter === "all" || match.status === statusFilter;

      const matchesFormat =
        formatFilter === "all" || match.format === formatFilter;

      return matchesSearch && matchesStatus && matchesFormat;
    });
  }, [matches, search, statusFilter, formatFilter]);

  function openCreateForm() {
    setEditingId("");
    setForm({
      ...EMPTY_FORM,
      startTime: "",
    });
    setError("");
    setNotice("");
    setFormOpen(true);
  }

  function openEditForm(match) {
    setEditingId(match._id);
    setForm({
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

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
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
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setNotice("");

    const teamA = form.teamA.trim();
    const teamB = form.teamB.trim();

    if (!form.competition || !teamA || !teamB || !form.startTime) {
      setError("Choose a competition, both teams, and a match start time.");
      return;
    }

    if (teamA.toLowerCase() === teamB.toLowerCase()) {
      setError("Team A and Team B must be different.");
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

    const payload = {
      competition: form.competition,
      teamA,
      teamB,
      format: form.format,
      status: form.status,
      startTime: parseIndiaDateTimeInput(form.startTime).toISOString(),
      ...(["completed", "cancelled", "abandoned"].includes(form.status)
        ? { result: form.status === "cancelled" ? "cancelled" : form.status === "abandoned" ? "abandoned" : form.result }
        : {}),
    };

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
      setEditingId("");
      setForm(EMPTY_FORM);
      setNotice(isEditing
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
        <section className="admin-matches-form-card">
          <div className="admin-matches-form-heading">
            <div>
              <h2>{editingId ? "Edit match" : "Create a match"}</h2>
              <p>
                {editingId
                  ? "Update the match details below."
                  : "Choose a competition and teams, then set the start time."}
              </p>
            </div>

            <button
              type="button"
              className="admin-matches-close-btn"
              onClick={closeForm}
              disabled={saving}
              aria-label="Close match form"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="admin-matches-form-grid">
              <MatchCompetitionFields form={form} setForm={setForm} />

              <label>
                Scheduled start
                <input
                  type="datetime-local"
                  name="startTime"
                  value={form.startTime}
                  onChange={updateField}
                  required
                />
              </label>

              <label>
                Initial status
                <select name="status" value={form.status} onChange={updateField}>
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>

              {form.status === "completed" && (
                <label>
                  Official result
                  <select
                    name="result"
                    value={form.result}
                    onChange={updateField}
                    required
                  >
                    <option value="">Select result</option>
                    {FINAL_RESULTS.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              )}
              {correctionId && (
                <section className="admin-matches-form-card">
                  <div className="admin-matches-form-heading">
                    <div>
                      <h2>Correct published result</h2>
                      <p>
                        Corrections reverse prior payouts/refunds where possible and
                        recalculate all affected contests. This action is audited.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="admin-matches-close-btn"
                      onClick={() => setCorrectionId("")}
                      disabled={correcting}
                      aria-label="Close result correction form"
                    >
                      ×
                    </button>
                  </div>
                  <form onSubmit={submitResultCorrection}>
                    <div className="admin-matches-form-grid">
                      <label>
                        Correct official result
                        <select
                          value={correctionResult}
                          onChange={(event) => setCorrectionResult(event.target.value)}
                          required
                        >
                          <option value="">Select result</option>
                          {FINAL_RESULTS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="admin-matches-form-full">
                        Correction reason
                        <textarea
                          value={correctionReason}
                          onChange={(event) => setCorrectionReason(event.target.value)}
                          maxLength={500}
                          rows={3}
                          required
                        />
                      </label>
                    </div>
                    <div className="admin-matches-form-actions">
                      <button
                        type="button"
                        className="admin-matches-secondary-btn"
                        onClick={() => setCorrectionId("")}
                        disabled={correcting}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="admin-matches-primary-btn"
                        disabled={correcting}
                      >
                        {correcting ? "Correcting..." : "Apply correction"}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              <label className="admin-matches-form-full">
                Match start date and time
                <input
                  type="datetime-local"
                  name="startTime"
                  value={form.startTime}
                  onChange={updateField}
                  required
                />
              </label>
            </div>

            <div className="admin-matches-form-actions">
              <button
                type="button"
                className="admin-matches-secondary-btn"
                onClick={closeForm}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="admin-matches-primary-btn"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Create match"}
              </button>
            </div>
          </form>
        </section>
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
              placeholder="Search teams or format..."
              aria-label="Search matches"
            />
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>

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
            <div className="admin-matches-table-wrap">
              <table className="admin-matches-table">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Format</th>
                    <th>Start time / countdown</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.map((match) => (
                    <tr key={match._id}>
                      <td>
                        <div className="admin-matches-match-cell">
                          <div className="admin-matches-teams">
                            <strong>{match.teamA}</strong>
                            <span>vs</span>
                            <strong>{match.teamB}</strong>
                          </div>
                          {match.competition && (
                            <small>{match.competition}</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="admin-matches-format">
                          {match.format === "HUNDRED" ? "Hundred" : match.format}
                        </span>
                      </td>
                      <td>
                        {formatDate(match.startTime)}
                        <small className="admin-matches-countdown">
                          {formatCountdown(match.startTime, now)}
                        </small>
                      </td>
                      <td>
                        <span className={`admin-matches-status admin-matches-status--${match.status}`}>
                          <span />
                          {match.status}
                        </span>
                        {match.result && (
                          <small className="admin-matches-result">
                            Result: {match.result}
                          </small>
                        )}
                      </td>
                      <td>
                        <div className="admin-matches-row-actions">
                          <button
                            type="button"
                            className="admin-matches-edit-btn"
                            onClick={() => openEditForm(match)}
                            disabled={
                              Boolean(deletingId) ||
                              ["completed", "cancelled", "abandoned"].includes(match.status)
                            }
                            title={
                              ["completed", "cancelled", "abandoned"].includes(match.status)
                                ? "Finalized match results cannot be edited."
                                : undefined
                            }
                          >
                            Edit
                          </button>
                          {match.status === "completed" && (
                            <button
                              type="button"
                              className="admin-matches-edit-btn"
                              onClick={() => openCorrectionForm(match)}
                              disabled={Boolean(deletingId) || correcting}
                            >
                              {match.pendingResultCorrection
                                ? "Resume correction"
                                : "Correct result"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="admin-matches-delete-btn"
                            onClick={() => handleDelete(match)}
                            disabled={Boolean(deletingId)}
                          >
                            {deletingId === match._id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-matches-list-footer">
              Showing {filteredMatches.length} of {matches.length} matches
            </div>
          </>
        )}
      </section>
    </section>
  );
}
