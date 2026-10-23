import { useEffect, useMemo, useState } from "react";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { useAppSession } from "../../../context/SessionContext";
import { fetchContestPageData, formatContestCoins, matchResultLabel } from "../contests/contestPageApi";
import { getWalletDetails, getWalletTransactions } from "../wallet/walletService";
import "./ProfilePage.css";

const PAGE_SIZE = 10;
const dateLabel = (value) => value ? formatIndiaDateTime(value, { dateStyle: "medium", timeStyle: "short" }) : "Not available";
const idOf = (value) => typeof value === "object" ? (value?.userId || value?._id || "") : (value || "");
const selectionLabel = (selection, match) => selection === "A" ? (match?.teamA || "Team A") : selection === "B" ? (match?.teamB || "Team B") : "—";
const statusLabel = (value) => String(value || "UNKNOWN").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ProfilePage() {
  const { user } = useOutletContext();
  const { logout } = useAppSession();
  const navigate = useNavigate();
  const [contests, setContests] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [contestError, setContestError] = useState("");
  const [walletError, setWalletError] = useState("");
  const [transactionError, setTransactionError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setPageError("");
      setContestError("");
      setWalletError("");
      setTransactionError("");
      const [contestResult, walletResult, transactionResult] = await Promise.allSettled([
        fetchContestPageData("/contests/mine", controller.signal),
        getWalletDetails({ signal: controller.signal }),
        getWalletTransactions({ signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const results = [contestResult, walletResult, transactionResult];
      const expired = results.find((item) => item.status === "rejected" && [401, 403].includes(item.reason?.status));
      if (expired) { navigate("/login", { replace: true }); return; }
      if (contestResult.status === "fulfilled") setContests(Array.isArray(contestResult.value.contests) ? contestResult.value.contests : []);
      else setContestError(contestResult.reason?.message || "Contest history could not be loaded.");
      if (walletResult.status === "fulfilled") setWallet(walletResult.value.wallet || walletResult.value);
      else setWalletError(walletResult.reason?.message || "Wallet balance could not be loaded.");
      if (transactionResult.status === "fulfilled") setTransactions(Array.isArray(transactionResult.value.transactions) ? transactionResult.value.transactions : []);
      else setTransactionError(transactionResult.reason?.message || "Transactions could not be loaded.");
      if (results.every((item) => item.status === "rejected")) setPageError("Profile activity could not be loaded. Please try again.");
      setLoading(false);
    }
    void load();
    return () => controller.abort();
  }, [navigate, refreshKey]);

  const userId = String(user?.userId || "");
  const stats = useMemo(() => {
    const completed = contests.filter((contest) => ["SETTLED", "REFUNDED"].includes(contest.settlementStatus));
    const wins = contests.filter((contest) => contest.settlementStatus === "SETTLED" && idOf(contest.winnerId) === userId);
    const losses = contests.filter((contest) => contest.settlementStatus === "SETTLED" && idOf(contest.winnerId) && idOf(contest.winnerId) !== userId);
    return { total: contests.length, wins: wins.length, losses: losses.length, completed: completed.length, rate: completed.length ? Math.round((wins.length / completed.length) * 100) : 0 };
  }, [contests, userId]);

  const grouped = useMemo(() => {
    const groups = new Map();
    contests.forEach((contest) => {
      const match = typeof contest.match === "object" ? contest.match : null;
      const key = String(match?._id || contest.match || "unknown");
      if (!groups.has(key)) groups.set(key, { match, contests: [] });
      groups.get(key).contests.push(contest);
    });
    return [...groups.entries()];
  }, [contests]);

  const filteredGroups = grouped.map(([key, group]) => [key, { ...group, contests: group.contests.filter((contest) => filter === "ALL" || contest.status === filter || contest.settlementStatus === filter) }]).filter(([, group]) => group.contests.length);
  const pages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE));
  const pageTransactions = transactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section className="cc-feature-page cc-profile-complete">
      <header className="cc-profile-heading"><div><span className="cc-feature-eyebrow">YOUR ACCOUNT</span><h1>Player profile</h1><p>Your CricketClash profile, contest record, and account activity.</p></div><div className="cc-profile-header-actions"><button type="button" className="cc-button cc-button-outline" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>Refresh</button><button type="button" className="cc-button cc-button-maroon" onClick={() => logout()}>Log out</button></div></header>
      {pageError && <div className="cc-profile-alert" role="alert">{pageError}</div>}

      <section className="cc-profile-panel" aria-labelledby="profile-info-title">
        <div className="cc-profile-section-title"><div><span className="cc-feature-eyebrow">PROFILE INFORMATION</span><h2 id="profile-info-title">Account details</h2></div><span className="cc-profile-readonly">Verified account data</span></div>
        <div className="cc-profile-info-grid">
          <Info label="Player ID" value={user?.userId} />
          <Info label="Username" value={user?.username} />
          <Info label="Registered email" value={user?.email} />
          <Info label="Account created" value={dateLabel(user?.createdAt)} />
          <Info label="Account status" value={user?.isEmailVerified ? "Active · email verified" : "Active · email unverified"} />
        </div>
        <p className="cc-profile-note">Profile identity fields are managed by CricketClash and cannot be edited here.</p>
      </section>

      <section className="cc-profile-panel" aria-labelledby="contest-stats-title">
        <div className="cc-profile-section-title"><div><span className="cc-feature-eyebrow">CONTEST STATISTICS</span><h2 id="contest-stats-title">Your record</h2></div></div>
        {contestError ? <p className="cc-profile-inline-error" role="alert">{contestError}</p> : loading ? <p className="cc-profile-muted">Loading contest statistics…</p> : <div className="cc-profile-stats">
          <Stat label="Contest entries" value={stats.total} /><Stat label="Verified wins" value={stats.wins} /><Stat label="Losses" value={stats.losses} /><Stat label="Completed" value={stats.completed} /><Stat label="Win rate" value={stats.rate + "%"} />
        </div>}
      </section>

      <section className="cc-profile-panel" aria-labelledby="wallet-overview-title">
        <div className="cc-profile-section-title"><div><span className="cc-feature-eyebrow">WALLET OVERVIEW</span><h2 id="wallet-overview-title">Available balance</h2></div><Link className="cc-profile-link" to="/dashboard/wallet">Open wallet <span aria-hidden="true">→</span></Link></div>
        {walletError ? <p className="cc-profile-inline-error" role="alert">{walletError}</p> : loading ? <p className="cc-profile-muted">Loading wallet…</p> : <div className="cc-profile-balance"><strong>{formatContestCoins(wallet?.availableBalance ?? wallet?.balance ?? 0)}</strong><span>Current available coins</span></div>}
      </section>

      <section className="cc-profile-panel" aria-labelledby="contest-history-title">
        <div className="cc-profile-section-title"><div><span className="cc-feature-eyebrow">MY CONTEST HISTORY</span><h2 id="contest-history-title">Entries by match</h2></div><label className="cc-profile-filter">Status <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">All statuses</option>{["OPEN", "WAITING", "FULL", "LOCKED", "COMPLETED", "SETTLED", "REFUNDED", "CANCELLED"].map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label></div>
        {contestError ? <p className="cc-profile-inline-error" role="alert">{contestError}</p> : loading ? <p className="cc-profile-muted">Loading your entries…</p> : !filteredGroups.length ? <p className="cc-profile-empty">No contests match this filter.</p> : <div className="cc-profile-match-groups">{filteredGroups.map(([key, group]) => <details className="cc-profile-match-group" key={key}>
          <summary><span><strong>{group.match ? group.match.teamA + " vs " + group.match.teamB : "Match details unavailable"}</strong><small>{group.match?.competition || group.match?.format || "Cricket"} · {group.contests.length} entr{group.contests.length === 1 ? "y" : "ies"}</small></span><span aria-hidden="true">⌄</span></summary>
          <div className="cc-profile-contest-list">{group.contests.map((contest) => {
            const players = Array.isArray(contest.players) ? contest.players : [];
            const own = players.find((player) => String(idOf(player.user)) === userId);
            const opponent = players.find((player) => String(idOf(player.user)) !== userId);
            const winner = idOf(contest.winnerId);
            const result = contest.settlementStatus === "REFUNDED" || contest.status === "REFUNDED" ? "Refunded" : contest.settlementStatus === "SETTLED" ? winner === userId ? "Won" : winner ? "Lost" : "Settled" : matchResultLabel(group.match);
            return <article className="cc-profile-contest-row" key={contest._id}><div><span>Match</span><strong>{group.match ? group.match.teamA + " vs " + group.match.teamB : "Match details unavailable"}</strong></div><div><span>Selected team</span><strong>{selectionLabel(own?.selectedTeam, group.match)}</strong></div><div><span>Opponent</span><strong>{opponent ? (typeof opponent.user === "object" ? opponent.user?.userId || "Player joined" : "Player joined") : "Waiting for opponent"}</strong></div><div><span>Entry fee</span><strong>{formatContestCoins(contest.entryFee)}</strong></div><div><span>Result</span><strong>{result}</strong></div><div><span>Status / settlement</span><strong>{statusLabel(contest.status)} · {statusLabel(contest.settlementStatus)}</strong></div></article>;
          })}</div>
        </details>)}</div>}
      </section>

      <section className="cc-profile-panel" aria-labelledby="transaction-history-title">
        <div className="cc-profile-section-title"><div><span className="cc-feature-eyebrow">TRANSACTION HISTORY</span><h2 id="transaction-history-title">Wallet activity</h2></div><span className="cc-profile-muted">Latest {transactions.length} records (up to 100)</span></div>
        {transactionError ? <p className="cc-profile-inline-error" role="alert">{transactionError}</p> : loading ? <p className="cc-profile-muted">Loading transactions…</p> : !transactions.length ? <p className="cc-profile-empty">No transactions yet.</p> : <><div className="cc-profile-table-wrap"><table className="cc-profile-transactions"><thead><tr><th>Type</th><th>Amount</th><th>Date</th><th>Status</th><th>Details</th></tr></thead><tbody>{pageTransactions.map((transaction) => <tr key={transaction._id}><td>{transactionLabel(transaction.type)}</td><td className={transaction.direction === "CREDIT" ? "credit" : "debit"}>{transaction.direction === "CREDIT" ? "+" : "−"}{formatContestCoins(transaction.amount)}</td><td>{dateLabel(transaction.createdAt || transaction.updatedAt)}</td><td><span className="cc-profile-status">{statusLabel(transaction.status)}</span></td><td>{transaction.description || transaction.reference || transaction.contest?.toString?.() || "—"}</td></tr>)}</tbody></table></div><div className="cc-profile-pagination"><span>Page {page} of {pages}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button type="button" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>Next</button></div></div></>}
      </section>

      <section className="cc-profile-panel" aria-labelledby="account-security-title">
        <div className="cc-profile-section-title"><div><span className="cc-feature-eyebrow">ACCOUNT SECURITY</span><h2 id="account-security-title">Sign-in and password</h2></div><Link className="cc-profile-link" to="/forgot-password">Change password <span aria-hidden="true">→</span></Link></div>
        <div className="cc-profile-security"><div><span>Last sign-in</span><strong>{dateLabel(user?.lastActivityAt)}</strong></div><p>Password changes are confirmed through the registered email address.</p></div>
      </section>
    </section>
  );
}

function Info({ label, value }) { return <div className="cc-profile-info-item"><span>{label}</span><strong>{value || "Not available"}</strong></div>; }
function Stat({ label, value }) { return <div className="cc-profile-stat"><strong>{value}</strong><span>{label}</span></div>; }
function transactionLabel(type) {
  const labels = { DEPOSIT: "Deposit", WITHDRAWAL: "Withdrawal", WITHDRAWAL_RELEASE: "Withdrawal release", CONTEST_ENTRY: "Contest entry fee", CONTEST_ENTRY_REVERSAL: "Entry fee refund", CONTEST_WINNING: "Winnings", CONTEST_REFUND: "Refund", REFUND: "Refund", ADMIN_ADJUSTMENT: "Account adjustment" };
  return labels[String(type || "").toUpperCase()] || statusLabel(type || "Transaction");
}
