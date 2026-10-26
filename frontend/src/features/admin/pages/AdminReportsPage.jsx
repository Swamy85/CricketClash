import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "../services/adminSession";
import "./AdminReportsPage.css";

const TYPES = [
  ["contests", "Contest Reports"], ["matches", "Match Reports"],
  ["transactions", "Transaction Reports"], ["users", "User Reports"],
];
const STATUS_OPTIONS = {
  contests: ["OPEN", "WAITING", "FULL", "LOCKED", "COMPLETED", "CANCELLED", "REFUNDED"],
  matches: ["upcoming", "live", "completed", "cancelled", "abandoned"],
  transactions: ["PENDING", "COMPLETED", "FAILED", "REVERSED"],
  users: ["verified", "unverified"],
};
const TX_TYPES = ["DEPOSIT", "CONTEST_ENTRY", "CONTEST_ENTRY_REVERSAL", "CONTEST_WINNING", "CONTEST_REFUND", "WITHDRAWAL", "WITHDRAWAL_RELEASE", "ADMIN_ADJUSTMENT"];
const money = (amount) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(amount || 0));
const integer = (n) => new Intl.NumberFormat("en-IN").format(Number(n || 0));
const dateLabel = (value) => value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const dateInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const initialDates = () => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - 29); return { from: dateInput(from), to: dateInput(to) }; };

function Chart({ trend, field, color, label, type = "line" }) {
  const values = trend.map((item) => Number(item[field] || 0));
  const max = Math.max(...values, 1);
  const width = 620, height = 180, left = 44, right = 10, top = 14, bottom = 34;
  const x = (i) => left + (trend.length < 2 ? 0 : i * (width - left - right) / (trend.length - 1));
  const y = (v) => top + (max - v) * (height - top - bottom) / max;
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return <div className="reports-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} chart`} className="reports-chart">
    {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} className="chart-grid"/><text x={left - 6} y={y(max * fraction) + 4} textAnchor="end" className="chart-axis">{type === "bar" ? Math.round(max * fraction) : money(max * fraction)}</text></g>)}
    {type === "bar" ? trend.map((item, i) => { const barW = Math.max(3, (width - left - right) / Math.max(trend.length, 1) * .62); return <rect key={item.date} x={x(i) - barW / 2} y={y(values[i])} width={barW} height={height - bottom - y(values[i])} rx="2" fill={color}><title>{item.date}: {integer(values[i])}</title></rect>; }) : <><path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{values.map((v, i) => <circle key={trend[i].date} cx={x(i)} cy={y(v)} r="3" fill={color}><title>{trend[i].date}: {money(v)}</title></circle>)}</>}
    {trend.filter((_, i) => i === 0 || i === trend.length - 1 || (trend.length > 5 && i % Math.ceil(trend.length / 5) === 0)).map((item) => { const i = trend.indexOf(item); return <text key={item.date} x={x(i)} y={height - 8} textAnchor="middle" className="chart-axis">{item.date.slice(5)}</text>; })}
  </svg><span className="reports-legend"><i style={{ background: color }}/>{label}</span></div>;
}

function RevenueChart({ trend }) {
  const series = [["entryFees", "Entry fees", "#762b46"], ["platformRevenue", "Platform revenue", "#aa7187"], ["prizesPaid", "Prizes paid", "#d29a55"]];
  const max = Math.max(1, ...trend.flatMap((row) => series.map(([key]) => Number(row[key] || 0))));
  const width = 620, height = 230, left = 56, right = 12, top = 16, bottom = 32;
  const x = (i) => left + (trend.length < 2 ? 0 : i * (width - left - right) / (trend.length - 1));
  const y = (value) => top + (max - value) * (height - top - bottom) / max;
  const labels = trend.filter((_, i) => i === 0 || i === trend.length - 1 || (trend.length > 5 && i % Math.ceil(trend.length / 5) === 0));
  return <div className="reports-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Entry fees, platform revenue and prizes paid over time" className="reports-chart reports-revenue-chart">
    {[0, .25, .5, .75, 1].map((f) => <g key={f}><line x1={left} x2={width - right} y1={y(max * f)} y2={y(max * f)} className="chart-grid"/><text x={left - 6} y={y(max * f) + 4} textAnchor="end" className="chart-axis">{money(max * f)}</text></g>)}
    {series.map(([key, label, color]) => { const d = trend.map((row, i) => `${i ? "L" : "M"}${x(i)},${y(Number(row[key] || 0))}`).join(" "); return <g key={key}><path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>{trend.map((row, i) => <circle key={`${key}-${row.date}`} cx={x(i)} cy={y(Number(row[key] || 0))} r="3" fill={color}><title>{label} · {row.date}: {money(row[key])}</title></circle>)}</g>; })}
    {labels.map((row) => { const i = trend.indexOf(row); return <text key={row.date} x={x(i)} y={height - 7} textAnchor="middle" className="chart-axis">{row.date.slice(5)}</text>; })}
  </svg><div className="reports-revenue-legend">{series.map(([, label, color]) => <span key={label}><i style={{ background: color }}/>{label}</span>)}</div></div>;
}

function StatusChart({ statuses }) {
  const colors = { COMPLETED: "#762b46", OPEN: "#a04d69", WAITING: "#bd8094", FULL: "#d3a0ae", LOCKED: "#64748b", CANCELLED: "#d76a72", REFUNDED: "#d29a55" };
  const total = statuses.reduce((sum, item) => sum + item.count, 0);
  let offset = 0;
  const segments = statuses.map((item) => { const start = offset; const portion = total ? item.count / total : 0; offset += portion; return { ...item, start, portion }; });
  return <div className="reports-status-layout"><div className="reports-donut" style={{ background: total ? `conic-gradient(${segments.map((s) => `${colors[s.status] || "#94a3b8"} ${s.start * 100}% ${(s.start + s.portion) * 100}%`).join(",")})` : "#e2e8f0" }}><div><strong>{integer(total)}</strong><span>Contests</span></div></div><div className="reports-status-legend">{segments.map((s) => <div key={s.status}><i style={{ background: colors[s.status] || "#94a3b8" }}/><span>{s.status.toLowerCase()}</span><b>{integer(s.count)}</b><small>{total ? (s.count / total * 100).toFixed(1) : "0.0"}%</small></div>)}</div></div>;
}

function columnsFor(type) {
  if (type === "contests") return [
    ["rowNumber", "#"], ["_id", "Contest ID"], ["match", "Match"], ["name", "Contest Name"], ["entryFee", "Entry Fee"], ["totalEntries", "Entries"], ["platformFeeCollected", "Platform Fee"], ["prizePool", "Prize Pool"], ["prizesPaid", "Prizes Paid"], ["refunds", "Refunds"], ["status", "Status"], ["createdAt", "Created At"],
  ];
  if (type === "matches") return [["rowNumber", "#"], ["_id", "Match ID"], ["teamA", "Team A"], ["teamB", "Team B"], ["status", "Status"], ["startTime", "Start Time"], ["result", "Result"], ["contestCount", "Contests"], ["entryFeesCollected", "Entry Fees"], ["platformRevenue", "Platform Revenue"]];
  if (type === "transactions") return [["rowNumber", "#"], ["_id", "Transaction ID"], ["user", "User"], ["type", "Type"], ["amount", "Amount"], ["contest", "Contest"], ["status", "Status"], ["timestamp", "Timestamp"]];
  return [["rowNumber", "#"], ["userId", "User ID"], ["username", "Username"], ["email", "Email"], ["createdAt", "Registered"], ["isEmailVerified", "Account"], ["joinedContests", "Joined Contests"], ["transactionTotal", "Transaction Volume"], ["transactionCount", "Transactions"]];
}

function displayValue(row, key, type) {
  if (key === "match") return row.match ? `${row.match.teamA || "?"} vs ${row.match.teamB || "?"}` : "—";
  if (key === "user") return row.user ? `${row.user.userId || ""} ${row.user.username || row.user.email || ""}`.trim() : "—";
  if (key === "contest") return row.contest?.name || (row.contest?._id ? String(row.contest._id).slice(-8) : "—");
  if (["entryFee", "platformFeeCollected", "prizePool", "prizesPaid", "refunds", "entryFeesCollected", "platformRevenue", "amount", "transactionTotal"].includes(key)) return money(row[key]);
  if (key === "createdAt" || key === "timestamp" || key === "startTime") return dateLabel(row[key]);
  if (key === "isEmailVerified") return row[key] ? "Verified" : "Unverified";
  if (key === "_id") return String(row[key] || "").slice(-10).toUpperCase();
  if (key === "result") return row[key] || "—";
  return row[key] ?? "—";
}

function csvSafe(value) {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function AdminReportsPage() {
  const [range, setRange] = useState(initialDates);
  const [group, setGroup] = useState("weekly");
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [type, setType] = useState("contests");
  const [filters, setFilters] = useState({ search: "", status: "ALL", matchId: "ALL", entryFee: "", txType: "ALL" });
  const [draftSearch, setDraftSearch] = useState("");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState({ rows: [], pagination: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [matches, setMatches] = useState([]);
  const [matchInfo, setMatchInfo] = useState(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ ...range, page: String(page), limit: "10" });
    if (filters.search) p.set("search", filters.search);
    if (filters.status !== "ALL") p.set("status", filters.status);
    if (type === "contests" && filters.matchId !== "ALL") p.set("matchId", filters.matchId);
    if (type === "contests" && filters.entryFee) p.set("entryFee", filters.entryFee);
    if (type === "transactions" && filters.txType !== "ALL") p.set("type", filters.txType);
    return p.toString();
  }, [range, filters, type, page]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const q = new URLSearchParams({ ...range, group });
      const response = await adminFetch(`/api/admin/reports/overview?${q}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Unable to load reports overview.");
      setOverview(body.data);
    } catch (err) { setError(err.message); } finally { setOverviewLoading(false); }
  }, [range, group]);

  const loadReport = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await adminFetch(`/api/admin/reports/${type}?${params}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "Unable to load this report.");
      setReport(body.data);
    } catch (err) { setError(err.message); setReport({ rows: [], pagination: null }); } finally { setLoading(false); }
  }, [type, params]);

  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => {
    if (type !== "contests") return;
    let active = true;
    adminFetch("/api/admin/matches?limit=100").then((r) => r.json()).then((b) => {
      const rows = b.matches || b.data?.matches || b.data || [];
      if (active && Array.isArray(rows)) setMatches(rows);
    }).catch(() => {});
    return () => { active = false; };
  }, [type]);

  function changeFilter(key, value) { setPage(1); setFilters((prev) => ({ ...prev, [key]: value })); }
  function applySearch(event) { event.preventDefault(); changeFilter("search", draftSearch.trim()); }
  function resetFilters() { setFilters({ search: "", status: "ALL", matchId: "ALL", entryFee: "", txType: "ALL" }); setDraftSearch(""); setPage(1); }
  function updateRange(key, value) { setRange((prev) => ({ ...prev, [key]: value })); setPage(1); }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true); setError("");
    try {
      const all = [];
      const first = await adminFetch(`/api/admin/reports/${type}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(params)), page: "1", limit: "100" })}`);
      const firstBody = await first.json();
      if (!first.ok || !firstBody.success) throw new Error(firstBody.message || "Could not export report.");
      all.push(...firstBody.data.rows);
      const pages = firstBody.data.pagination.totalPages;
      for (let p = 2; p <= pages; p += 1) {
        const q = new URLSearchParams(params); q.set("page", String(p)); q.set("limit", "100");
        const response = await adminFetch(`/api/admin/reports/${type}?${q}`);
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message || "Could not finish CSV export.");
        all.push(...body.data.rows);
      }
      const columns = columnsFor(type);
      const lines = [columns.map(([, title]) => csvSafe(title)).join(","), ...all.map((row) => columns.map(([key]) => csvSafe(displayValue(row, key, type))).join(","))];
      const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `cricketclash-${type}-reports.csv`; link.click(); URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); } finally { setExporting(false); }
  }

  const kpis = overview?.kpis;
  const statCards = kpis ? [
    ["♟", "Total Users", integer(kpis.totalUsers), "Accounts through end date", "blue"], ["▦", "Total Matches", integer(kpis.totalMatches), "Created in period", "blue"], ["🏆", "Total Contests", integer(kpis.totalContests), "Created in period", "gold"], ["◉", "Entry Fees", money(kpis.entryFeesCollected), "Successful payments", "green"], ["◎", "Platform Revenue", money(kpis.platformRevenue), "Net ledger fees", "gold"], ["🎁", "Prizes Paid", money(kpis.prizesPaid), "Successful payouts", "red"], ["↶", "Refunds", money(kpis.refunds), "Completed refunds", "purple"],
  ] : [];
  const activeColumns = columnsFor(type);
  const totalPages = report.pagination?.totalPages || 1;
  const pageButtons = Array.from(new Set([1, Math.max(1, page - 1), page, Math.min(totalPages, page + 1), totalPages])).filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);

  return <section className="admin-reports-page">
    <header className="reports-heading"><div><span className="reports-title-icon">▥</span><div><h1>Reports Management</h1><p>View platform performance, revenue, contests, users and download reports</p></div></div><div className="reports-heading-actions"><div className="reports-range"><label>From<input aria-label="Start date" type="date" value={range.from} max={range.to} onChange={(e) => updateRange("from", e.target.value)} /></label><span>to</span><label>To<input aria-label="End date" type="date" value={range.to} min={range.from} onChange={(e) => updateRange("to", e.target.value)} /></label></div><button className="reports-export" onClick={exportCsv} disabled={exporting || loading}>{exporting ? "Preparing…" : "↓ Export CSV"}</button></div></header>
    {error && <div className="reports-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
    <div className="reports-kpis">{overviewLoading ? Array.from({ length: 7 }, (_, i) => <div className="reports-kpi reports-skeleton" key={i}/>) : statCards.map(([icon, title, value, caption, tint]) => <article className="reports-kpi" key={title}><span className={`reports-kpi-icon ${tint}`}>{icon}</span><div><small>{title}</small><strong>{value}</strong><em>{caption}</em></div></article>)}</div>
    <div className="reports-charts"><article className="reports-panel reports-revenue"><header><div><h2>Revenue Trend</h2><p>Entry fees, platform fees and payouts</p></div><select aria-label="Trend grouping" value={group} onChange={(e) => setGroup(e.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></header>{overview?.trend?.length ? <RevenueChart trend={overview.trend}/> : <p className="reports-empty-chart">{overviewLoading ? "Loading chart…" : "No financial activity in this date range."}</p>}</article><article className="reports-panel reports-status-panel"><header><div><h2>Contest Status</h2><p>Contests created in period</p></div></header>{overviewLoading ? <div className="reports-empty-chart">Loading…</div> : <StatusChart statuses={overview?.contestStatuses || []}/>}</article><article className="reports-panel reports-registration"><header><div><h2>User Registrations</h2><p>New accounts by {group === "daily" ? "day" : group === "weekly" ? "week" : "month"}</p></div></header>{overview?.trend?.length ? <Chart trend={overview.trend} field="newUsers" color="#762b46" label="New users" type="bar"/> : <p className="reports-empty-chart">No registrations in this date range.</p>}</article></div>
    <nav className="reports-tabs" aria-label="Report categories">{TYPES.map(([key, label]) => <button key={key} className={type === key ? "active" : ""} onClick={() => { setType(key); setPage(1); setMatchInfo(null); }}>{label}</button>)}</nav>
    <section className="reports-table-panel"><form className="reports-filters" onSubmit={applySearch}><input className="reports-search" aria-label="Search report" placeholder={`Search ${type}…`} value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} />{STATUS_OPTIONS[type] && <select aria-label="Filter status" value={filters.status} onChange={(e) => changeFilter("status", e.target.value)}><option value="ALL">All Statuses</option>{STATUS_OPTIONS[type].map((status) => <option key={status} value={status}>{status}</option>)}</select>}{type === "contests" && <><select aria-label="Filter match" value={filters.matchId} onChange={(e) => changeFilter("matchId", e.target.value)}><option value="ALL">All Matches</option>{matches.map((m) => <option key={m._id} value={m._id}>{m.teamA} vs {m.teamB}</option>)}</select><input aria-label="Filter entry fee" type="number" min="0" step="0.01" placeholder="Entry fee (₹)" value={filters.entryFee} onChange={(e) => changeFilter("entryFee", e.target.value)} /></>}{type === "transactions" && <select aria-label="Filter transaction type" value={filters.txType} onChange={(e) => changeFilter("txType", e.target.value)}><option value="ALL">All Types</option>{TX_TYPES.map((v) => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select>}<button type="submit" className="reports-search-button">Search</button><button type="button" className="reports-reset" onClick={resetFilters}>Reset</button></form>
      <div className="reports-table-title"><h2>{TYPES.find(([key]) => key === type)?.[1]} <span>({integer(report.pagination?.total || 0)} records)</span></h2></div>
      <div className="reports-table-scroll"><table><thead><tr>{activeColumns.map(([key, title]) => <th key={key}>{title}</th>)}{type === "contests" && <th>Actions</th>}</tr></thead><tbody>{loading ? <tr><td colSpan={activeColumns.length + 1} className="reports-table-message">Loading report…</td></tr> : report.rows.length ? report.rows.map((row) => <tr key={row._id}>{activeColumns.map(([key]) => <td key={key} className={key === "status" ? `report-status status-${String(row[key]).toLowerCase()}` : ""}>{displayValue(row, key, type)}</td>)}{type === "contests" && <td><button type="button" className="reports-view" onClick={() => setMatchInfo(matchInfo === row._id ? null : row._id)}>View</button></td>}</tr>) : <tr><td colSpan={activeColumns.length + 1} className="reports-table-message">No matching records found.</td></tr>}</tbody></table></div>
      {matchInfo && (() => { const selected = report.rows.find((row) => row._id === matchInfo); return selected ? <div className="reports-detail" role="status"><strong>{selected.name || "Contest details"}</strong><span>{selected.match?.teamA || "?"} vs {selected.match?.teamB || "?"} · {selected.status} · {selected.totalEntries}/{selected.capacity} entries · {money(selected.entryFeesCollected)} collected · {money(selected.platformFeeCollected)} platform fees · {money(selected.prizesPaid)} prizes · {money(selected.refunds)} refunds</span><button type="button" onClick={() => setMatchInfo(null)}>Close</button></div> : null; })()}
      <footer className="reports-pagination"><span>Showing {report.rows.length ? (page - 1) * 10 + 1 : 0}–{Math.min(page * 10, report.pagination?.total || 0)} of {integer(report.pagination?.total || 0)}</span><div><button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>{pageButtons.map((n) => <button key={n} className={n === page ? "current" : ""} disabled={loading} onClick={() => setPage(n)}>{n}</button>)}<button disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Next</button></div></footer>
    </section>
  </section>;
}
