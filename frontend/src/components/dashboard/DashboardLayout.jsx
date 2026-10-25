
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Outlet,
  useLocation,
} from "react-router-dom";

import { useAppSession } from "../../context/SessionContext";
import DashboardSidebar from "./DashboardSidebar";
import DashboardTopbar from "./DashboardTopbar";
import { getMatches } from "../../services/matchService";
import JoinTelegramButton from "../JoinTelegramButton";

export default function DashboardLayout() {
  const { user } = useAppSession();
  const { pathname } = useLocation();
  const showJoinTelegram = pathname.replace(/\/$/, "") === "/dashboard";

  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [matchesError, setMatchesError] = useState("");
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchesRefreshing, setMatchesRefreshing] = useState(false);
  const [matchesRefreshNotice, setMatchesRefreshNotice] = useState("");
  const matchesRequestRef = useRef(null);

  const refreshMatches = useCallback(async ({ silent = false } = {}) => {
    if (matchesRequestRef.current) return;

    const controller = new AbortController();
    matchesRequestRef.current = controller;

    if (!silent) {
      setMatchesRefreshing(true);
      setMatchesRefreshNotice("");
      setMatchesError("");
    }

    try {
      const result = await getMatches({ signal: controller.signal });
      setMatches(result);
      setMatchesError("");
      if (!silent) setMatchesRefreshNotice("Matches updated.");
    } catch (err) {
      if (!silent && err.name !== "AbortError") {
        setMatchesError(err.message || "Unable to load matches.");
      }
    } finally {
      if (matchesRequestRef.current === controller) {
        matchesRequestRef.current = null;
        if (!silent) setMatchesRefreshing(false);
      }
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      if (!user) {
        throw new Error("Account information was not returned.");
      }

      // Match data is shared across dashboard sections.
      const matchController = new AbortController();
      if (matchesRequestRef.current) matchesRequestRef.current.abort();
      matchesRequestRef.current = matchController;
      try {
        const result = await getMatches({ signal: matchController.signal });
        setMatches(result);
        setMatchesError("");
      } catch (err) {
        if (err.name !== "AbortError") {
          setMatchesError(err.message || "Unable to load matches.");
        }
      } finally {
        if (matchesRequestRef.current === matchController) {
          matchesRequestRef.current = null;
        }
      }
    } catch (err) {
      setError(
        err.message || "Unable to load your dashboard."
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadDashboard();
    return () => {
      const request = matchesRequestRef.current;
      matchesRequestRef.current = null;
      request?.abort();
    };
  }, [loadDashboard]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshMatches({ silent: true });
    }, 15_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshMatches]);

  if (loading) {
    return (
      <div className="cc-dashboard-loading">
        <div className="cc-loading-mark">C</div>
        <div className="cc-loading-spinner" />
        <p>Setting up your CricketClash lobby...</p>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="cc-dashboard-loading">
        <div className="cc-dashboard-error" role="alert">
          <h2>We couldn't load your dashboard</h2>
          <p>{error}</p>
          <button type="button" onClick={loadDashboard}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`cc-dashboard${showJoinTelegram ? " cc-dashboard--telegram" : ""}`}>
      <DashboardTopbar />

      <div className="cc-dashboard-body">
        <DashboardSidebar user={user} />

        <main className="cc-dashboard-main">
          {error && (
            <div className="cc-feature-alert" role="alert">
              {error}
              <button type="button" onClick={loadDashboard}>
                Retry
              </button>
            </div>
          )}

          <Outlet
            context={{
              user,
              matches,
              refreshMatches,
              matchesLoading,
              matchesError,
              matchesRefreshing,
              matchesRefreshNotice,
            }}
          />
        </main>
      </div>
      {showJoinTelegram && <JoinTelegramButton />}
    </div>
  );
}
