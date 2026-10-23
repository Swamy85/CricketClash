import Team from "../../models/Team.js";
import { parseBoundedInteger, unexpectedFields } from "../../middleware/requestSafety.js";

const CATEGORIES = new Set(["international", "franchise", "domestic"]);
const GENDERS = new Set(["men", "women", "mixed"]);
const FORMATS = new Set(["T10", "T20", "ODI", "TEST", "HUNDRED"]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function listTeams(req, res) {
  try {
    const queryFields = ["category", "gender", "format", "season", "competition", "search", "limit"];
    const unknownFields = unexpectedFields(req.query, queryFields);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    for (const field of queryFields) {
      if (req.query[field] !== undefined && typeof req.query[field] !== "string") {
        return res.status(400).json({ success: false, message: `"${field}" must be a single text value.` });
      }
    }
    for (const [field, maxLength] of [["season", 30], ["competition", 100], ["search", 80]]) {
      if (req.query[field] !== undefined && req.query[field].length > maxLength) {
        return res.status(400).json({ success: false, message: `"${field}" must be at most ${maxLength} characters.` });
      }
    }
    const limit = parseBoundedInteger(req.query.limit, { max: 1000, defaultValue: 500 });
    if (limit === null) return res.status(400).json({ success: false, message: '"limit" must be an integer between 1 and 1000.' });

    const filter = { active: true };
    for (const [field, allowed] of [
      ["category", CATEGORIES],
      ["gender", GENDERS],
    ]) {
      if (req.query[field]) {
        if (!allowed.has(req.query[field])) {
          return res.status(400).json({ success: false, message: `Invalid ${field}.` });
        }
        filter[field] = req.query[field];
      }
    }
    if (req.query.format) {
      if (!FORMATS.has(req.query.format)) {
        return res.status(400).json({ success: false, message: "Invalid match format." });
      }
      filter.formats = req.query.format;
    }
    if (req.query.season) filter.season = String(req.query.season).slice(0, 30);
    if (req.query.competition) {
      filter.competition = new RegExp(escapeRegex(String(req.query.competition).slice(0, 100)), "i");
    }
    if (req.query.search) {
      const expression = new RegExp(escapeRegex(String(req.query.search).trim().slice(0, 80)), "i");
      filter.$or = [
        { name: expression },
        { shortName: expression },
        { aliases: expression },
        { country: expression },
        { competition: expression },
      ];
    }

    const teams = await Team.find(filter)
      .select("teamKey name shortName aliases category gender country countryCode flag competition season formats")
      .sort({ category: 1, competition: 1, name: 1, season: -1 })
      .limit(limit)
      .lean();
    return res.status(200).json({ success: true, teams });
  } catch (error) {
    console.error("Unable to load team catalog:", error);
    return res.status(500).json({ success: false, message: "Unable to load the team catalog." });
  }
}

export async function upsertTeam(req, res) {
  try {
    const body = req.body || {};
    const unknownFields = unexpectedFields(body, ["name", "shortName", "aliases", "category", "gender", "country", "countryCode", "flag", "competition", "season", "formats", "active"]);
    if (unknownFields.length) return res.status(400).json({ success: false, message: unknownFields[0] });
    for (const field of ["name", "shortName", "category", "gender", "country", "countryCode", "flag", "competition", "season"]) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        return res.status(400).json({ success: false, message: `"${field}" must be text.` });
      }
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      return res.status(400).json({ success: false, message: '"active" must be true or false.' });
    }
    const name = (body.name || "").trim();
    const category = (body.category || "").toLowerCase();
    const gender = (body.gender || "mixed").toLowerCase();
    if (body.aliases !== undefined && (!Array.isArray(body.aliases) || body.aliases.some((alias) => typeof alias !== "string"))) {
      return res.status(400).json({ success: false, message: '"aliases" must be an array of text values.' });
    }
    if (body.formats !== undefined && (!Array.isArray(body.formats) || body.formats.some((format) => typeof format !== "string"))) {
      return res.status(400).json({ success: false, message: '"formats" must be an array of text values.' });
    }
    const formats = Array.isArray(body.formats) ? [...new Set(body.formats)] : ["T20"];
    const season = (body.season || "").trim().slice(0, 30);
    const competition = (body.competition || "").trim().slice(0, 100);

    if (!name || name.length > 120 || !CATEGORIES.has(category) || !GENDERS.has(gender)) {
      return res.status(400).json({
        success: false,
        message: "Provide a team name, supported category, and supported gender.",
      });
    }
    if (!formats.length || formats.some((format) => !FORMATS.has(format))) {
      return res.status(400).json({ success: false, message: "Select one or more supported match formats." });
    }
    if (category === "franchise" && !competition) {
      return res.status(400).json({ success: false, message: "Competition is required for franchise teams." });
    }

    const teamKey = `${category}-${slug(competition || "general")}-${slug(gender)}-${slug(name)}${season ? `-${slug(season)}` : ""}`;
    const update = {
      name,
      shortName: (body.shortName || "").trim().slice(0, 30),
      aliases: Array.isArray(body.aliases)
        ? [...new Set(body.aliases.map((alias) => alias.trim()).filter(Boolean))].slice(0, 20)
        : [],
      category,
      gender,
      country: (body.country || "").trim().slice(0, 80),
      countryCode: (body.countryCode || "").trim().toUpperCase().slice(0, 3),
      flag: (body.flag || "").trim().slice(0, 12),
      competition,
      season,
      formats,
      active: body.active !== false,
    };
    const team = await Team.findOneAndUpdate(
      { teamKey },
      { $set: update, $setOnInsert: { teamKey } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.status(200).json({ success: true, team });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ success: false, message: "Team catalog entry is invalid." });
    }
    console.error("Unable to save team catalog entry:", error);
    return res.status(500).json({ success: false, message: "Unable to save the team catalog entry." });
  }
}
