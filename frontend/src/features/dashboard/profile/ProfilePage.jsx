import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { useAppSession } from "../../../context/SessionContext";
import { formatIndiaDateTime } from "../../../utils/dateTime";
import { fetchContestPageData } from "../contests/contestPageApi";
import "./ProfilePage.css";

const dateLabel = (value) => value
  ? formatIndiaDateTime(value, { dateStyle: "medium", timeStyle: "short" })
  : "Not available";

export default function ProfilePage() {
  const { user } = useOutletContext();
  const { logout } = useAppSession();
  const navigate = useNavigate();
  const [contests, setContests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contestError, setContestError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadContestStats() {
      setLoading(true);
      setContestError("");
      try {
        const result = await fetchContestPageData("/contests/mine", controller.signal);
        if (controller.signal.aborted) return;
        setContests(Array.isArray(result.contests) ? result.contests : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        if ([401, 403].includes(error?.status)) {
          navigate("/login", { replace: true });
          return;
        }
        setContestError(error?.message || "Contest statistics could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadContestStats();
    return () => controller.abort();
  }, [navigate]);

  const stats = useMemo(() => ({
    total: contests.length,
    completed: contests.filter((contest) => ["SETTLED", "REFUNDED"].includes(contest.settlementStatus)).length,
  }), [contests]);

  return (
    <section className="cc-feature-page cc-profile-complete">
      <header className="cc-profile-heading">
        <div>
          <span className="cc-feature-eyebrow">YOUR ACCOUNT</span>
          <h1>Player profile</h1>
          <p>Your CricketClash profile, contest record, and account activity.</p>
        </div>
      </header>

      <section className="cc-profile-panel" aria-labelledby="profile-info-title">
        <div className="cc-profile-section-title">
          <div><span className="cc-feature-eyebrow">PROFILE INFORMATION</span><h2 id="profile-info-title">Account details</h2></div>
          <span className="cc-profile-readonly">Verified account data</span>
        </div>
        <div className="cc-profile-info-grid">
          <Info label="Player ID" value={user?.userId} />
          <Info label="Username" value={user?.username} />
          <Info label="Registered email" value={user?.email} />
          <Info label="Account created" value={dateLabel(user?.createdAt)} />
          <Info label="Account status" value={user?.isEmailVerified ? "Active · email verified" : "Active · email unverified"} />
        </div>
        <p className="cc-profile-note">Profile identity fields are managed by CricketClash and cannot be edited here.</p>
      </section>

      <section className="cc-profile-panel" aria-labelledby="contest-stats-title">
        <div className="cc-profile-section-title">
          <div><span className="cc-feature-eyebrow">CONTEST STATISTICS</span><h2 id="contest-stats-title">Your record</h2></div>
        </div>
        {contestError
          ? <p className="cc-profile-inline-error" role="alert">{contestError}</p>
          : loading
            ? <p className="cc-profile-muted">Loading contest statistics…</p>
            : <div className="cc-profile-stats">
              <Stat label="Contest entries" value={stats.total} />
              <Stat label="Completed" value={stats.completed} />
            </div>}
      </section>

      <section className="cc-profile-panel" aria-labelledby="account-security-title">
        <div className="cc-profile-section-title">
          <div><span className="cc-feature-eyebrow">ACCOUNT SECURITY</span><h2 id="account-security-title">Sign-in and password</h2></div>
          <Link className="cc-profile-link" to="/forgot-password">Change password <span aria-hidden="true">→</span></Link>
        </div>
        <div className="cc-profile-security">
          <div><span>Last sign-in</span><strong>{dateLabel(user?.lastActivityAt)}</strong></div>
          <p>Password changes are confirmed through the registered email address.</p>
        </div>
      </section>

      <footer className="cc-profile-signout" aria-label="Account sign out">
        <div>
          <h2>Sign out</h2>
          <p>End your CricketClash session on this device.</p>
        </div>
        <button type="button" className="cc-button cc-button-maroon" onClick={() => logout("manual")}>
          Log out
        </button>
      </footer>
    </section>
  );
}

function Info({ label, value }) {
  return <div className="cc-profile-info-item"><span>{label}</span><strong>{value || "Not available"}</strong></div>;
}

function Stat({ label, value }) {
  return <div className="cc-profile-stat"><strong>{value}</strong><span>{label}</span></div>;
}
