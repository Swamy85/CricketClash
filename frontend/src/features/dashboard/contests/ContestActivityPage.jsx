import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import {
  fetchContestPageData,
  formatContestCoins,
  matchResultLabel,
} from "./contestPageApi";
import "./MyContestsPage.css";

function getUserId(player) {
  return typeof player?.user === "object" ? player.user?.userId : player?.user;
}

function getSelectedTeamLabel(selection, match) {
  if (selection === "A") return match?.teamA || "Team A";
  if (selection === "B") return match?.teamB || "Team B";
  return "—";
}

export default function ContestActivityPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [searchParams] = useSearchParams();
  const matchFilter = searchParams.get("matchId");
  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadActivity() {
      setLoading(true);
      setError("");
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
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadActivity();
    return () => controller.abort();
  }, [navigate]);

  const visibleContests = contests.filter((contest) =>
    !matchFilter || String(contest.match?._id || contest.match) === matchFilter
  );
  const groupedContests = visibleContests.reduce((groups, contest) => {
    const match = typeof contest.match === "object" ? contest.match : null;
    const key = String(match?._id || contest.match || "unknown-match");
    if (!groups.has(key)) groups.set(key, { match, contests: [] });
    groups.get(key).contests.push(contest);
    return groups;
  }, new Map());

  return (
    <section className="cc-feature-page cc-contests-page">
      <div className="cc-feature-heading cc-contest-detail-heading">
        <div>
          <span className="cc-feature-eyebrow">YOUR CONTEST ACTIVITY</span>
          <h1>Contest activity</h1>
          <p>Review your contest entries, opponents, selections, results, and settlements.</p>
        </div>
        <button
          type="button"
          className="cc-button cc-button-maroon"
          onClick={() => navigate("/dashboard/contests")}
        >
          Back to contests
        </button>
      </div>

      {error && <div className="cc-contest-error" role="alert">{error}</div>}
      {loading ? (
        <div className="cc-contest-state"><span className="cc-contest-spinner" /><p>Loading activity…</p></div>
      ) : visibleContests.length === 0 ? (
        <div className="cc-feature-empty">You have not joined a contest{matchFilter ? " for this match" : ""} yet.</div>
      ) : (
        <div className="cc-contest-match-groups">
          {[...groupedContests].map(([matchId, group]) => (
            <details className="cc-contest-match-group" key={matchId}>
              <summary>
                <span>
                  <strong>{group.match ? `${group.match.teamA} vs ${group.match.teamB}` : "Match details unavailable"}</strong>
                  <small>{group.match?.format || "Cricket"} · Match {group.match?.status || "status unavailable"} · {group.contests.length} contest(s)</small>
                </span>
                <span className="cc-contest-group-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div className="cc-my-contest-list">
          {group.contests.map((contest) => {
            const match = typeof contest.match === "object" ? contest.match : null;
            const ownPlayer = contest.players?.find((player) =>
              String(getUserId(player)) === String(user?.userId || "")
            );
            const opponent = contest.players?.find((player) =>
              String(getUserId(player)) !== String(user?.userId || "")
            );
            const winnerId = typeof contest.winnerId === "object"
              ? contest.winnerId?.userId
              : contest.winnerId;
            const settledWin = contest.settlementStatus === "SETTLED"
              && String(winnerId || "") === String(user?.userId || "");
            const settledLoss = contest.settlementStatus === "SETTLED"
              && Boolean(winnerId)
              && !settledWin;
            const isRefunded = contest.status === "REFUNDED"
              || contest.settlementStatus === "REFUNDED";
            const opponentId = getUserId(opponent);

            return (
              <article
                className={`cc-my-contest-row cc-contest-activity-row ${settledWin ? "winner" : ""} ${settledLoss ? "loser" : ""}`}
                key={contest._id}
              >
                <div>
                  <span>Contest · {contest.tier}</span>
                  <strong>{match ? `${match.teamA} vs ${match.teamB}` : "Match details unavailable"}</strong>
                  <small>{match?.format || "Cricket"} · {match?.startTime ? formatIndiaDateTime(match.startTime) : "Time unavailable"}</small>
                </div>
                <div>
                  <span>Selected team</span>
                  <strong>{getSelectedTeamLabel(ownPlayer?.selectedTeam, match)}</strong>
                  <small>Joined {ownPlayer?.joinedAt ? formatIndiaDateTime(ownPlayer.joinedAt) : "—"}</small>
                </div>
                <div>
                  <span>Opponent</span>
                  <strong>{opponentId || (contest.players?.length === 1 ? "Waiting for opponent" : "No opponent")}</strong>
                  <small>{getSelectedTeamLabel(opponent?.selectedTeam, match)}</small>
                </div>
                <div>
                  <span>Match result</span>
                  <strong>{matchResultLabel(match)}</strong>
                  <small>Contest {contest.status} · Match {match?.status || "status unavailable"} · {contest.settlementStatus}</small>
                </div>
                <div>
                  <span>Entry and prize</span>
                  <strong>{formatContestCoins(contest.entryFee)} entry</strong>
                  <small>Prize pool {formatContestCoins(contest.prizePool)}</small>
                </div>
                <div>
                  <span>Your outcome</span>
                  <strong>
                    {settledWin
                      ? `Won · ${formatContestCoins(contest.winnerPayout)}`
                      : settledLoss
                        ? "Lost"
                        : isRefunded
                          ? `Refund ${ownPlayer?.refundStatus || "pending"}`
                          : "Pending settlement"}
                  </strong>
                  <small>
                    {isRefunded
                      ? `Refunded ${formatContestCoins(contest.entryFee)}`
                      : `Payout ${formatContestCoins(contest.winnerPayout)}`}
                  </small>
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
  );
}
