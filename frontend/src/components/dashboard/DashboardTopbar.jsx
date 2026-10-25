
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notifySessionExpired } from "../../features/auth/services/authService";
import { formatIndiaDateTime } from "../../utils/dateTime";

export default function DashboardTopbar() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const requestRef = useRef(null);
  const notificationMenuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!notificationMenuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const loadNotifications = useCallback(async () => {
    if (requestRef.current) return;
    const sessionId = sessionStorage.getItem("cc_session_id");
    if (!sessionId) return;

    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/notifications`,
        {
          headers: { "X-CricketClash-Session": sessionId },
          cache: "no-store",
          signal: controller.signal,
        }
      );
      const data = await response.json();

      notifySessionExpired(response, data);
      if (response.ok && data.success) {
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      }
    } catch {
      // Background notification polling is intentionally silent.
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 10_000);
    return () => {
      window.clearInterval(timer);
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
    };
  }, [loadNotifications]);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  async function markAllRead() {
    const sessionId = sessionStorage.getItem("cc_session_id");
    if (!sessionId) return;

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/notifications/read-all`,
        {
          method: "PATCH",
          headers: { "X-CricketClash-Session": sessionId },
        }
      );
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to mark notifications as read.");
      }

      setNotifications((current) =>
        current.map((notification) => ({
          ...notification,
          readAt: notification.readAt || new Date().toISOString(),
        }))
      );
    } catch (error) {
      console.error("Unable to mark notifications as read:", error);
    }
  }

  return (
    <header className="cc-dashboard-topbar">
      <button
        type="button"
        className="cc-dashboard-brand"
        onClick={() => navigate("/dashboard")}
        aria-label="Go to CricketClash lobby"
      >
        <span className="cc-brand-mark">C</span>
        <span>
          Cricket<span>Clash</span>
        </span>
      </button>

      <div className="cc-topbar-status">
        <span className="cc-online-dot" />
        Player lobby
      </div>

      <div className="cc-notification-menu" ref={notificationMenuRef}>
        <button
          type="button"
          className="cc-notification-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          Notifications
          {unreadCount > 0 && <span>{unreadCount}</span>}
        </button>
        {open && (
          <section className="cc-notification-panel" aria-label="Notifications">
            <header>
              <strong>Recent updates</strong>
              {unreadCount > 0 && (
                <button type="button" onClick={markAllRead}>Mark all read</button>
              )}
            </header>
            {notifications.length === 0 ? (
              <p>No notifications yet.</p>
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <li
                    key={notification._id}
                    className={notification.readAt ? "" : "unread"}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{formatIndiaDateTime(notification.createdAt)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </header>
  );
}
