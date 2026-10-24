
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import SessionTimeoutModal from "../components/SessionTimeoutModal";

import {
  SESSION_STORAGE_KEY,
  getCurrentUser,
  recordSessionActivity,
  logoutCurrentSession,
} from "../features/auth/services/authService";
import { PLAYER_ACTIVITY_KEY } from "../features/auth/services/sessionKeys.js";
import { restoreValidatedSession } from "../features/auth/services/sessionRestore.js";

const SessionContext = createContext(null);

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_AT_MS = 14 * 60 * 1000;
const SESSION_CHECK_TIMEOUT_MS = 10000;
const ACTIVITY_KEY = PLAYER_ACTIVITY_KEY;

export function SessionProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminArea = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const [status, setStatus] = useState(() =>
    sessionStorage.getItem(SESSION_STORAGE_KEY)
      ? "checking"
      : "unauthenticated"
  );
  const [user, setUser] = useState(null);

  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [busy, setBusy] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const lastActivityRef = useRef(
    Number(sessionStorage.getItem(ACTIVITY_KEY)) || Date.now()
  );
  const absoluteExpiryRef = useRef(null);

  const loggingOutRef = useRef(false);
  const checkingRef = useRef(false);
  const stayingLoggedInRef = useRef(false);

  const clearLocalSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
    absoluteExpiryRef.current = null;

    setWarningOpen(false);
    setStatus("unauthenticated");
    setSessionError("");
    setUser(null);
  }, []);

  // Validate the current session against the backend.
  const checkSession = useCallback(async () => {
    if (checkingRef.current) {
      return false;
    }

    if (!sessionStorage.getItem(SESSION_STORAGE_KEY)) {
      clearLocalSession();
      return false;
    }

    checkingRef.current = true;
    setStatus("checking");
    const sessionIdAtCheck = sessionStorage.getItem(SESSION_STORAGE_KEY);

    const controller = new AbortController();

    const timeout = window.setTimeout(() => {
      controller.abort();
    }, SESSION_CHECK_TIMEOUT_MS);

    try {
      const restored = await restoreValidatedSession(
        sessionStorage,
        () => getCurrentUser({ signal: controller.signal }),
        Date.now()
      );

      // Do not apply a response for a session that was replaced mid-request.
      if (!restored.valid) {
        if (sessionStorage.getItem(SESSION_STORAGE_KEY) !== sessionIdAtCheck && sessionStorage.getItem(SESSION_STORAGE_KEY)) {
          return false;
        }
        clearLocalSession();
        return false;
      }

      lastActivityRef.current = restored.checkedAt;
      sessionStorage.setItem(ACTIVITY_KEY, String(restored.checkedAt));
      absoluteExpiryRef.current = restored.absoluteExpiresAt;

      setUser(restored.user);
      setStatus("authenticated");
      return true;
    } catch (error) {
      if (sessionStorage.getItem(SESSION_STORAGE_KEY) !== sessionIdAtCheck) {
        return false;
      }
      if (
        error.status === 401 ||
        error.status === 403 ||
        error.code === "SESSION_TIMEOUT"
      ) {
        clearLocalSession();

        if (error.code === "SESSION_TIMEOUT") {
          sessionStorage.setItem("cc_logout_reason", "timeout");
        }
      } else {
        // Network errors and server errors are not
        // automatically treated as invalid credentials.
        setStatus("error");
      }

      return false;
    } finally {
      window.clearTimeout(timeout);
      checkingRef.current = false;
    }
  }, [clearLocalSession]);

  // Call only after the backend has successfully authenticated login.
  const startSession = useCallback(() => {
    const now = Date.now();

    lastActivityRef.current = now;
    absoluteExpiryRef.current = null;

    sessionStorage.setItem(ACTIVITY_KEY, String(now));

    setWarningOpen(false);
    setStatus("authenticated");

    loggingOutRef.current = false;

    return true;
  }, []);

  // Log out on the server, clear local state, and replace history.
  const logout = useCallback(
    async (reason = "manual") => {
      if (loggingOutRef.current) {
        return;
      }

      loggingOutRef.current = true;

      try {
        await logoutCurrentSession();
      } catch (error) {
        console.error("Server logout failed:", error);
      } finally {
        sessionStorage.setItem("cc_logout_reason", reason);

        clearLocalSession();

        const loginPath = reason === "timeout"
          ? "/login?reason=timeout"
          : reason === "expired"
            ? "/login?reason=expired"
            : "/login";
        navigate(loginPath, { replace: true });
      }
    },
    [clearLocalSession, navigate]
  );

  const stayLoggedIn = useCallback(async () => {
    if (stayingLoggedInRef.current) {
      return;
    }

    stayingLoggedInRef.current = true;
    setBusy(true);
    setSessionError("");

    try {
      await recordSessionActivity();

      const now = Date.now();

      lastActivityRef.current = now;

      sessionStorage.setItem(ACTIVITY_KEY, String(now));

      setWarningOpen(false);
      setSecondsRemaining(60);
      setStatus("authenticated");
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.code === "SESSION_TIMEOUT") {
        const reason = error.code === "SESSION_TIMEOUT" ? "timeout" : "expired";
        sessionStorage.setItem("cc_logout_reason", reason);
        clearLocalSession();
        navigate(
          reason === "timeout"
            ? "/login?reason=timeout"
            : "/login?reason=expired",
          { replace: true }
        );
      } else {
        setSessionError(
          "We couldn't refresh your session because the server is unavailable. Check your connection and try again."
        );
      }
    } finally {
      stayingLoggedInRef.current = false;
      setBusy(false);
    }
  }, [clearLocalSession, navigate]);

  // Track activity for the inactivity timer.
  useEffect(() => {
    const markActivity = () => {
      if (
        !sessionStorage.getItem(SESSION_STORAGE_KEY) ||
        warningOpen ||
        isAdminArea
      ) {
        return;
      }

      const now = Date.now();

      lastActivityRef.current = now;

      sessionStorage.setItem(ACTIVITY_KEY, String(now));
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    events.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, {
        passive: true,
      });
    });

    return () => {
      events.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
    };
  }, [warningOpen, isAdminArea]);

  // Inactivity warning and timeout.
  useEffect(() => {
    const tick = async () => {
      if (
        !sessionStorage.getItem(SESSION_STORAGE_KEY) ||
        status !== "authenticated" ||
        isAdminArea ||
        stayingLoggedInRef.current
      ) {
        return;
      }

      const elapsed = Date.now() - lastActivityRef.current;

      if (absoluteExpiryRef.current && Date.now() >= absoluteExpiryRef.current) {
        await logout("expired");
        return;
      }

      if (elapsed >= IDLE_TIMEOUT_MS) {
        if (sessionError) {
          setWarningOpen(true);
          setSecondsRemaining(0);
          return;
        }
        await logout("timeout");
        return;
      }

      if (elapsed >= WARNING_AT_MS) {
        setSecondsRemaining(
          Math.max(
            0,
            Math.ceil((IDLE_TIMEOUT_MS - elapsed) / 1000)
          )
        );

        setWarningOpen(true);
      }
    };

    const timer = window.setInterval(tick, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [status, logout, sessionError, isAdminArea]);

  // Initial session validation.
  useEffect(() => {
    if (isAdminArea) {
      if (status === "checking") setStatus("unauthenticated");
      setWarningOpen(false);
      return;
    }
    if (sessionStorage.getItem(SESSION_STORAGE_KEY)) {
      void checkSession();
    } else {
      setStatus("unauthenticated");
    }
  }, [checkSession, isAdminArea]);

  // Handle browser Back/Forward cache restoration.
  useEffect(() => {
    const handlePageShow = (event) => {
      if (!event.persisted || isAdminArea) {
        return;
      }

      // A restored dashboard must never be trusted by itself.
      if (!sessionStorage.getItem(SESSION_STORAGE_KEY)) {
        clearLocalSession();
        return;
      }

      // Revalidate the session against the backend.
      void checkSession();
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [checkSession, clearLocalSession, isAdminArea]);

  useEffect(() => {
    const handleSessionExpired = (event) => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      const reason = event.detail?.code === "SESSION_TIMEOUT"
        ? "timeout"
        : "expired";
      sessionStorage.setItem("cc_logout_reason", reason);
      clearLocalSession();
      navigate(
        reason === "timeout"
          ? "/login?reason=timeout"
          : "/login?reason=expired",
        { replace: true }
      );
    };

    window.addEventListener("cricketclash:session-expired", handleSessionExpired);
    return () => {
      window.removeEventListener("cricketclash:session-expired", handleSessionExpired);
    };
  }, [clearLocalSession, navigate]);

  const value = useMemo(
    () => ({
      status,
      user,
      setStatus,
      checkSession,
      startSession,
      logout,
      stayLoggedIn,
    }),
    [
      status,
      user,
      checkSession,
      startSession,
      logout,
      stayLoggedIn,
    ]
  );

  return (
    <SessionContext.Provider value={value}>
      {children}

      <SessionTimeoutModal
        open={warningOpen}
        secondsRemaining={secondsRemaining}
        onStayLoggedIn={stayLoggedIn}
        onLogout={() => logout("manual")}
        busy={busy}
        error={sessionError}
      />
    </SessionContext.Provider>
  );
}

export function useAppSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error(
      "useAppSession must be used inside SessionProvider."
    );
  }

  return context;
}
