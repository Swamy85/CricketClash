
import { useCallback, useEffect, useRef, useState } from "react";
import {
  NavLink,
  Outlet,
  useNavigate,
} from "react-router-dom";

import {
  adminFetch,
  getAdminSession,
  clearAdminSession,
} from "../services/adminSession";


const navigationItems = [
  { label: "Dashboard", icon: "▦", path: "/admin/dashboard" },
  { label: "Live Match Center", icon: "●", path: "/admin/live-center" },
  { label: "Matches", icon: "◉", path: "/admin/matches" },
  { label: "Contests", icon: "🏆", path: "/admin/contests" },
  { label: "Deposits", icon: "↓", path: "/admin/deposits" },
  { label: "Withdrawals", icon: "₹", path: "/admin/withdrawals" },
];


export default function AdminLayout() {
  const navigate = useNavigate();

  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const expiredSessionHandledRef = useRef(false);

  const loadAdmin = useCallback(async () => {
    if (!getAdminSession()) {
      navigate("/admin/login", { replace: true });
      return;
    }

    try {
      setError("");

      const response = await adminFetch("/api/admin/dashboard");
      const data = await response.json();

      if (response.status === 401 || response.status === 403) {
        clearAdminSession();
        navigate("/admin/login", { replace: true });
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || "Unable to load administrator details."
        );
      }

      setAdmin(data.admin);
    } catch (err) {
      setError(err.message || "Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadAdmin();
  }, [loadAdmin]);

  useEffect(() => {
    const handleExpiredAdminSession = () => {
      if (expiredSessionHandledRef.current) return;
      expiredSessionHandledRef.current = true;
      clearAdminSession();
      navigate("/admin/login?reason=expired", { replace: true });
    };

    window.addEventListener(
      "cricketclash:admin-session-expired",
      handleExpiredAdminSession
    );
    return () => {
      window.removeEventListener(
        "cricketclash:admin-session-expired",
        handleExpiredAdminSession
      );
    };
  }, [navigate]);

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setError("");

    try {
      const response = await adminFetch("/api/auth/logout", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Logout failed.");
      }

      clearAdminSession();
      navigate("/admin/login", { replace: true });
    } catch (err) {
      setError(err.message || "Unable to log out.");
      setLoggingOut(false);
    }
  }

  const openAdminProfile = () => {
    navigate("/admin/profile");
  };

  const adminInitial = (admin?.username || "A")
    .charAt(0)
    .toUpperCase();

  const adminId =
    admin?.adminId || admin?.userId || "Admin ID unavailable";

  if (loading) {
    return (
      <main className="admin-dashboard-loading">
        <div className="admin-dashboard-spinner" />
        <p>Verifying administrator access...</p>
      </main>
    );
  }

  return (
    <main className="admin-dashboard-page">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <NavLink
            to="/admin/dashboard"
            className="cc-brand cc-brand-link"
            aria-label="CricketClash admin dashboard"
          >
            <div className="cc-brand-mark" aria-hidden="true">
              C
            </div>

            <div className="cc-brand-wordmark">
              <div className="cc-brand-name">
                <span>Cricket</span>
                <span>Clash</span>
              </div>

              <span className="cc-brand-tagline">
                ADMIN PANEL
              </span>
            </div>
          </NavLink>

          <button
            type="button"
            className="admin-sidebar-profile"
            onClick={openAdminProfile}
            aria-label="Open administrator profile"
          >
            <div
              className="admin-profile-avatar"
              aria-hidden="true"
            >
              {adminInitial}
            </div>

            <div className="admin-sidebar-profile-info">
              <strong>
                {admin?.username || "Administrator"}
              </strong>
              <span>{adminId}</span>
            </div>

            <span
              className="admin-sidebar-profile-arrow"
              aria-hidden="true"
            >
              →
            </span>
          </button>
        </div>

        <p className="admin-sidebar-label">LOBBY</p>

        <nav
          className="admin-sidebar-nav"
          aria-label="Admin navigation"
        >
          {navigationItems.slice(0, 2).map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `admin-nav-item ${isActive ? "is-active" : ""}`
              }
            >
              <span
                className="admin-nav-icon"
                aria-hidden="true"
              >
                {item.icon}
              </span>

              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <p className="admin-sidebar-label">MANAGEMENT</p>
        <nav className="admin-sidebar-nav" aria-label="Admin management navigation">
          {navigationItems.slice(2).map((item) => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => `admin-nav-item ${isActive ? "is-active" : ""}`}>
              <span className="admin-nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-bottom">
          <div className="admin-sidebar-status">
            <span className="admin-status-dot" />
            Administrator session active
          </div>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-brand">
            <NavLink
              to="/admin/dashboard"
              className="cc-brand cc-brand-link cc-brand--compact"
              aria-label="Go to admin dashboard"
            >
              <div className="cc-brand-mark" aria-hidden="true">
                C
              </div>
            </NavLink>

            <span className="admin-topbar-divider" />
            <span className="admin-topbar-section">
              Administration
            </span>
          </div>

          <div className="admin-profile-group">
            <button
              type="button"
              className="admin-profile-link"
              onClick={openAdminProfile}
              aria-label="Open administrator profile"
            >
              <div
                className="admin-profile-avatar"
                aria-hidden="true"
              >
                {adminInitial}
              </div>

              <div className="admin-profile-link-info">
                <strong>
                  {admin?.username || "Administrator"}
                </strong>
                <span>Administrator</span>
              </div>

              <span
                className="admin-profile-link-arrow"
                aria-hidden="true"
              >
                →
              </span>
            </button>
          </div>
        </header>

        <div className="admin-dashboard-content">
          {error && (
            <div
              className="admin-dashboard-error"
              role="alert"
            >
              <span>{error}</span>

              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          <Outlet
            context={{
              admin,
              reloadAdmin: loadAdmin,
              handleLogout,
              loggingOut,
            }}
          />
        </div>
      </section>
    </main>
  );
}
