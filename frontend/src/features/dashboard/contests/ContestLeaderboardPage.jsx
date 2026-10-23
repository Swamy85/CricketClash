import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { fetchContestPageData, formatContestCoins } from "./contestPageApi";
import "./MyContestsPage.css";

export default function ContestLeaderboardPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadLeaderboard() {
      setLoading(true);
      setError("");
      try {
        const data = await fetchContestPageData("/contests/leaderboard", controller.signal);
        setPlayers(Array.isArray(data.leaderboard) ? data.leaderboard : []);
      } catch (loadError) {
        if (loadError.name === "AbortError") return;
        if ([401, 403].includes(loadError.status)) {
          navigate("/login", { replace: true });
          return;
        }
        setError(loadError.message || "Unable to load the leaderboard.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadLeaderboard();
    return () => controller.abort();
  }, [navigate]);

  return (
    <section className="cc-feature-page cc-contests-page">
      <div className="cc-feature-heading cc-contest-detail-heading">
        <div>
          <span className="cc-feature-eyebrow">VERIFIED RESULTS</span>
          <h1>Leaderboard</h1>
          <p>Rankings include only completed contests with confirmed settlement.</p>
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
        <div className="cc-contest-state"><span className="cc-contest-spinner" /><p>Loading rankings…</p></div>
      ) : players.length === 0 ? (
        <div className="cc-feature-empty">No completed and settled contests are available to rank yet.</div>
      ) : (
        <div className="cc-leaderboard-table-wrap">
          <table className="cc-leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player ID</th>
                <th>Contests played</th>
                <th>Wins</th>
                <th>Win rate</th>
                <th>Total winnings</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player, index) => {
                const winRate = player.contestsPlayed
                  ? Math.round((player.wins / player.contestsPlayed) * 100)
                  : 0;
                return (
                  <tr
                    key={player.playerId}
                    className={player.playerId === user?.userId ? "current-player" : ""}
                  >
                    <td>{index + 1}</td>
                    <td>{player.playerId}</td>
                    <td>{player.contestsPlayed}</td>
                    <td>{player.wins}</td>
                    <td>{winRate}%</td>
                    <td>{formatContestCoins(player.winnings)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
