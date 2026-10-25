import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getTeamCatalog } from "../../../services/matchService";
import { fetchContestPageData } from "../contests/contestPageApi.js";
import { MatchCard } from "./MatchCard";
import "./MatchesPage.css";

const SECTIONS = [
  { key: "live", title: "Live Matches", label: "Join Contests" },
  { key: "upcoming", title: "Upcoming Matches", label: "Join Contests" },
  { key: "completed", title: "Completed Matches", label: "View Details" },
];

function getMatchCategory(status) {
  const normalized = String(status || "upcoming").toLowerCase();
  if (normalized === "live") return "live";
  if (normalized === "upcoming") return "upcoming";
  return "completed";
}

function normalizeTeamName(value) {
  return String(value || "").replace(/\s*\[[A-Z0-9]{2,8}\]\s*$/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchProviderFixture(match, providerMatches) {
  const teamA = normalizeTeamName(match.teamA);
  const teamB = normalizeTeamName(match.teamB);
  const candidates = providerMatches.filter((providerMatch) => {
    const providerA = normalizeTeamName(providerMatch.teamA);
    const providerB = normalizeTeamName(providerMatch.teamB);
    return (providerA === teamA && providerB === teamB) || (providerA === teamB && providerB === teamA);
  });
  if (!candidates.length) return null;
  const internalTime = new Date(match.startTime || 0).getTime();
  return candidates.sort((left, right) => {
    const leftDiff = Math.abs(new Date(left.startTime || 0).getTime() - internalTime);
    const rightDiff = Math.abs(new Date(right.startTime || 0).getTime() - internalTime);
    return leftDiff - rightDiff;
  })[0];
}

function MatchSection({ section, matches, teams }) {
  const scrollerRef = useRef(null);
  const scroll = (direction) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(node.clientWidth * 0.82, 280), behavior: "smooth" });
  };

  return (
    <section className={`cc-match-section ${section.key}`} aria-labelledby={`matches-${section.key}`}>
      <header className="cc-match-section-header">
        <div className="cc-match-section-title-wrap">
          <h2 id={`matches-${section.key}`}>{section.title}</h2>
          <span className="cc-match-section-count">{matches.length}</span>
        </div>
        <div className="cc-match-section-controls" aria-label={`${section.title} carousel controls`}>
          <button type="button" aria-label={`Scroll ${section.title} left`} onClick={() => scroll(-1)} disabled={!matches.length}>‹</button>
          <button type="button" aria-label={`Scroll ${section.title} right`} onClick={() => scroll(1)} disabled={!matches.length}>›</button>
        </div>
      </header>
      {matches.length ? (
        <div className="cc-match-section-scroller" ref={scrollerRef} tabIndex={0} aria-label={section.title}>
          {matches.map((match) => (
            <MatchCard
              key={match._id}
              match={match}
              teams={teams}
              variant="directory"
              layout="tile"
              actionLabel={section.label}
            />
          ))}
        </div>
      ) : (
        <div className="cc-match-section-empty">No {section.title.toLowerCase()} right now.</div>
      )}
    </section>
  );
}

export default function MatchesPage() {
  const {
    matches,
    refreshMatches,
    matchesLoading,
    matchesError,
    matchesRefreshNotice,
  } = useOutletContext();
  const [teams, setTeams] = useState([]);
  const [providerMatches, setProviderMatches] = useState([]);

  useEffect(() => {
    const controller = new AbortController();
    void getTeamCatalog({ signal: controller.signal }).then(setTeams).catch(() => {});
    void fetchContestPageData("/cricket-feed", controller.signal)
      .then(({ feed }) => setProviderMatches(Array.isArray(feed?.matches) ? feed.matches : []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const enrichedMatches = useMemo(() => matches.map((match) => {
    const provider = matchProviderFixture(match, providerMatches);
    if (!provider) return match;
    const sameTeamOrder = normalizeTeamName(provider.teamA) === normalizeTeamName(match.teamA);
    return {
      ...match,
      competition: provider.series || match.competition,
      format: provider.format || match.format,
      startTime: provider.startTime || match.startTime,
      venue: match.venue || provider.venue || match.stadium,
      teamALogo: match.teamALogo || (sameTeamOrder ? provider.teamALogo : provider.teamBLogo),
      teamBLogo: match.teamBLogo || (sameTeamOrder ? provider.teamBLogo : provider.teamALogo),
      providerStatus: provider.status,
      providerScoreA: sameTeamOrder ? provider.scoreA : provider.scoreB,
      providerScoreB: sameTeamOrder ? provider.scoreB : provider.scoreA,
      providerScoreSummary: provider.scoreSummary,
    };
  }), [matches, providerMatches]);

  const groupedMatches = useMemo(() => {
    const groups = { live: [], upcoming: [], completed: [] };
    enrichedMatches.forEach((match) => groups[getMatchCategory(match.status)].push(match));
    return groups;
  }, [enrichedMatches]);

  return (
    <section className="cc-feature-page cc-matches-page cc-matches-redesign">
      <div className="cc-feature-heading cc-matches-heading">
        <div>
          <span className="cc-feature-eyebrow">CRICKETCLASH FIXTURES</span>
          <h1>Matches</h1>
          <p>Follow live games, upcoming fixtures, and completed results.</p>
        </div>
      </div>

      {matchesRefreshNotice && <p className="cc-feature-success" role="status">{matchesRefreshNotice}</p>}
      {matchesError && <div className="cc-feature-alert" role="alert"><span>{matchesError}</span><button type="button" onClick={() => refreshMatches()}>Retry</button></div>}

      {matchesLoading && matches.length === 0 ? (
        <div className="cc-feature-empty">Loading matches...</div>
      ) : (
        <div className="cc-match-sections" aria-live="polite">
          {SECTIONS.map((section) => (
            <MatchSection key={section.key} section={section} matches={groupedMatches[section.key]} teams={teams} />
          ))}
        </div>
      )}
    </section>
  );
}
