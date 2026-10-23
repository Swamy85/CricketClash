
import { useEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  useNavigate,
} from "react-router-dom";

import {
  adminFetch,
  getAdminSession,
  clearAdminSession,
} from "../../features/admin/services/adminSession";

export default function AdminRoute({
  children,
  guestOnly = false,
}) {
  const navigate = useNavigate();
  const [status, setStatus] = useState("checking");
  const [retryCount, setRetryCount] = useState(0);
  const [absoluteExpiresAt, setAbsoluteExpiresAt] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      const sessionId = getAdminSession();

      if (!sessionId) {
        setStatus("unauthenticated");
        return;
      }

      setStatus("checking");
      setAbsoluteExpiresAt(null);

      try {
        const response = await adminFetch(
          "/api/admin/dashboard"
        );
        const data = await response.json().catch(() => ({}));

        if (cancelled) return;

        if (response.ok && data.success) {
          setAbsoluteExpiresAt(data.session?.absoluteExpiresAt || null);
          setStatus("authenticated");
          return;
        }

        if (
          response.status === 401 ||
          response.status === 403
        ) {
          clearAdminSession();
          setStatus("expired");
          return;
        }

        setStatus("error");
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    }

    verifySession();

    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  useEffect(() => {
    if (status !== "authenticated" || !absoluteExpiresAt) return undefined;
    const expiresAt = Date.parse(absoluteExpiresAt);
    if (!Number.isFinite(expiresAt)) return undefined;
    const expireSession = () => {
      clearAdminSession();
      navigate("/admin/login?reason=expired", { replace: true });
    };
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      expireSession();
      return undefined;
    }
    const timer = window.setTimeout(expireSession, remaining);
    return () => window.clearTimeout(timer);
  }, [absoluteExpiresAt, navigate, status]);

  if (status === "checking") {
    return (
      <div className="route-status">
        <div className="route-status-card">
          <p>Verifying administrator access...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="route-status">
        <div className="route-status-card">
          <h2>Unable to verify session</h2>
          <p>
            The server could not verify your admin session.
            Check your connection and try again.
          </p>

          <button
            type="button"
            className="route-retry-button"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (guestOnly && status === "authenticated") {
    return (
      <Navigate
        to="/admin/dashboard"
        replace
      />
    );
  }

  if (status === "expired") {
    return (
      <Navigate
        to="/admin/login?reason=expired"
        replace
      />
    );
  }

  if (
    !guestOnly &&
    status !== "authenticated"
  ) {
    return (
      <Navigate
        to="/admin/login"
        replace
      />
    );
  }

  // Support both existing child-based routes
  // and new nested admin routes.
  return children ?? <Outlet />;
}
