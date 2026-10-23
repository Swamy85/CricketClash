
import { Link, useLocation, useNavigate } from "react-router-dom";
import "../styles/footer.css";

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const location = useLocation();
  const navigate = useNavigate();

  function goToHome() {
    if (location.pathname === "/") {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    } else {
      navigate("/");
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }

  return (
    <footer className="site-footer">
      <div className="container footer-container">
        <div className="footer-main">
          {/* Brand */}
          <div className="footer-brand-section">
            <Link
              to="/"
              className="brand footer-brand"
              aria-label="CricketClash home"
              onClick={(event) => {
                event.preventDefault();
                goToHome();
              }}
            >
              <span className="brand-mark">C</span>
              <span>
                Cricket<span className="brand-accent">Clash</span>
              </span>
            </Link>

            <p className="footer-description">
              Two players. One cricket contest. Let the game begin.
              <span>
                Bring your cricket passion to every head-to-head matchup.
              </span>
            </p>
          </div>

          {/* Explore */}
          <nav className="footer-column" aria-label="Explore">
            <h3>Explore</h3>

            <a href="/" onClick={(event) => {
              event.preventDefault();
              goToHome();
            }}>
              Home
            </a>

            <Link to="/#how-it-works">How It Works</Link>
            <Link to="/#about">About CricketClash</Link>
          </nav>

          {/* Account */}
          <nav className="footer-column" aria-label="Your account">
            <h3>Your Account</h3>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </nav>

          {/* Support */}
          <nav className="footer-column" aria-label="Support">
            <h3>Support</h3>
            <Link to="/help">Help &amp; FAQs</Link>
            <Link to="/support">Contact &amp; Support</Link>
          </nav>

          {/* Legal */}
          <nav className="footer-column" aria-label="Legal">
            <h3>Legal</h3>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/responsible-play">Responsible Play</Link>
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="footer-bottom">
          <p className="footer-copy">
            © {currentYear} CricketClash. All rights reserved.
          </p>

          <p className="footer-disclaimer">
            Illustrative matchups are examples and do not represent live
            match information.
          </p>

          <button
            type="button"
            className="footer-back-to-top"
            onClick={goToHome}
          >
            Back to Home ↑
          </button>
        </div>
      </div>
    </footer>
  );
}
