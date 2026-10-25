
import { NavLink } from "react-router-dom";

const links = [
  { to: "/dashboard", label: "Lobby", icon: "⌂", end: true },
  { to: "/dashboard/matches", label: "Matches", icon: "🏏" },
  { to: "/dashboard/contests", label: "My Contests", icon: "⚔" },
  { to: "/dashboard/wallet", label: "Wallet", icon: "₹" },
  { to: "/dashboard/profile", label: "Profile", icon: "♙" },
  { to: "/dashboard/contact", label: "Contact Us", icon: "@" },
];

export default function DashboardSidebar({ user }) {
  const username = user?.username || "Player";
  const initial = username.charAt(0).toUpperCase();

  return (
    <aside className="cc-dashboard-sidebar">
      <div className="cc-sidebar-label">YOUR SPACE</div>

      <nav className="cc-sidebar-nav" aria-label="Dashboard sections">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `cc-sidebar-link ${isActive ? "active" : ""}`
            }
          >
            <span className="cc-sidebar-icon">{link.icon}</span>
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>

      <NavLink
        to="/dashboard/profile"
        className={({ isActive }) =>
          `cc-account-link ${isActive ? "active" : ""}`
        }
        aria-label="Open your profile"
      >
        <span className="cc-account-avatar">{initial}</span>

        <span className="cc-account-info">
          <strong>{username}</strong>
          <small>View your profile ↗</small>
        </span>

        <span className="cc-account-arrow" aria-hidden="true">
          →
        </span>
      </NavLink>
    </aside>
  );
}
