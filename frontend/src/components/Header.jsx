
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "../styles/header.css";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState("explore");

  const location = useLocation();
  const navigate = useNavigate();

  function closeMenu() {
    setMenuOpen(false);
  }

  function toggleSection(section) {
    setExpandedSection((current) =>
      current === section ? "" : section
    );
  }

  // Navigate to the landing page and optionally scroll to a section.
  function navigateToSection(sectionId = "") {
    closeMenu();

    if (location.pathname !== "/" || location.hash) {
      navigate(sectionId ? `/#${sectionId}` : "/");
    } else if (sectionId) {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } else {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "smooth",
      });
    }
  }

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  return (
    <header className="site-header">
      <div className="container header-inner">
        {/* Mobile hamburger */}
        <div className="mobile-header-left">
          <button
            type="button"
            className="mobile-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        {/* CricketClash branding */}
        <Link
          to="/"
          className="brand"
          aria-label="CricketClash home"
          onClick={(event) => {
            if (location.pathname === "/" && !location.hash) {
              event.preventDefault();
              window.scrollTo({
                top: 0,
                left: 0,
                behavior: "smooth",
              });
            }
          }}
        >
          <span className="brand-mark">C</span>
          <span>
            Cricket<span className="brand-accent">Clash</span>
          </span>
        </Link>

        {/* Desktop navigation */}
        <nav className="desktop-nav" aria-label="Main navigation">
          <a
            href="/#home"
            onClick={(event) => {
              event.preventDefault();
              navigateToSection("home");
            }}
          >
            Home
          </a>

          <a
            href="/#how-it-works"
            onClick={(event) => {
              event.preventDefault();
              navigateToSection("how-it-works");
            }}
          >
            How it works
          </a>

          <a
            href="/#features"
            onClick={(event) => {
              event.preventDefault();
              navigateToSection("features");
            }}
          >
            Features
          </a>

          <a
            href="/#matches"
            onClick={(event) => {
              event.preventDefault();
              navigateToSection("matches");
            }}
          >
            Upcoming Matches
          </a>

          <a
            href="/#faqs"
            onClick={(event) => {
              event.preventDefault();
              navigateToSection("faqs");
            }}
          >
            FAQs
          </a>
        </nav>

        {/* Desktop account actions */}
        <div className="header-actions">
          <Link to="/login" className="login-link">
            Login
          </Link>

          <Link
            to="/register"
            className="button button-primary header-register"
          >
            Register <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {menuOpen && (
        <div
          className="mobile-menu-overlay"
          onClick={closeMenu}
        >
          <nav
            id="mobile-navigation"
            className="mobile-menu-drawer"
            aria-label="Mobile navigation"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Drawer heading */}
            <div className="drawer-header">
              <span className="drawer-title">Menu</span>

              <button
                type="button"
                className="drawer-close"
                aria-label="Close menu"
                onClick={closeMenu}
              >
                ×
              </button>
            </div>

            <div className="drawer-content">
              {/* Home */}
              <button
                type="button"
                className="drawer-main-link"
                onClick={() => navigateToSection("home")}
              >
                Home
              </button>

              {/* Explore */}
              <div className="drawer-section">
                <button
                  type="button"
                  className="drawer-section-toggle"
                  aria-expanded={expandedSection === "explore"}
                  onClick={() => toggleSection("explore")}
                >
                  <span>Explore</span>
                  <span className="drawer-chevron">
                    {expandedSection === "explore" ? "−" : "+"}
                  </span>
                </button>

                {expandedSection === "explore" && (
                  <div className="drawer-submenu">
                    <button
                      type="button"
                      onClick={() => navigateToSection("how-it-works")}
                    >
                      How it works
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToSection("about")}
                    >
                      Why CricketClash
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToSection("features")}
                    >
                      Features
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToSection("matches")}
                    >
                      Upcoming Matches
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToSection("faqs")}
                    >
                      FAQs
                    </button>
                  </div>
                )}
              </div>

              {/* Account */}
              <div className="drawer-section">
                <button
                  type="button"
                  className="drawer-section-toggle"
                  aria-expanded={expandedSection === "account"}
                  onClick={() => toggleSection("account")}
                >
                  <span>Account</span>
                  <span className="drawer-chevron">
                    {expandedSection === "account" ? "−" : "+"}
                  </span>
                </button>

                {expandedSection === "account" && (
                  <div className="drawer-submenu">
                    <Link to="/login" onClick={closeMenu}>
                      Login
                    </Link>

                    <Link to="/register" onClick={closeMenu}>
                      Register
                    </Link>
                  </div>
                )}
              </div>

              {/* Information */}
              <div className="drawer-section">
                <button
                  type="button"
                  className="drawer-section-toggle"
                  aria-expanded={expandedSection === "information"}
                  onClick={() => toggleSection("information")}
                >
                  <span>Information</span>
                  <span className="drawer-chevron">
                    {expandedSection === "information" ? "−" : "+"}
                  </span>
                </button>

                {expandedSection === "information" && (
                  <div className="drawer-submenu">
                    <button
                      type="button"
                      onClick={() => navigateToSection("how-it-works")}
                    >
                      Getting started
                    </button>

                    <button
                      type="button"
                      onClick={() => navigateToSection("about")}
                    >
                      About the platform
                    </button>
                  </div>
                )}
              </div>

              {/* Support */}
              <div className="drawer-section">
                <button
                  type="button"
                  className="drawer-section-toggle"
                  aria-expanded={expandedSection === "support"}
                  onClick={() => toggleSection("support")}
                >
                  <span>Support</span>
                  <span className="drawer-chevron">
                    {expandedSection === "support" ? "−" : "+"}
                  </span>
                </button>

                {expandedSection === "support" && (
                  <div className="drawer-submenu">
                    <Link to="/help" onClick={closeMenu}>
                      Help &amp; FAQs
                    </Link>

                    <Link to="/support" onClick={closeMenu}>
                      Contact &amp; Support
                    </Link>
                  </div>
                )}
              </div>

              {/* Legal */}
              <div className="drawer-section">
                <button
                  type="button"
                  className="drawer-section-toggle"
                  aria-expanded={expandedSection === "legal"}
                  onClick={() => toggleSection("legal")}
                >
                  <span>Legal</span>
                  <span className="drawer-chevron">
                    {expandedSection === "legal" ? "−" : "+"}
                  </span>
                </button>

                {expandedSection === "legal" && (
                  <div className="drawer-submenu">
                    <Link to="/terms" onClick={closeMenu}>
                      Terms of Service
                    </Link>

                    <Link to="/privacy" onClick={closeMenu}>
                      Privacy Policy
                    </Link>

                    <Link to="/responsible-play" onClick={closeMenu}>
                      Responsible Play
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Drawer footer */}
            <div className="drawer-footer">
              <p>New to CricketClash?</p>

              <Link
                to="/register"
                className="drawer-register"
                onClick={closeMenu}
              >
                Create your account
                <span aria-hidden="true">→</span>
              </Link>

              <span className="drawer-footer-note">
                Made for cricket fans
              </span>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
