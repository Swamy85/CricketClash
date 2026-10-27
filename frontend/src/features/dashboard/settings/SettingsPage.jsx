import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useAppSession } from "../../../context/SessionContext";
import { saveNotificationPreferences } from "../../auth/services/authService";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import "./SettingsPage.css";

const DEFAULT_PREFERENCES = {
  matchUpdates: true,
  contestUpdates: true,
  results: true,
  announcements: true,
};

const navItems = [
  ["account", "Account", "A"],
  ["notifications", "Notifications", "N"],
  ["privacy", "Privacy", "P"],
];

export default function SettingsPage() {
  const { user } = useOutletContext();
  const { logout } = useAppSession();
  const [preferences, setPreferences] = useState(() => ({
    ...DEFAULT_PREFERENCES,
    ...(user?.notificationPreferences || {}),
  }));
  const [savingPreference, setSavingPreference] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeType, setNoticeType] = useState("success");

  useEffect(() => {
    setPreferences({ ...DEFAULT_PREFERENCES, ...(user?.notificationPreferences || {}) });
  }, [user?.notificationPreferences]);

  function jumpTo(id) {
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function togglePreference(key, checked) {
    if (savingPreference) return;
    const previous = preferences;
    const next = { ...previous, [key]: checked };
    setPreferences(next);
    setSavingPreference(key);
    setNotice("");
    try {
      const result = await saveNotificationPreferences(next);
      setPreferences({ ...DEFAULT_PREFERENCES, ...result.preferences });
      setNotice("Notification preference saved.");
      setNoticeType("success");
    } catch (error) {
      setPreferences(previous);
      setNotice(error.message || "Could not save notification preference.");
      setNoticeType("error");
    } finally {
      setSavingPreference("");
    }
  }

  async function handleLogout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    await logout("manual");
  }

  const username = user?.username || "Player";
  const initial = username.trim().charAt(0).toUpperCase() || "P";
  const createdAt = user?.createdAt
    ? formatIndiaDateTime(user.createdAt, { dateStyle: "medium", timeStyle: "short" })
    : "Not available";

  return (
    <section className="cc-feature-page cc-settings-page">
      <header className="cc-settings-heading">
        <div>
          <span className="cc-feature-eyebrow">YOUR ACCOUNT</span>
          <h1>Settings</h1>
          <p>Manage your account, security, notifications and preferences.</p>
        </div>
      </header>

      {notice && <div className={`cc-settings-notice ${noticeType}`} role={noticeType === "error" ? "alert" : "status"}>{notice}</div>}

      <div className="cc-settings-layout">
        <aside className="cc-settings-rail">
          <section className="cc-settings-card cc-settings-identity">
            <div className="cc-settings-avatar" aria-hidden="true">{initial}</div>
            <strong>{username}</strong>
            <span>Player ID: {user?.userId || "Not available"}</span>
            <span className={`cc-settings-verified ${user?.isEmailVerified ? "verified" : "unverified"}`}>
              <span aria-hidden="true">{user?.isEmailVerified ? "\u2713" : "!"}</span>
              {user?.isEmailVerified ? "Email verified" : "Email not verified"}
            </span>
          </section>

          <nav className="cc-settings-card cc-settings-nav" aria-label="Settings sections">
            {navItems.map(([id, label, icon]) => (
              <button key={id} type="button" onClick={() => jumpTo(id)}>
                <span aria-hidden="true">{icon}</span>{label}<span className="cc-settings-chevron" aria-hidden="true">&rsaquo;</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="cc-settings-content">
          <section id="settings-account" className="cc-settings-card cc-settings-section">
            <SectionTitle icon="A" title="Profile & account" subtitle="Your verified CricketClash account details." />
            {user ? (
              <div className="cc-settings-account-grid">
                <ReadOnlyField label="Username" value={user.username} />
                <ReadOnlyField label="Email address" value={user.email} />
                <ReadOnlyField label="Unique user ID" value={user.userId} />
                <ReadOnlyField label="Account created" value={createdAt} />
              </div>
            ) : <p className="cc-settings-muted">Loading account information...</p>}
            <p className="cc-settings-helper">Account identity fields are managed by CricketClash and aren't editable here.</p>
          </section>
          <section id="settings-notifications" className="cc-settings-card cc-settings-section">
            <SectionTitle icon="N" title="Notification preferences" subtitle="Choose which in-app updates appear in your notifications." />
            <div className="cc-settings-toggle-list">
              <PreferenceToggle label="Match updates" detail="Live match updates and status changes." checked={preferences.matchUpdates} disabled={Boolean(savingPreference)} busy={savingPreference === "matchUpdates"} onChange={(checked) => togglePreference("matchUpdates", checked)} />
              <PreferenceToggle label="Contest updates" detail="Contest entries, opponents and availability." checked={preferences.contestUpdates} disabled={Boolean(savingPreference)} busy={savingPreference === "contestUpdates"} onChange={(checked) => togglePreference("contestUpdates", checked)} />
              <PreferenceToggle label="Results" detail="Match results and contest outcomes." checked={preferences.results} disabled={Boolean(savingPreference)} busy={savingPreference === "results"} onChange={(checked) => togglePreference("results", checked)} />
              <PreferenceToggle label="Announcements" detail="Deposit, withdrawal, payout and refund updates." checked={preferences.announcements} disabled={Boolean(savingPreference)} busy={savingPreference === "announcements"} onChange={(checked) => togglePreference("announcements", checked)} />
            </div>
            {savingPreference && <p className="cc-settings-helper" role="status">Saving preference...</p>}
          </section>

          <section id="settings-privacy" className="cc-settings-card cc-settings-section">
            <SectionTitle icon="P" title="Privacy & account" subtitle="Your account data stays protected by your signed-in session." />
            <p className="cc-settings-privacy-copy">Your profile identity and wallet information are shown only through authenticated CricketClash features. We don't expose password hashes or verification codes in account responses.</p>
            <div className="cc-settings-account-actions">
              <div><strong>Sign out</strong><span>End this session on this device.</span></div>
              <button type="button" className="cc-settings-secondary" onClick={handleLogout} disabled={logoutBusy}>{logoutBusy ? "Signing out..." : "Log out"}</button>
            </div>
            <div className="cc-settings-delete-note">
              <strong>Account deletion</strong>
              <span>Self-service deletion isn't available because accounts may be linked to wallet and contest records. Contact <Link to="/dashboard/contact">Support</Link> for an account review.</span>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ icon, title, subtitle }) {
  return <div className="cc-settings-section-title"><span className="cc-settings-icon" aria-hidden="true">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function ReadOnlyField({ label, value }) {
  return <div className="cc-settings-field"><span>{label}</span><strong>{value || "Not available"}</strong></div>;
}

function PreferenceToggle({ label, detail, checked, disabled, busy, onChange }) {
  return (
    <label className="cc-settings-toggle-row">
      <span className="cc-settings-toggle-copy"><strong>{label}</strong><small>{detail}{busy ? " Saving..." : ""}</small></span>
      <input type="checkbox" role="switch" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="cc-settings-switch" aria-hidden="true" />
    </label>
  );
}
