
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
  const [error, setError] = useState("");
  const [matchesError, setMatchesError] = useState("");
  const [matchesLoading, setMatchesLoading] = useState(true);
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
    setError("");

    try {
      if (!user) {
        throw new Error("Account information was not returned.");
      }

      // Match data is shared across dashboard sections.
      setMatchesLoading(true);
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
          setMatchesLoading(false);
        }
      }
    } catch (err) {
      setMatchesLoading(false);
      setError(
        err.message || "Unable to load your dashboard."
      );
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
