import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { getMatches, getTeamCatalog } from "../services/matchService";
import { formatIndiaDateTime } from "../utils/dateTime";

const steps = [
  {
    number: "01",
    icon: "✦",
    title: "Create and verify your account",
    description: "Register with your email and username, then verify your email to get started.",
  },
  {
    number: "02",
    icon: "◷",
    title: "Choose an upcoming match",
    description: "Browse scheduled fixtures and open a match to see its available contests.",
  },
  {
    number: "03",
    icon: "⚑",
    title: "Choose a contest and side",
    description: "Review the contest terms and select the team you think will win.",
  },
  {
    number: "04",
    icon: "✓",
    title: "Follow the verified result",
    description: "Compete against an opponent choosing the other side and follow the published result.",
  },
];

const features = [
  {
    icon: "🏏",
    title: "Head-to-head contests",
    description: "Each contest is designed for two distinct players competing against one another.",
    theme: "feature-green",
  },
  {
    icon: "⚑",
    title: "Opposing team choices",
    description: "Players select opposite teams, keeping the contest focused on the match outcome.",
    theme: "feature-red",
  },
  {
    icon: "◇",
    title: "Contest tiers",
    description: "Explore available categories with their configured entry fees and prize pools.",
    theme: "feature-gold",
  },
  {
    icon: "▤",
    title: "Clear contest details",
    description: "Check entry fees, prize pools, open player slots, and contest status before joining.",
    theme: "feature-green",
  },
  {
    icon: "✓",
    title: "Published outcomes",
    description: "Follow confirmed match results and the contest settlement status.",
    theme: "feature-red",
  },
  {
    icon: "◉",
    title: "Wallet records",
    description: "Review wallet activity and transaction history from your account.",
    theme: "feature-gold",
  },
];

const faqs = [
  {
    question: "What is CricketClash?",
    answer: "CricketClash is a cricket contest platform where two players choose opposing teams for a scheduled match.",
  },
  {
    question: "How do head-to-head contests work?",
    answer: "A contest has two player places. Each participant chooses one of the two teams, and both choices must oppose each other. Check the contest details and rules before joining.",
  },
  {
    question: "How do I choose a team?",
    answer: "Open an upcoming match, choose an available contest, and select one of its two competing teams. A team already selected by your opponent cannot be selected again in that contest.",
  },
  {
    question: "How are winners determined?",
    answer: "The official match result recorded for the fixture determines the outcome. A tie or no-result is handled according to the contest settlement rules.",
  },
  {
    question: "How are contest results and payouts handled?",
    answer: "Eligible contests are settled once the match result is finalized. Contest details and wallet transaction history show the relevant settlement or refund activity.",
  },
  {
    question: "How do deposits and withdrawals work?",
    answer: "Deposit requests are reviewed before coins are credited. Withdrawal requests reserve available coins while pending and are processed following review. You can review request status in your wallet.",
  },
  {
    question: "How can I reset my password?",
    answer: "Choose “Forgot Password?” on the login page, request a code by email, verify the six-digit code, and set a new password.",
  },
  {
    question: "How can I contact support?",
    answer: "Use the Contact & Support page to submit a support request. CricketClash does not publish an unverified support email address.",
  },
];

function formatMatchDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Schedule unavailable"
    : formatIndiaDateTime(date, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function formatCountdown(value, now) {
  const minutes = Math.max(0, Math.ceil((new Date(value).getTime() - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "Starting soon";
}

function teamInitials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function LandingPage() {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [clockNow, setClockNow] = useState(Date.now());
  const requestRef = useRef(null);
  const teamCatalogLoadedRef = useRef(false);
  const upcomingMatches = matches
    .filter((match) =>
      String(match.status || "").toLowerCase() === "upcoming" &&
      Number.isFinite(new Date(match.startTime).getTime()) &&
      new Date(match.startTime).getTime() > Date.now()
    )
    .sort((matchA, matchB) =>
      new Date(matchA.startTime).getTime() - new Date(matchB.startTime).getTime()
    );
  const teamDetails = (name) => {
    const normalizedName = String(name || "").trim().toLowerCase();
    return teams.find((team) =>
      [team.name, team.shortName, ...(team.aliases || [])]
        .some((candidate) => String(candidate || "").trim().toLowerCase() === normalizedName)
    );
  };
  const nextMatch = upcomingMatches[0] || null;

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadMatches = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const requests = [getMatches({ signal: controller.signal })];
      if (!teamCatalogLoadedRef.current) {
        requests.push(getTeamCatalog({ signal: controller.signal }));
      }
      const [matchResult, teamResult] = await Promise.allSettled(requests);
      if (matchResult.status === "rejected") throw matchResult.reason;
      setMatches(matchResult.value);
      if (teamResult?.status === "fulfilled") {
        setTeams(teamResult.value);
        teamCatalogLoadedRef.current = true;
      }
    } catch {
      // Keep the original illustration visible if the public schedule is unavailable.
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void loadMatches();
    const timer = window.setInterval(
      () => void loadMatches(),
      20_000
    );
    return () => {
      window.clearInterval(timer);
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
    };
  }, [loadMatches]);

  return (
    <div className="landing-page">
      <Header />

      <main>
        {/* HERO */}
        <section className="hero-section" id="home">
          <div className="hero-orb hero-orb-one" />
          <div className="hero-orb hero-orb-two" />

          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="hero-eyebrow">
                <span className="hero-live-dot" />
                A NEW WAY TO FOLLOW THE GAME
              </div>

              <h1>
                Your Match.
                <br />
                Your Team.
                <br />
                <span className="hero-highlight">Your Clash.</span>
              </h1>

              <p className="hero-description">
                CricketClash brings cricket fans together in two-player contests.
                Choose a scheduled match, select your side, and follow the
                verified result.
              </p>

              <div className="hero-actions">
                <Link
                  to="/register"
                  className="button button-primary button-large hero-primary-button"
                >
                  Register Now <span aria-hidden="true">↗</span>
                </Link>

                <Link to="/login" className="button button-outline button-large hero-secondary-button">
                  Login <span aria-hidden="true">→</span>
                </Link>
              </div>

              <div className="hero-trust-row">
                <span className="hero-trust-icon">🏏</span>
                <div>
                  <strong>One match. Two opposing sides.</strong>
                  <span>Clear contest details and match outcomes in one place.</span>
                </div>
              </div>

              <div className="hero-mini-stats">
                <div>
                  <strong>1 <span>vs</span> 1</strong>
                  <small>Players per contest</small>
                </div>
                <div className="hero-stat-divider" />
                <div>
                  <strong>2</strong>
                  <small>Opposing teams</small>
                </div>
                <div className="hero-stat-divider" />
                <div>
                  <strong>✓</strong>
                  <small>Verified results</small>
                </div>
              </div>
            </div>

            <div className={`hero-visual${nextMatch ? " hero-visual-has-match" : ""}`} role="group" aria-label="Cricket match illustration and upcoming fixture">
              <div className="hero-visual-glow" />
              <div className="stadium-decoration">
                <span className="stadium-ring stadium-ring-one" />
                <span className="stadium-ring stadium-ring-two" />
                <span className="stadium-ball">🏏</span>
              </div>

              <div id="matches" className={`pitch-card${nextMatch ? " pitch-card-has-match" : ""}`}>
                <span className="pitch-card-label">
                  {nextMatch ? "THE NEXT MATCH" : "CRICKET, HEAD-TO-HEAD"}
                </span>
                <div className="pitch-illustration">
                  <span className="pitch-boundary" />
                  <span className="pitch-strip" />
                  <span className="pitch-crease pitch-crease-top" />
                  <span className="pitch-crease pitch-crease-bottom" />
                  <span className="pitch-wicket pitch-wicket-top">▥</span>
                  <span className="pitch-wicket pitch-wicket-bottom">▥</span>
                  <span className="pitch-ball">●</span>
                </div>
                {!nextMatch && <div className="pitch-card-footer">
                  <span>Two players</span>
                  <span>One shared match</span>
                  <span>Opposing teams</span>
                </div>}
                {nextMatch && (
                  <div className="hero-fixture-details">
                    <div className="hero-fixture-meta">
                      <span>{nextMatch.competition || "Cricket match"}</span>
                      <span>{String(nextMatch.format || "Cricket").toUpperCase()}</span>
                    </div>
                    <div className="hero-fixture-teams">
                      <div className="hero-fixture-team">
                        <span aria-hidden="true">
                          {teamDetails(nextMatch.teamA)?.flag || teamInitials(nextMatch.teamA)}
                        </span>
                        <strong>{nextMatch.teamA}</strong>
                      </div>
                      <span className="hero-fixture-versus">VS</span>
                      <div className="hero-fixture-team">
                        <span aria-hidden="true">
                          {teamDetails(nextMatch.teamB)?.flag || teamInitials(nextMatch.teamB)}
                        </span>
                        <strong>{nextMatch.teamB}</strong>
                      </div>
                    </div>
                    <p className="hero-fixture-date">
                      <span aria-hidden="true">◷</span> {formatMatchDate(nextMatch.startTime)}
                      <small>Starts in {formatCountdown(nextMatch.startTime, clockNow)}</small>
                    </p>
                    <Link
                      className="hero-fixture-link"
                      to={`/dashboard/contests?matchId=${encodeURIComponent(nextMatch._id)}`}
                      aria-label={`View contests for ${nextMatch.teamA} versus ${nextMatch.teamB}`}
                    >
                      View Contests <span aria-hidden="true">→</span>
                    </Link>
                  </div>
                )}
              </div>

              {!nextMatch && <div className="floating-card floating-card-top">
                <span className="floating-icon floating-icon-green">01</span>
                <span>
                  <strong>Head-to-head</strong>
                  <small>Two player places</small>
                </span>
              </div>}

              {!nextMatch && <div className="floating-card floating-card-bottom">
                <span className="floating-icon floating-icon-gold">✓</span>
                <span>
                  <strong>Follow the result</strong>
                  <small>Verified match outcome</small>
                </span>
              </div>}

              <div className="hero-caption">
                <span className="hero-caption-dot" />
                THE NEXT MATCH IS YOURS TO FOLLOW
              </div>
            </div>
          </div>

          <a className="hero-scroll-cue" href="#about">
            <span>SCROLL TO EXPLORE</span>
            <span aria-hidden="true">↓</span>
          </a>
        </section>

        {/* BRAND STRIP */}
        <section className="brand-strip" aria-label="CricketClash highlights">
          <div className="container brand-strip-inner">
            <span>🏏 CRICKET FIRST</span>
            <i />
            <span>⚔️ HEAD-TO-HEAD</span>
            <i />
            <span>🏆 COMPETITIVE SPIRIT</span>
            <i />
            <span>💚 BUILT FOR FANS</span>
          </div>
        </section>

        {/* FEATURES */}
        <section className="about-section section" id="features">
          <div className="container">
            <div className="section-heading centered-heading">
              <span className="eyebrow">
                <span className="eyebrow-dash" />
                BUILT AROUND THE MATCH
              </span>

              <h2>
                The details that
                <br />
                <span>keep it clear.</span>
              </h2>

              <p>
                A straightforward cricket experience, from choosing a fixture
                to reviewing contest status and wallet activity.
              </p>
            </div>

            <div className="about-grid">
              {features.map((feature, index) => (
                <article
                  className={`about-card ${feature.theme}`}
                  key={feature.title}
                >
                  <div className="about-card-top">
                    <div className="about-icon">{feature.icon}</div>
                    <span className="about-card-number">
                      0{index + 1}
                    </span>
                  </div>

                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <div className="about-card-bottom">
                    <span>CRICKETCLASH FEATURES</span>
                    <span aria-hidden="true">✓</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="section how-section" id="how-it-works">
          <div className="container how-grid">
            <div className="how-intro">
              <span className="eyebrow">
                <span className="eyebrow-dash" />
                YOUR JOURNEY STARTS HERE
              </span>

              <h2>
                From sign-up
                <br />
                <span>to the final result.</span>
              </h2>

              <p>
                Four clear steps take you from account verification to
                following the official match outcome.
              </p>

              <Link
                to="/register"
                className="button button-primary how-register-button"
              >
                Create your account <span aria-hidden="true">↗</span>
              </Link>

              <div className="how-footnote">
                <span aria-hidden="true">🔒</span>
                Email verification helps protect your account.
              </div>
            </div>

            <div className="steps-list">
              {steps.map((step) => (
                <article className="step-item" key={step.number}>
                  <div className="step-number">{step.number}</div>

                  <div className="step-item-icon">{step.icon}</div>

                  <div className="step-item-copy">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>

                  <span className="step-item-arrow" aria-hidden="true">
                    ↗
                  </span>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* WHY CRICKETCLASH */}
        <section className="section why-section" id="about">
          <div className="container">
            <div className="section-heading centered-heading">
              <span className="eyebrow">
                <span className="eyebrow-dash" />
                WHY CRICKETCLASH
              </span>
              <h2>
                A clear way to
                <br />
                <span>join the contest.</span>
              </h2>
              <p>
                Know what you’re joining, what each player chooses, and where
                to find the confirmed outcome.
              </p>
            </div>
            <div className="why-grid">
              <article className="why-card">
                <span aria-hidden="true">↗</span>
                <h3>Simple participation</h3>
                <p>Choose a scheduled match, review available contests, and select a side.</p>
              </article>
              <article className="why-card">
                <span aria-hidden="true">≡</span>
                <h3>Clear contest rules</h3>
                <p>See team choices, entry details, player places, and status before joining.</p>
              </article>
              <article className="why-card">
                <span aria-hidden="true">✓</span>
                <h3>Transparent outcomes</h3>
                <p>Review published results, settlements, refunds, and wallet transactions.</p>
              </article>
              <article className="why-card">
                <span aria-hidden="true">◉</span>
                <h3>Account tools</h3>
                <p>Verify your email, manage your session, and reset your password when needed.</p>
              </article>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section faq-section" id="faqs">
          <div className="container faq-grid">
            <div className="faq-intro">
              <span className="eyebrow">
                <span className="eyebrow-dash" />
                QUESTIONS, ANSWERED
              </span>
              <h2>
                Good to know
                <br />
                <span>before you play.</span>
              </h2>
              <p>
                Learn how matches, contests, account verification, and wallet
                requests work on CricketClash.
              </p>
              <Link to="/support" className="text-link">
                Contact &amp; Support <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="faq-list">
              {faqs.map((faq) => (
                <details className="landing-faq-item" key={faq.question}>
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="final-cta">
          <div className="final-cta-pattern" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <div className="container final-cta-inner">
            <div className="final-cta-copy">
              <span className="cta-eyebrow">
                <span /> YOUR NEXT CHAPTER BEGINS
              </span>
              <h2>
                Love the game?
                <br />
                <span>Make your move.</span>
              </h2>
              <p>
                Create your account, verify your email and become part of
                CricketClash.
              </p>
            </div>

            <div className="final-cta-action">
              <Link
                to="/register"
                className="button button-light button-large"
              >
                Create Your Account <span aria-hidden="true">↗</span>
              </Link>
              <Link to="/login" className="final-cta-login">Already registered? Login</Link>
              <span>Registration includes email verification.</span>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
