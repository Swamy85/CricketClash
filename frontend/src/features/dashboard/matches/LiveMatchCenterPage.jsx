import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import LiveMatchCenter from "../../../components/dashboard/LiveMatchCenter";
import { adminFetch } from "../../admin/services/adminSession";
import { notifySessionExpired, SESSION_STORAGE_KEY } from "../../auth/services/authService";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.message || "Live match data is temporarily unavailable.");
  return data;
}

export default function LiveMatchCenterPage({ adminMode = false }) {
  const context = useOutletContext() || {};
  const [feed, setFeed] = useState(null);
  const [internalMatches, setInternalMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [publishingMatchId, setPublishingMatchId] = useState("");
  const requestRef = useRef(null);
  const actionLockRef = useRef(false);

  const loadFeed = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      let data;
      if (adminMode) {
        const [feedResponse, publicationResponse] = await Promise.all([
          adminFetch("/api/cricket-feed", { signal: controller.signal }),
          adminFetch("/api/admin/matches/publication-status", { signal: controller.signal }),
        ]);
        data = await readJson(feedResponse);
        const publicationData = await readJson(publicationResponse);
        if (controller.signal.aborted) return;
        setInternalMatches(Array.isArray(publicationData.matches) ? publicationData.matches : []);
      } else {
        const sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
        const response = await fetch(`${API_URL}/api/cricket-feed`, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "include",
          headers: sessionId ? { "X-CricketClash-Session": sessionId } : {},
        });
        data = await response.json().catch(() => ({}));
        if (!adminMode) notifySessionExpired(response, data);
        if (!response.ok || data.success === false) throw new Error(data.message || "Live match data is temporarily unavailable.");
      }
      if (controller.signal.aborted) return;
      setFeed(data.feed || null);
    } catch (requestError) {
      if (requestError.name !== "AbortError") setError(requestError.message || "Unable to load shared match data.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [adminMode]);

  useEffect(() => {
    void loadFeed();
    const timer = window.setInterval(() => void loadFeed(), 60_000);
    return () => {
      window.clearInterval(timer);
      const request = requestRef.current;
      requestRef.current = null;
      request?.abort();
    };
  }, [loadFeed]);

  const publishFeedMatch = useCallback(async (providerMatch) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setPublishingMatchId(String(providerMatch.externalId || "unknown"));
    setError("");
    setNotice("");
    try {
      const publicationData = await readJson(await adminFetch("/api/admin/matches/publication-status"));
      const candidates = Array.isArray(publicationData.matches) ? publicationData.matches : [];
      const startTime = new Date(providerMatch.startTime || 0);
      const providerIdMatch = candidates.find((match) => match.providerId && match.providerId === providerMatch.externalId);
      const fixtureMatch = candidates.find((match) => {
        const sameTeams = match.teamA === providerMatch.teamA && match.teamB === providerMatch.teamB;
        const closeStart = Math.abs(new Date(match.startTime).getTime() - startTime.getTime()) < 60_000;
        return sameTeams && closeStart;
      });
      const existingMatch = providerIdMatch || fixtureMatch;

      if (existingMatch?.published === true
        && (existingMatch.providerSource !== "CRICAPI" || existingMatch.contestQueuesReady === true)) {
        setInternalMatches((current) => current.some((match) => String(match._id) === String(existingMatch._id))
          ? current.map((match) => String(match._id) === String(existingMatch._id) ? existingMatch : match)
          : [...current, existingMatch]);
        setNotice("This match is already published. Use Manage Match or Manage Contests below.");
        return;
      }
      if (existingMatch) {
        const publishData = await readJson(await adminFetch(`/api/admin/matches/${existingMatch._id}/publish`, { method: "POST" }));
        const publishedMatch = { ...publishData.match, contestQueuesReady: true };
        setInternalMatches((current) => [...current.filter((match) => String(match._id) !== String(publishedMatch._id)), publishedMatch]);
        setNotice("Match published. All eight contest tiers are ready for users.");
        window.dispatchEvent(new Event("cricketclash:matches-updated"));
        return;
      }

      if (!providerMatch.series || !Number.isFinite(startTime.getTime()) || startTime <= new Date()) {
        throw new Error("This fixture needs a competition and a valid future start time before it can be published.");
      }
      const teamData = await readJson(await adminFetch("/api/admin/teams?limit=1000"));
      let teams = Array.isArray(teamData.teams) ? teamData.teams : [];
      const normalizedTeamName = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const hasProviderName = (team, value) => [team.name, team.shortName, ...(team.aliases || [])].some((candidate) => normalizedTeamName(candidate) === normalizedTeamName(value));
      let teamAOptions = teams.filter((team) => hasProviderName(team, providerMatch.teamA));
      let teamBOptions = teams.filter((team) => hasProviderName(team, providerMatch.teamB));
      const requestedFormat = String(providerMatch.format || "").toUpperCase();
      const formatPreference = requestedFormat === "ODI" ? "ODI" : requestedFormat === "TEST" ? "TEST" : requestedFormat === "T10" ? "T10" : requestedFormat === "HUNDRED" ? "HUNDRED" : "T20";
      const findValidPairs = () => teamAOptions.flatMap((teamA) => teamBOptions
        .filter((teamB) => teamA.competition === teamB.competition)
        .map((teamB) => ({ teamA, teamB, formats: (teamA.formats || []).filter((format) => (teamB.formats || []).includes(format)) })))
        .filter((pair) => pair.formats.length);
      let validPairs = findValidPairs();
      if (!validPairs.length) {
        // CricAPI often uses abbreviations or newly listed franchise names that
        // are not in CricketClash's curated catalog. Create only the missing
        // catalog entries needed for this admin-requested fixture.
        const knownInternational = [...teamAOptions, ...teamBOptions].some((team) => team.category === "international");
        const seriesText = String(providerMatch.series || "").trim().slice(0, 100);
        const competitionMatch = teams.find((team) => seriesText && normalizedTeamName(seriesText).includes(normalizedTeamName(team.competition)))
          || teams.find((team) => team.category === "international" && (teamAOptions.includes(team) || teamBOptions.includes(team)));
        const competition = competitionMatch?.competition || (knownInternational ? "International" : seriesText);
        const category = competitionMatch?.category || (competition === "International" ? "international" : "franchise");
        if (!competition) throw new Error("This fixture has no competition name, so its teams cannot be safely added to the catalog.");
        const allowedFormats = ["T10", "T20", "ODI", "TEST", "HUNDRED"];
        const format = allowedFormats.includes(formatPreference) ? formatPreference : "T20";
        const gender = /women|female/i.test(`${providerMatch.teamA} ${providerMatch.teamB} ${seriesText}`) ? "women" : "men";
        const saveProviderTeam = async (name, matched) => {
          const usable = matched.find((team) => team.competition === competition && (team.formats || []).includes(format));
          if (usable) return usable;
          const exact = matched.find((team) => team.competition === competition);
          if (exact) {
            const updated = await readJson(await adminFetch("/api/admin/teams", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: exact.name, shortName: exact.shortName || "", aliases: exact.aliases || [], category: exact.category, gender: exact.gender || "mixed", country: exact.country || "", countryCode: exact.countryCode || "", flag: exact.flag || "", competition, season: exact.season || "", formats: [...new Set([...(exact.formats || []), format])], active: true }),
            }));
            return updated.team;
          }
          const cleanedName = String(name || "").trim().slice(0, 120);
          if (!cleanedName) throw new Error("The provider did not supply a valid team name.");
          const countryName = knownInternational ? cleanedName.replace(/\s+(women|women's)$/i, "") : "";
          const countryCode = knownInternational ? ({ India: "IN", Australia: "AU", England: "GB", Pakistan: "PK", "South Africa": "ZA", "New Zealand": "NZ", Bangladesh: "BD", "Sri Lanka": "LK", Afghanistan: "AF", Ireland: "IE", Zimbabwe: "ZW", "West Indies": "WI" }[countryName] || "") : "";
          const saved = await readJson(await adminFetch("/api/admin/teams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: cleanedName, shortName: "", aliases: [], category, gender, country: countryName, countryCode, competition, season: "", formats: [format], active: true }),
          }));
          return saved.team;
        };
        const [teamA, teamB] = await Promise.all([
          saveProviderTeam(providerMatch.teamA, teamAOptions),
          saveProviderTeam(providerMatch.teamB, teamBOptions),
        ]);
        teams = [...teams.filter((team) => team.name !== teamA.name && team.name !== teamB.name), teamA, teamB];
        teamAOptions = [teamA];
        teamBOptions = [teamB];
        validPairs = findValidPairs();
      }
      validPairs.sort((left, right) => {
        const series = normalizedTeamName(providerMatch.series);
        const leftMatch = series.includes(normalizedTeamName(left.teamA.competition)) || normalizedTeamName(left.teamA.competition).includes(series);
        const rightMatch = series.includes(normalizedTeamName(right.teamA.competition)) || normalizedTeamName(right.teamA.competition).includes(series);
        return Number(rightMatch) - Number(leftMatch);
      });
      const pair = validPairs[0];
      const format = pair.formats.includes(formatPreference) ? formatPreference : pair.formats[0];
      const internalMatch = candidates.find((match) => match.status === "upcoming"
        && match.teamA === pair.teamA.name && match.teamB === pair.teamB.name
        && match.competition === pair.teamA.competition
        && Math.abs(new Date(match.startTime).getTime() - startTime.getTime()) < 60_000);
      let savedMatch = internalMatch;
      if (!savedMatch) {
        const response = await adminFetch("/api/admin/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ competition: pair.teamA.competition, teamA: pair.teamA.name, teamB: pair.teamB.name, format, status: "upcoming", startTime: startTime.toISOString() }),
        });
        savedMatch = (await readJson(response)).match;
      }
      if (!savedMatch?._id) throw new Error("The CricketClash match was not returned.");
      const publishedMatch = { ...savedMatch, contestQueuesReady: true };
      setInternalMatches((current) => [...current.filter((match) => String(match._id) !== String(publishedMatch._id)), publishedMatch]);
      setNotice("Match published. All eight contest tiers are ready for users.");
      window.dispatchEvent(new Event("cricketclash:matches-updated"));
    } catch (requestError) {
      setError(requestError.message || "Could not publish this match. Retry is safe if queue setup was interrupted.");
    } finally {
      actionLockRef.current = false;
      setPublishingMatchId("");
    }
  }, []);

  return <>
    <LiveMatchCenter
      feed={feed}
      loading={loading}
      error={error}
      notice={notice}
      onRetry={() => void loadFeed()}
      onPublishMatch={adminMode ? publishFeedMatch : undefined}
      publishingMatchId={publishingMatchId}
      internalMatches={adminMode ? internalMatches : context.matches || []}
      userView={!adminMode}
    />
    {adminMode && <div className="cc-live-admin-note"><strong>Provider feed</strong> shows all fixtures for admin review. Scheduled synchronization keeps imported matches unpublished; use Publish Match to publish a fixture and seed all eight contest tiers. Published matches link to their existing management pages. <Link to="/admin/matches">Manage CricketClash matches</Link>.</div>}
  </>;
}
