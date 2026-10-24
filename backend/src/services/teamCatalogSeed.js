import Team from "../models/Team.js";

function flagFromCode(code) {
  if (!code || code.length !== 2) return "🏏";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((letter) => 127397 + letter.charCodeAt(0))
  );
}

function nationFlag(name, code) {
  if (name === "West Indies") return "🏏";
  if (name === "England") {
    return String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f);
  }
  if (name === "Scotland") {
    return String.fromCodePoint(
      0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe006c, 0xe0064, 0xe007f
    );
  }
  return flagFromCode(code);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const nations = [
  ["Afghanistan", "AF", true],
  ["Australia", "AU", true],
  ["Bangladesh", "BD", true],
  ["England", "GB", true],
  ["India", "IN", true],
  ["Ireland", "IE", true],
  ["New Zealand", "NZ", true],
  ["Pakistan", "PK", true],
  ["South Africa", "ZA", true],
  ["Sri Lanka", "LK", true],
  ["West Indies", "WI", true],
  ["Zimbabwe", "ZW", true],
  ["Canada", "CA", false],
  ["Nepal", "NP", false],
  ["Netherlands", "NL", false],
  ["Namibia", "NA", false],
  ["Oman", "OM", false],
  ["Papua New Guinea", "PG", false],
  ["Scotland", "GB", false],
  ["United Arab Emirates", "AE", false],
  ["United States of America", "US", false],
  ["Uganda", "UG", false],
  ["Hong Kong", "HK", false],
  ["Jersey", "JE", false],
  ["Kenya", "KE", false],
  ["Malaysia", "MY", false],
  ["Thailand", "TH", false],
  ["Japan", "JP", false],
  ["Germany", "DE", false],
  ["Italy", "IT", false],
  ["Nigeria", "NG", false],
  ["Tanzania", "TZ", false],
  ["Rwanda", "RW", false],
  ["Vanuatu", "VU", false],
];

const teams = [];

for (const [country, countryCode, fullMember] of nations) {
  for (const gender of ["men", "women"]) {
    const name = gender === "women" ? `${country} Women` : country;
    const testEligible = gender === "men"
      ? fullMember
      : ["Australia", "England", "India", "South Africa"].includes(country);
    teams.push({
      teamKey: `international-${gender}-${slug(country)}`,
      name,
      shortName: "",
      category: "international",
      gender,
      country,
      countryCode,
      flag: nationFlag(country, countryCode),
      competition: "International",
      formats: [
        "T20",
        ...(fullMember ? ["ODI"] : []),
        ...(testEligible ? ["TEST"] : []),
      ],
    });
  }
}

const franchiseGroups = [
  {
    competition: "Indian Premier League (IPL)",
    country: "India",
    countryCode: "IN",
    gender: "men",
    names: [
      ["Chennai Super Kings", "CSK"],
      ["Delhi Capitals", "DC"],
      ["Gujarat Titans", "GT"],
      ["Kolkata Knight Riders", "KKR"],
      ["Lucknow Super Giants", "LSG"],
      ["Mumbai Indians", "MI"],
      ["Punjab Kings", "PBKS"],
      ["Rajasthan Royals", "RR"],
      ["Royal Challengers Bengaluru", "RCB"],
      ["Sunrisers Hyderabad", "SRH"],
    ],
  },
  {
    competition: "Women's Premier League (WPL)",
    country: "India",
    countryCode: "IN",
    gender: "women",
    names: [
      ["Delhi Capitals Women", "DCW"],
      ["Gujarat Giants", "GG"],
      ["Mumbai Indians Women", "MIW"],
      ["Royal Challengers Bengaluru Women", "RCBW"],
      ["UP Warriorz", "UPW"],
    ],
  },
  {
    competition: "Big Bash League (BBL)",
    country: "Australia",
    countryCode: "AU",
    gender: "men",
    names: [
      ["Adelaide Strikers", "AS"], ["Brisbane Heat", "BH"],
      ["Hobart Hurricanes", "HH"], ["Melbourne Renegades", "MR"],
      ["Melbourne Stars", "MS"], ["Perth Scorchers", "PS"],
      ["Sydney Sixers", "SS"], ["Sydney Thunder", "ST"],
    ],
  },
  {
    competition: "Pakistan Super League (PSL)",
    country: "Pakistan",
    countryCode: "PK",
    gender: "men",
    names: [
      ["Lahore Qalandars", "LQ"], ["Karachi Kings", "KK"],
      ["Islamabad United", "IU"], ["Peshawar Zalmi", "PZ"],
      ["Quetta Gladiators", "QG"], ["Multan Sultans", "MS"],
    ],
  },
  {
    competition: "SA20",
    country: "South Africa",
    countryCode: "ZA",
    gender: "men",
    names: [
      ["Durban's Super Giants", "DSG"], ["Joburg Super Kings", "JSK"],
      ["MI Cape Town", "MICT"], ["Paarl Royals", "PR"],
      ["Pretoria Capitals", "PC"], ["Sunrisers Eastern Cape", "SEC"],
    ],
  },
  {
    competition: "International League T20 (ILT20)",
    country: "United Arab Emirates",
    countryCode: "AE",
    gender: "men",
    names: [
      ["Abu Dhabi Knight Riders", "ADKR"], ["Dubai Capitals", "DC"],
      ["Gulf Giants", "GG"], ["MI Emirates", "MIE"],
      ["Sharjah Warriorz", "SW"], ["Desert Vipers", "DV"],
    ],
  },
  {
    competition: "Caribbean Premier League (CPL)",
    country: "Caribbean",
    countryCode: "",
    gender: "men",
    names: [
      ["Antigua & Barbuda Falcons", "ABF"],
      ["Barbados Royals", "BR", ["Barbados Tridents"]],
      ["Guyana Amazon Warriors", "GAW"],
      ["Jamaica Kingsmen", "JK"],
      ["Saint Lucia Kings", "SLK"],
      ["St Kitts & Nevis Patriots", "SKNP"],
      ["Trinbago Knight Riders", "TKR"],
    ],
  },
  {
    competition: "Major League Cricket (MLC)",
    country: "United States",
    countryCode: "US",
    gender: "men",
    names: [
      ["LA Knight Riders", "LAKR"], ["MI New York", "MINY"],
      ["San Francisco Unicorns", "SFU"], ["Seattle Orcas", "SEO"],
      ["Texas Super Kings", "TSK"], ["Washington Freedom", "WF"],
    ],
  },
  {
    competition: "The Hundred",
    country: "England and Wales",
    countryCode: "GB",
    gender: "men",
    names: [
      ["Birmingham Phoenix", "BPH"],
      ["London Spirit", "LS"],
      ["Manchester Originals", "MO"],
      ["Northern Superchargers", "NS"],
      ["Oval Invincibles", "OI"],
      ["Southern Brave", "SB"],
      ["Trent Rockets", "TR"],
      ["Welsh Fire", "WF"],
    ],
  },
  {
    competition: "The Hundred",
    country: "England and Wales",
    countryCode: "GB",
    gender: "women",
    names: [
      ["Birmingham Phoenix Women", "BPHW"],
      ["London Spirit Women", "LSW"],
      ["Manchester Originals Women", "MOW"],
      ["Northern Superchargers Women", "NSW"],
      ["Oval Invincibles Women", "OIW"],
      ["Southern Brave Women", "SBW"],
      ["Trent Rockets Women", "TRW"],
      ["Welsh Fire Women", "WFW"],
    ],
  },
  {
    competition: "Bangladesh Premier League (BPL)",
    country: "Bangladesh",
    countryCode: "BD",
    gender: "men",
    names: [
      ["Dhaka", "DHK"], ["Chattogram", "CTG"], ["Khulna", "KHL"],
      ["Rajshahi", "RJS"], ["Rangpur", "RNG"], ["Sylhet", "SYL"],
    ],
  },
  {
    competition: "Lanka Premier League (LPL)",
    country: "Sri Lanka",
    countryCode: "LK",
    gender: "men",
    names: [
      ["Colombo", "COL"], ["Dambulla", "DAM"], ["Galle", "GAL"],
      ["Jaffna", "JAF"], ["Kandy", "KAN"],
    ],
  },
  {
    competition: "Nepal Premier League (NPL)",
    country: "Nepal",
    countryCode: "NP",
    gender: "men",
    names: [
      ["Biratnagar Kings", "BK"], ["Chitwan Rhinos", "CR"],
      ["Janakpur Bolts", "JB"], ["Karnali Yaks", "KY"],
      ["Kathmandu Gurkhas", "KG"], ["Lumbini Lions", "LL"],
      ["Pokhara Avengers", "PA"], ["Sudurpaschim Royals", "SR"],
    ],
  },
  {
    competition: "Global T20 Canada",
    country: "Canada",
    countryCode: "CA",
    gender: "men",
    names: [
      ["Brampton Wolves", "BW"], ["Montreal Tigers", "MT"],
      ["Surrey Jaguars", "SJ"], ["Toronto Nationals", "TN"],
      ["Vancouver Knights", "VK"], ["Windsor Royals", "WR"],
    ],
  },
];

for (const group of franchiseGroups) {
  for (const [name, shortName, aliases = []] of group.names) {
    teams.push({
      teamKey: `franchise-${slug(group.competition)}-${slug(group.gender)}-${slug(name)}`,
      name,
      shortName,
      aliases,
      category: "franchise",
      gender: group.gender,
      country: group.country,
      countryCode: group.countryCode,
      flag: flagFromCode(group.countryCode),
      competition: group.competition,
      formats: group.competition === "The Hundred" ? ["HUNDRED"] : ["T20"],
    });
  }
}

const indianDomesticTeams = [
  "Andhra", "Arunachal Pradesh", "Assam", "Baroda", "Bengal", "Bihar",
  "Chandigarh", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Hyderabad", "Jammu & Kashmir", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Mumbai", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Railways", "Rajasthan", "Saurashtra", "Services",
  "Tamil Nadu", "Tripura", "Uttar Pradesh", "Uttarakhand", "Vidarbha",
];

for (const name of indianDomesticTeams) {
  teams.push({
    teamKey: `domestic-india-${slug(name)}`,
    name,
    category: "domestic",
    gender: "men",
    country: "India",
    countryCode: "IN",
    flag: flagFromCode("IN"),
    competition: "Indian domestic",
    formats: ["T20", "ODI", "TEST"],
  });
}

export async function seedTeamCatalog() {
  if (!teams.length) return;

  // Startup runs this seed after every Render restart. Avoid issuing a bulk
  // upsert for the full catalog when the entries are already present.
  const existingKeys = new Set(
    (await Team.find({ teamKey: { $in: teams.map((team) => team.teamKey) } })
      .select("teamKey")
      .lean())
      .map((team) => team.teamKey)
  );
  const missingTeams = teams.filter((team) => !existingKeys.has(team.teamKey));
  const operations = missingTeams.map((team) => ({
    updateOne: {
      filter: { teamKey: team.teamKey },
      update: { $setOnInsert: team },
      upsert: true,
    },
  }));
  if (operations.length) await Team.bulkWrite(operations, { ordered: false });
}
