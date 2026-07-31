import type { Company, RoleBreakdown } from "./companies";
import { RESOLVED_DOMAINS } from "./resolvedDomains";

// ── Compact global company rosters ────────────────────────────────────────
// Adding a company to a city is just one line: [ticker, name, group]. Full
// Company records, head-office coordinates and illustrative financials are
// GENERATED from these; the live share price (Yahoo Finance) and live news
// (GDELT) fill the real figures at runtime by ticker. This keeps hundreds of
// listings maintainable without hand-writing every field.

// [ticker, name, group, exchange?, pill?] — exchange overrides the city
// default (e.g. NASDAQ names in a NYSE-default US city); pill overrides the map
// label (e.g. a name acronym for markets with numeric tickers).
export type RosterEntry = [
  ticker: string,
  name: string,
  group: string,
  exchange?: string,
  pill?: string,
];

// Cities whose exchanges use numeric tickers (HK/Shanghai/Shenzhen/Tokyo/
// Korea): a bare ticker like "00700" is a meaningless pill, so map labels there
// show a short acronym of the company name instead. The ticker still drives
// search, so the company remains findable by its listing code.
const ACRONYM_CITIES = new Set(["hongkong", "tokyo", "seoul", "ganzhou", "beijing"]);

// Corporate-form words that don't belong in an acronym / brand label.
const DROP_WORDS = new Set([
  "holdings",
  "holding",
  "corporation",
  "corp",
  "group",
  "limited",
  "ltd",
  "company",
  "co",
  "international",
  "inc",
  "incorporated",
  "plc",
  "the",
]);
const STOP_WORDS = new Set(["and", "of", "the", "&"]);

// Real primary domains for companies whose website doesn't follow the
// "significant words joined + .com" heuristic below (banks/telecoms with
// acronym brands, or where the obvious guess is wrong). Everything not listed
// falls back to the heuristic, which is correct for most single-brand names
// (xiaomi.com, tencent.com, alibaba.com, chinamobile.com, …).
const KNOWN_DOMAINS: Record<string, string> = {
  "industrial and commercial bank of china": "icbc.com.cn",
  "agricultural bank of china": "abchina.com",
  "bank of china": "boc.cn",
  "china construction bank": "ccb.com",
  "china life insurance company": "e.chinalife.com.cn",
  "people's insurance company of china": "picc.com",
  "postal savings bank of china": "psbc.com",
  "china state construction engineering": "cscec.com",
  "china yangtze power": "cypc.com.cn",
  "huaneng power international": "hpi.com.cn",
  "china shenhua energy": "csenergy.com.cn",
  "china telecom": "chinatelecom-h.com",
  "china unicom": "chinaunicom.com",
  petrochina: "petrochina.com.cn",
  "sinotrans limited": "sinotrans.com",
  "beijing shougang": "shougang.com.cn",
  "boe technology": "boe.com",
  "jd.com": "jd.com",
  "pop mart": "popmart.com",
  netease: "neteasegames.com",
  "boc hong kong": "bochk.com",
  "aia group": "aia.com",
  "ck hutchison holdings": "ckh.com.hk",
  "ck infrastructure holdings": "cki.com.hk",
  "hong kong exchanges and clearing": "hkex.com.hk",
  "sun hung kai properties": "shkp.com",
  "hang seng bank": "hangseng.com",
  "hsbc holdings": "hsbc.com",
  "mtr corporation": "mtr.com.hk",
  "techtronic industries": "ttigroup.com",
  "link reit": "linkreit.com",
  "wh group": "wh-group.com",
  "softbank group": "group.softbank",
  "mitsui & co.": "mitsui.com",
  "itochu corporation": "itochu.co.jp",
  "recruit holdings": "recruit-holdings.com",
  "sk hynix": "skhynix.com",
  "sk inc.": "sk.com",
  "sk telecom": "sktelecom.com",
  "lg energy solution": "lgensol.com",
  "lg chem": "lgchem.com",
  "lg electronics": "lge.com",
  "kb financial group": "kbfg.com",
  "shinhan financial group": "shinhangroup.com",
  "woori financial group": "woorifg.com",
  "samsung electronics": "samsung.com",
  "samsung life insurance": "samsunglife.com",
  "samsung c&t": "samsungcnt.com",
  "hyundai motor company": "hyundai.com",
  "kia corporation": "kia.com",
  "korea zinc": "koreazinc.co.kr",
  "korean air": "koreanair.com",
  "industrial bank of korea": "ibk.co.kr",
};

// Best-effort primary domain for a company, so the card logo (Google favicon
// service, keyed on domain) shows the real brand mark. Uses KNOWN_DOMAINS where
// the site doesn't match the heuristic, else joins the significant name words.
export function deriveDomain(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (KNOWN_DOMAINS[key]) return KNOWN_DOMAINS[key];
  // Domains resolved automatically (scripts/resolve-logos.py) for the gov
  // agencies + private companies, so their favicon logos populate too.
  if (RESOLVED_DOMAINS[key]) return RESOLVED_DOMAINS[key];
  const cleaned = name.replace(/\([^)]*\)/g, " ").toLowerCase();
  const words = cleaned
    .split(/[\s.,/&'-]+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w) && !DROP_WORDS.has(w));
  const joined = (words.join("") || cleaned.replace(/[^a-z0-9]/g, "")).replace(/[^a-z0-9]/g, "");
  return `${joined || "example"}.com`;
}

// Build a short pill label from a company name: initials for multi-word names
// (INDUSTRIAL COMMERCIAL BANK CHINA -> ICBC), the brand word itself for
// single-word names (Tencent Holdings -> Tencent).
export function nameAcronym(name: string): string {
  const cleaned = name.replace(/\([^)]*\)/g, " ");
  const words = cleaned.split(/[\s.,/-]+/).filter(Boolean);
  const sig = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const core = sig.filter((w) => !DROP_WORDS.has(w.toLowerCase()));
  const use = core.length ? core : sig;
  if (use.length >= 2)
    return use
      .map((w) => w[0].toUpperCase())
      .join("")
      .slice(0, 5);
  const w = use[0] || name;
  return w.length <= 8 ? w : w.slice(0, 8);
}

export interface CityRoster {
  exchange: string; // default listing exchange for this city
  companies: RosterEntry[];
}

// City-scoped id so the same ticker can appear in more than one city (e.g. VOD
// in London and Johannesburg, ALK = Alaska Air in Seattle vs Alkane in Perth).
export function rosterId(city: string, ticker: string): string {
  return `${city}-${ticker}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

// Deterministic 0..1 hash so a company's generated numbers are stable.
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Spread a city's companies around its centre in a phyllotaxis spiral (~150–
// 250 m apart), so their office pins fan out over the CBD instead of stacking.
export function spreadCoords(center: [number, number], n: number): [number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const latScale = 0.0015;
  const lngScale = 0.0018 / Math.max(0.35, Math.cos((center[1] * Math.PI) / 180));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(i + 0.6);
    const a = i * golden;
    out.push([
      +(center[0] + Math.cos(a) * r * lngScale).toFixed(6),
      +(center[1] + Math.sin(a) * r * latScale).toFixed(6),
    ]);
  }
  return out;
}

// Land-aware placement override for a city. The plain spreadCoords fans company
// pins in a full 360° golden-angle spiral around the camera centre, which for
// waterfront CBDs drops pins into the harbour/bay and, for cities with many
// companies, sprawls ~2km out. `anchor` moves the spread to the real business
// district; `arc` (bearings clockwise from north, [from,to], wrapping when
// to<from) restricts the fan to the land-facing sector; `maxKm` caps the radius.
export interface CityPlacement {
  anchor?: [number, number];
  arc?: [number, number];
  maxKm?: number;
}

// Only cities that need it are listed; everything else keeps a full-circle fan
// with a capped radius (so big inland CBDs no longer sprawl). Waterfront cities
// get a land arc pointing away from the water.
//
// HOW THE ARCS BELOW WERE ARRIVED AT. Every one that carries a measurement note
// was solved against the city's real water geometry, pulled from OpenStreetMap
// (natural=water, waterway=riverbank, natural=bay, landuse=reservoir) for the
// bounding box its pins occupy. For each bearing we walk outwards from the
// centre until a point falls inside a water polygon; that gives the dry radius
// on that bearing, and the arc is the contiguous run of bearings that maximises
// the wedge's AREA — the quantity that decides how far apart pins end up —
// subject to a floor of 340 m so a fan never collapses into a stack.
//
// The test is on the WHOLE WEDGE rather than on the pins one particular fan
// produces, which matters because a city's pins come from several separate
// spreadCoordsCity calls (the listed roster, then its government agencies, then
// the private companies) each generating its own spiral. If the wedge is dry
// then every fan inside it is dry, at any company count.
//
// Where the arcs alone left the fan reaching water, maxKm pulls the radius in
// to the measured dry limit instead of narrowing the arc further.
export const CITY_PLACEMENT: Record<string, CityPlacement> = {
  // Australia
  // Perth was the one water-bounded city here with no arc, so its fan was a
  // full circle and the southern half of it landed in the Swan River — the
  // river wraps the CBD from Elizabeth Quay round to East Perth, so anything
  // fanned south or south-east is in the water. Measured against the river's
  // real geometry (OpenStreetMap), an unconstrained fan of 143 put 21 positions
  // in the river; this arc puts none at any fan size. Land is West Perth and
  // Northbridge (W/NW), the CBD spine (N) and East Perth (NE/ENE).
  perth: { arc: [285, 75] },
  sydney: { arc: [150, 330] }, // avoid Sydney Harbour (N/NE)
  // Yarra to the south and Victoria Harbour/Docklands to the west. The old
  // [330,140] arc pointed the fan at the river: measured, 6 of the 188 pins sat
  // in water (including Treasury & Finance and the AFL). The dry wedge runs
  // anticlockwise from SW round through north to ESE, and the radius has to
  // come in from 1.15 km to 1.02 km or the far edge reaches the Yarra.
  melbourne: { arc: [223, 69], maxKm: 1.02 },
  // Inside the river's U-bend, so water is W, S and E. [285,75] included the
  // WNW sector, which is North Quay — 17 of 127 pins were in the Brisbane
  // River, the worst of any city. Rotated to the measured dry run.
  brisbane: { arc: [291, 40] },
  darwin: { arc: [60, 210] }, // CBD peninsula → land is E/SE, harbour wraps N/W/SW
  hobart: { arc: [180, 30] }, // CBD on W shore of Derwent → water is E, land wraps W
  auckland: { arc: [120, 300] }, // CBD on the isthmus → harbour N, land arcs S
  // Lambton Quay sits on reclaimed land with Wellington Harbour immediately
  // east and north-east; 7 of the 31 pins were in it, all of them public
  // service agencies (Health NZ, NZTA, the Reserve Bank, Stats NZ, the EPA, Te
  // Puni Kōkiri and DPMC). The dry run climbs inland to the south and west.
  wellington: { arc: [152, 275] },
  // Civic, with Lake Burley Griffin to the south — the only wet sector, and it
  // caught one pin (the National Library). Everything else is dry, so this is
  // an almost-full circle with the lake cut out.
  canberra: { arc: [230, 138] },
  // North America
  toronto: { arc: [285, 75] }, // avoid Lake Ontario (S)
  chicago: { arc: [175, 355] }, // avoid Lake Michigan (E)
  boston: { arc: [150, 360] }, // avoid the harbour (E)
  newyork: { anchor: [-73.9945, 40.7205], arc: [300, 60], maxKm: 1.4 }, // narrow Manhattan, run N-S
  sanfrancisco: { arc: [150, 340] }, // avoid the bay (E/NE)
  // San Jose sprawls up the valley rather than out from a CBD; the south bay is NE.
  sanjose: { anchor: [-121.8863, 37.3382], arc: [200, 20] },
  seattle: { arc: [20, 200] }, // avoid Elliott Bay (W)
  vancouver: { arc: [90, 200] }, // avoid Burrard Inlet (N) + English Bay (W)
  // Buffalo Bayou runs east–west just north of the CBD and caught EOG. The dry
  // run is the southern sector, away from the bayou and its turning basin.
  houston: { arc: [194, 268] },
  // Europe
  // The Thames. Unconstrained, 7 of 39 pins were in it (AstraZeneca, Unilever,
  // Rio Tinto, Haleon, Anglo American, Sage, Experian). The dry run is the
  // south-west-through-north-west sector, back from the north bank.
  london: { arc: [228, 322] },
  // The Seine and the Canal Saint-Martin: 4 pins were in the river. The dry run
  // sweeps from due north round through east to south-east.
  paris: { arc: [354, 132] },
  // The city centre lands on the Bahnhofbrücke — literally on the Limmat, with
  // the river on two sides and the lake beyond, which put 5 of 32 pins in
  // water (incl. ABB, Nestlé and Swisscom). No arc from there does better than
  // a 60° sliver, so this moves the anchor rather than narrowing the fan:
  // Enge/Bleicherweg, a real Zurich office district a few hundred metres
  // south-west of Paradeplatz, clears a 170° arc at full radius — measured at
  // 23,370 m² per pin against 6,494 from the old centre.
  zurich: { anchor: [8.534, 47.366], arc: [94, 264] },
  // Asia / other
  // Central, with Victoria Harbour to the north. [70,290] was measured at one
  // pin in the harbour; the dry wedge is the southern half, and the radius
  // needs capping at 700 m before the fan reaches the waterfront.
  hongkong: { anchor: [114.1585, 22.282], arc: [208, 340], maxKm: 0.7 },
  singapore: { anchor: [103.8505, 1.281], arc: [190, 350] }, // Raffles Place; avoid Marina (E)
  shanghai: { anchor: [121.475, 31.231] }, // People's Sq (inland Puxi); off the Huangpu
};

// Golden-ratio low-discrepancy sequence — even coverage without clumping.
const GR = 0.6180339887498949;

// Land-aware version of spreadCoords: compact (radius capped, scaling gently
// with n), optionally anchored at a real CBD point and restricted to a bearing
// arc so pins stay on land. Falls back to a full-circle capped fan when the city
// has no placement override.
export function spreadCoordsCity(
  center: [number, number],
  n: number,
  place?: CityPlacement,
): [number, number][] {
  const c = place?.anchor ?? center;
  const kmToLat = 1 / 111.32;
  const kmToLng = 1 / (111.32 * Math.max(0.2, Math.cos((c[1] * Math.PI) / 180)));
  const maxKm = place?.maxKm ?? Math.min(1.15, 0.4 + 0.055 * Math.sqrt(Math.max(1, n)));
  const arc = place?.arc;
  let span = arc ? arc[1] - arc[0] : 360;
  if (span <= 0) span += 360; // wrap (e.g. [285,75] → 150° through north)
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n) * maxKm; // km from anchor, sqrt = even areal density
    const deg = arc ? arc[0] + ((i * GR) % 1) * span : (i * 137.50776405) % 360;
    const rad = (deg * Math.PI) / 180;
    // bearing 0=N, 90=E: east = sin, north = cos
    out.push([
      +(c[0] + Math.sin(rad) * r * kmToLng).toFixed(6),
      +(c[1] + Math.cos(rad) * r * kmToLat).toFixed(6),
    ]);
  }
  return out;
}

// Per-group skill + role templates for the generated cards.
const GROUP_PROFILE: Record<
  string,
  { skills: string[]; roles: string[]; sector: string; salary: number }
> = {
  "Financial Services": {
    skills: [
      "Risk & Compliance",
      "Quantitative Analysis",
      "Corporate Finance",
      "Data Analytics",
      "Wealth Management",
    ],
    roles: ["Markets & Trading", "Risk & Compliance", "Technology"],
    sector: "Financial Services",
    salary: 155,
  },
  "Technology, Media and Telecommunications": {
    skills: [
      "Software Engineering",
      "Cloud & Data",
      "Product Management",
      "Machine Learning",
      "Cybersecurity",
    ],
    roles: ["Engineering", "Product & Design", "Go-to-market"],
    sector: "Technology, Media & Telecom",
    salary: 165,
  },
  "Consumer and Retail": {
    skills: [
      "Retail Operations",
      "Supply Chain",
      "Merchandising",
      "Brand Marketing",
      "Data Analytics",
    ],
    roles: ["Store & Customer Ops", "Supply Chain", "Corporate"],
    sector: "Consumer & Retail",
    salary: 120,
  },
  "Energy & Natural Resources": {
    skills: ["Process Engineering", "HSE", "Maintenance", "Metallurgy", "Project Delivery"],
    roles: ["Operations", "Engineering", "Maintenance"],
    sector: "Energy & Natural Resources",
    salary: 145,
  },
  "Healthcare and Life Sciences": {
    skills: [
      "Clinical Research",
      "Regulatory Affairs",
      "Bioprocessing",
      "Quality Assurance",
      "Data Science",
    ],
    roles: ["R&D", "Manufacturing & Quality", "Commercial"],
    sector: "Healthcare & Life Sciences",
    salary: 150,
  },
  "Industrial Manufacturing": {
    skills: [
      "Mechanical Engineering",
      "Manufacturing",
      "Supply Chain",
      "Automation",
      "Project Delivery",
    ],
    roles: ["Engineering", "Production & Trades", "Operations"],
    sector: "Industrial Manufacturing",
    salary: 135,
  },
  "Infrastructure and Government": {
    skills: [
      "Civil Engineering",
      "Asset Management",
      "Operations",
      "Project Delivery",
      "Sustainability",
    ],
    roles: ["Operations", "Engineering & Projects", "Corporate"],
    sector: "Infrastructure & Government",
    salary: 138,
  },
};
const DEFAULT_PROFILE = GROUP_PROFILE["Energy & Natural Resources"];

// Build a full illustrative Company record from a compact roster entry.
export function buildRosterCompany(
  city: string,
  cityExchange: string,
  entry: RosterEntry,
): Company {
  const [ticker, name, group, exOverride, pillOverride] = entry;
  const exchange = exOverride || cityExchange;
  const pill = pillOverride || (ACRONYM_CITIES.has(city) ? nameAcronym(name) : undefined);
  const prof = GROUP_PROFILE[group] || DEFAULT_PROFILE;
  const h = hash01(ticker + name);
  const h2 = hash01(name + "::b");
  const headcount = Math.round(400 + h * 39600); // 400 .. 40,000
  const growth = +(-2 + h2 * 12).toFixed(1); // -2 .. +10
  const salaryNum = Math.round((prof.salary + (h - 0.5) * 30) * 1000);
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(7 + h2 * 9).toFixed(1);
  const startT = Math.round(60 + h * 30);
  const trend = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.round(startT + ((100 - startT) * i) / 7));
  const roleCounts = [3, 2, 1].map((w, i) => 12 + Math.round(h * 60 * w) + i);
  const roles: RoleBreakdown[] = prof.roles.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.45) * 30);
  const metro = `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}% vs metro`;
  return {
    id: rosterId(city, ticker),
    ticker,
    name,
    pill,
    domain: deriveDomain(name),
    sector: prof.sector,
    group,
    exchange,
    headcount,
    growth,
    openRoles: Math.round(20 + h * 380),
    salary: `$${salaryNum.toLocaleString("en-US")}`,
    salaryShort: `$${salaryK}K`,
    salaryNum,
    turnover,
    salaryDelta: `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`,
    metroDelta: metro,
    trend,
    revPerEmp: +(0.4 + h * 2.4).toFixed(2),
    ebitdaPerEmp: +(0.1 + h2 * 0.8).toFixed(2),
    timeToFill: `${Math.round(32 + h * 26)} days`,
    competition: h > 0.66 ? "Very high" : h > 0.33 ? "High" : "Medium",
    skills: prof.skills,
    roles,
  };
}
