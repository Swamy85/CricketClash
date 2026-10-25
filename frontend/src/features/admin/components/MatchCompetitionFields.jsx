import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "../services/adminSession";

const FORMAT_ORDER = ["T20", "HUNDRED", "ODI", "TEST", "T10"];
const FORMAT_LABELS = {
  T20: "T20",
  HUNDRED: "The Hundred",
  ODI: "One Day International",
  TEST: "Test",
  T10: "T10",
};

const COMPETITION_LABELS = {
  "International": "International",
  "Indian domestic": "Indian Domestic",
  "Indian Premier League (IPL)": "IPL",
  "Women's Premier League (WPL)": "WPL",
  "Big Bash League (BBL)": "BBL",
  "Pakistan Super League (PSL)": "PSL",
  "International League T20 (ILT20)": "ILT20",
  "Caribbean Premier League (CPL)": "CPL",
  "Major League Cricket (MLC)": "Major League Cricket (MLC)",
  "Bangladesh Premier League (BPL)": "BPL",
  "Lanka Premier League (LPL)": "LPL",
  "Nepal Premier League (NPL)": "NPL",
};

function defaultFormat(formats) {
  return FORMAT_ORDER.find((format) => formats.includes(format)) || "T20";
}

function competitionOptions(teams) {
  const options = new Map();
  for (const team of teams) {
    if (!options.has(team.competition)) {
      options.set(team.competition, {
        name: team.competition,
        category: team.category,
        formats: new Set(),
      });
    }
    for (const format of team.formats || []) {
      options.get(team.competition).formats.add(format);
    }
  }
  return [...options.values()]
    .map((option) => ({
      ...option,
      formats: FORMAT_ORDER.filter((format) => option.formats.has(format)),
    }))
    .sort((a, b) => {
      const categoryOrder = ["international", "franchise", "domestic"];
      return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)
        || a.name.localeCompare(b.name);
    });
}

export default function MatchCompetitionFields({ form, setForm, disabled = false }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function loadTeams() {
      setLoading(true);
      setError("");
      try {
        const response = await adminFetch("/api/admin/teams?limit=1000", {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Unable to load competitions.");
        }
        setTeams(Array.isArray(data.teams) ? data.teams : []);
      } catch (loadError) {
        if (loadError.name !== "AbortError") {
          setError(loadError.message || "Unable to load competitions.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadTeams();
    return () => controller.abort();
  }, []);

  const options = useMemo(() => competitionOptions(teams), [teams]);
  const selectedCompetition = options.find(
    (option) => option.name === form.competition
  );

  useEffect(() => {
    if (form.competition || !form.teamA || !form.teamB || !teams.length) return;
    const a = teams.filter((team) => team.name === form.teamA);
    const b = teams.filter((team) => team.name === form.teamB);
    const sharedCompetition = options.find((option) =>
      a.some((teamA) => teamA.competition === option.name)
      && b.some((teamB) => teamB.competition === option.name)
    );
    if (!sharedCompetition) return;
    const format = sharedCompetition.formats.includes(form.format)
      ? form.format
      : defaultFormat(sharedCompetition.formats);
    setForm((current) => ({ ...current, competition: sharedCompetition.name, format }));
  }, [form.competition, form.format, form.teamA, form.teamB, options, setForm, teams]);

  const competitionTeams = selectedCompetition
    ? teams.filter((team) =>
      team.competition === selectedCompetition.name
      && (team.formats || []).includes(form.format)
    )
    : [];

  function chooseCompetition(event) {
    const competition = options.find((option) => option.name === event.target.value);
    setForm((current) => ({
      ...current,
      competition: competition?.name || "",
      format: competition ? defaultFormat(competition.formats) : "T20",
      teamA: "",
      teamB: "",
    }));
  }

  function updateTeam(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateFormat(event) {
    const format = event.target.value;
    setForm((current) => ({
      ...current,
      format,
      teamA: teams.some((team) =>
        team.competition === current.competition
        && team.name === current.teamA
        && (team.formats || []).includes(format)
      )
        ? current.teamA
        : "",
      teamB: teams.some((team) =>
        team.competition === current.competition
        && team.name === current.teamB
        && (team.formats || []).includes(format)
      )
        ? current.teamB
        : "",
    }));
  }

  const competitionGroups = ["international", "franchise", "domestic"].map((category) => ({
    category,
    options: options.filter((option) => option.category === category),
  })).filter((group) => group.options.length);
  const categoryLabels = {
    international: "International",
    franchise: "Franchise leagues",
    domestic: "Domestic",
  };

  return (
    <>
      <label className="admin-competition-field admin-matches-form-full">
        Competition
        <select
          value={form.competition || ""}
          onChange={chooseCompetition}
          required
          disabled={disabled || loading || !options.length}
        >
          <option value="">{loading ? "Loading competitions…" : "Choose a competition"}</option>
          {competitionGroups.map(({ category, options: categoryOptions }) => (
            <optgroup key={category} label={categoryLabels[category]}>
              {categoryOptions.map((option) => (
                <option key={option.name} value={option.name}>
                  {COMPETITION_LABELS[option.name] || option.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {error && <small role="alert">{error}</small>}
      </label>

      <label className="admin-match-team-select">
        Match format
        <select
          name="format"
          value={form.format}
          onChange={updateFormat}
          disabled={disabled || !selectedCompetition}
          required
        >
          {(selectedCompetition?.formats || [form.format]).map((format) => (
            <option key={format} value={format}>{FORMAT_LABELS[format] || format}</option>
          ))}
        </select>
      </label>

      <label className="admin-match-team-select">
        {form.teamA || "First competing team"}
        <select
          name="teamA"
          value={form.teamA}
          onChange={updateTeam}
          disabled={disabled || !selectedCompetition || loading}
          required
        >
          <option value="">Select first team</option>
          {competitionTeams.map((team) => (
            <option key={team.teamKey} value={team.name}>
              {team.flag ? `${team.flag} ` : ""}{team.name}{team.shortName ? ` (${team.shortName})` : ""}
            </option>
          ))}
        </select>
      </label>

      <label>
        {form.teamB || "Second competing team"}
        <select
          name="teamB"
          value={form.teamB}
          onChange={updateTeam}
          disabled={disabled || !selectedCompetition || loading}
          required
        >
          <option value="">Select opposing team</option>
          {competitionTeams
            .filter((team) => team.name !== form.teamA)
            .map((team) => (
              <option key={team.teamKey} value={team.name}>
                {team.flag ? `${team.flag} ` : ""}{team.name}{team.shortName ? ` (${team.shortName})` : ""}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}
