import type { Company, RoleBreakdown } from './companies';

// ── Compact global company rosters ────────────────────────────────────────
// Adding a company to a city is just one line: [ticker, name, group]. Full
// Company records, head-office coordinates and illustrative financials are
// GENERATED from these; the live share price (Yahoo Finance) and live news
// (GDELT) fill the real figures at runtime by ticker. This keeps hundreds of
// listings maintainable without hand-writing every field.

// [ticker, name, group, exchange?, pill?] — exchange overrides the city
// default (e.g. NASDAQ names in a NYSE-default US city); pill overrides the map
// label (e.g. a name acronym for markets with numeric tickers).
export type RosterEntry = [ticker: string, name: string, group: string, exchange?: string, pill?: string];

// Cities whose exchanges use numeric tickers (HK/Shanghai/Shenzhen/Tokyo/
// Korea): a bare ticker like "00700" is a meaningless pill, so map labels there
// show a short acronym of the company name instead. The ticker still drives
// search, so the company remains findable by its listing code.
const ACRONYM_CITIES = new Set(['hongkong', 'tokyo', 'seoul', 'ganzhou', 'beijing']);

// Corporate-form words that don't belong in an acronym / brand label.
const DROP_WORDS = new Set([
  'holdings', 'holding', 'corporation', 'corp', 'group', 'limited', 'ltd',
  'company', 'co', 'international', 'inc', 'incorporated', 'plc', 'the',
]);
const STOP_WORDS = new Set(['and', 'of', 'the', '&']);

// Real primary domains for companies whose website doesn't follow the
// "significant words joined + .com" heuristic below (banks/telecoms with
// acronym brands, or where the obvious guess is wrong). Everything not listed
// falls back to the heuristic, which is correct for most single-brand names
// (xiaomi.com, tencent.com, alibaba.com, chinamobile.com, …).
const KNOWN_DOMAINS: Record<string, string> = {
  'industrial and commercial bank of china': 'icbc.com.cn',
  'agricultural bank of china': 'abchina.com',
  'bank of china': 'boc.cn',
  'china construction bank': 'ccb.com',
  'china life insurance company': 'e.chinalife.com.cn',
  "people's insurance company of china": 'picc.com',
  'postal savings bank of china': 'psbc.com',
  'china state construction engineering': 'cscec.com',
  'china yangtze power': 'cypc.com.cn',
  'huaneng power international': 'hpi.com.cn',
  'china shenhua energy': 'csenergy.com.cn',
  'china telecom': 'chinatelecom-h.com',
  'china unicom': 'chinaunicom.com',
  'petrochina': 'petrochina.com.cn',
  'sinotrans limited': 'sinotrans.com',
  'beijing shougang': 'shougang.com.cn',
  'boe technology': 'boe.com',
  'jd.com': 'jd.com',
  'pop mart': 'popmart.com',
  'netease': 'neteasegames.com',
  'boc hong kong': 'bochk.com',
  'aia group': 'aia.com',
  'ck hutchison holdings': 'ckh.com.hk',
  'ck infrastructure holdings': 'cki.com.hk',
  'hong kong exchanges and clearing': 'hkex.com.hk',
  'sun hung kai properties': 'shkp.com',
  'hang seng bank': 'hangseng.com',
  'hsbc holdings': 'hsbc.com',
  'mtr corporation': 'mtr.com.hk',
  'techtronic industries': 'ttigroup.com',
  'link reit': 'linkreit.com',
  'wh group': 'wh-group.com',
  'softbank group': 'group.softbank',
  'mitsui & co.': 'mitsui.com',
  'itochu corporation': 'itochu.co.jp',
  'recruit holdings': 'recruit-holdings.com',
  'sk hynix': 'skhynix.com',
  'sk inc.': 'sk.com',
  'sk telecom': 'sktelecom.com',
  'lg energy solution': 'lgensol.com',
  'lg chem': 'lgchem.com',
  'lg electronics': 'lge.com',
  'kb financial group': 'kbfg.com',
  'shinhan financial group': 'shinhangroup.com',
  'woori financial group': 'woorifg.com',
  'samsung electronics': 'samsung.com',
  'samsung life insurance': 'samsunglife.com',
  'samsung c&t': 'samsungcnt.com',
  'hyundai motor company': 'hyundai.com',
  'kia corporation': 'kia.com',
  'korea zinc': 'koreazinc.co.kr',
  'korean air': 'koreanair.com',
  'industrial bank of korea': 'ibk.co.kr',
};

// Best-effort primary domain for a company, so the card logo (Google favicon
// service, keyed on domain) shows the real brand mark. Uses KNOWN_DOMAINS where
// the site doesn't match the heuristic, else joins the significant name words.
export function deriveDomain(name: string): string {
  const key = name.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (KNOWN_DOMAINS[key]) return KNOWN_DOMAINS[key];
  const cleaned = name.replace(/\([^)]*\)/g, ' ').toLowerCase();
  const words = cleaned
    .split(/[\s.,/&'-]+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w) && !DROP_WORDS.has(w));
  const joined = (words.join('') || cleaned.replace(/[^a-z0-9]/g, '')).replace(/[^a-z0-9]/g, '');
  return `${joined || 'example'}.com`;
}

// Build a short pill label from a company name: initials for multi-word names
// (INDUSTRIAL COMMERCIAL BANK CHINA -> ICBC), the brand word itself for
// single-word names (Tencent Holdings -> Tencent).
export function nameAcronym(name: string): string {
  const cleaned = name.replace(/\([^)]*\)/g, ' ');
  const words = cleaned.split(/[\s.,/-]+/).filter(Boolean);
  const sig = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const core = sig.filter((w) => !DROP_WORDS.has(w.toLowerCase()));
  const use = core.length ? core : sig;
  if (use.length >= 2) return use.map((w) => w[0].toUpperCase()).join('').slice(0, 5);
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
  return `${city}-${ticker}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
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
    out.push([+(center[0] + Math.cos(a) * r * lngScale).toFixed(6), +(center[1] + Math.sin(a) * r * latScale).toFixed(6)]);
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
export const CITY_PLACEMENT: Record<string, CityPlacement> = {
  // Australia
  sydney: { arc: [150, 330] }, // avoid Sydney Harbour (N/NE)
  melbourne: { arc: [330, 140] }, // avoid Yarra (S) + Docklands (W)
  brisbane: { arc: [285, 75] }, // inside the river U-bend → land is N/NE
  // North America
  toronto: { arc: [285, 75] }, // avoid Lake Ontario (S)
  chicago: { arc: [175, 355] }, // avoid Lake Michigan (E)
  boston: { arc: [150, 360] }, // avoid the harbour (E)
  newyork: { anchor: [-73.9945, 40.7205], arc: [300, 60], maxKm: 1.4 }, // narrow Manhattan, run N-S
  sanfrancisco: { arc: [150, 340] }, // avoid the bay (E/NE)
  seattle: { arc: [20, 200] }, // avoid Elliott Bay (W)
  vancouver: { arc: [90, 200] }, // avoid Burrard Inlet (N) + English Bay (W)
  // Asia / other
  hongkong: { anchor: [114.1585, 22.282], arc: [70, 290] }, // Central; avoid Victoria Harbour (N)
  singapore: { anchor: [103.8505, 1.281], arc: [190, 350] }, // Raffles Place; avoid Marina (E)
  shanghai: { anchor: [121.475, 31.231] }, // People's Sq (inland Puxi); off the Huangpu
};

// Golden-ratio low-discrepancy sequence — even coverage without clumping.
const GR = 0.6180339887498949;

// Land-aware version of spreadCoords: compact (radius capped, scaling gently
// with n), optionally anchored at a real CBD point and restricted to a bearing
// arc so pins stay on land. Falls back to a full-circle capped fan when the city
// has no placement override.
export function spreadCoordsCity(center: [number, number], n: number, place?: CityPlacement): [number, number][] {
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
const GROUP_PROFILE: Record<string, { skills: string[]; roles: string[]; sector: string; salary: number }> = {
  'Financial Services': { skills: ['Risk & Compliance', 'Quantitative Analysis', 'Corporate Finance', 'Data Analytics', 'Wealth Management'], roles: ['Markets & Trading', 'Risk & Compliance', 'Technology'], sector: 'Financial Services', salary: 155 },
  'Technology, Media and Telecommunications': { skills: ['Software Engineering', 'Cloud & Data', 'Product Management', 'Machine Learning', 'Cybersecurity'], roles: ['Engineering', 'Product & Design', 'Go-to-market'], sector: 'Technology, Media & Telecom', salary: 165 },
  'Consumer and Retail': { skills: ['Retail Operations', 'Supply Chain', 'Merchandising', 'Brand Marketing', 'Data Analytics'], roles: ['Store & Customer Ops', 'Supply Chain', 'Corporate'], sector: 'Consumer & Retail', salary: 120 },
  'Energy & Natural Resources': { skills: ['Process Engineering', 'HSE', 'Maintenance', 'Metallurgy', 'Project Delivery'], roles: ['Operations', 'Engineering', 'Maintenance'], sector: 'Energy & Natural Resources', salary: 145 },
  'Healthcare and Life Sciences': { skills: ['Clinical Research', 'Regulatory Affairs', 'Bioprocessing', 'Quality Assurance', 'Data Science'], roles: ['R&D', 'Manufacturing & Quality', 'Commercial'], sector: 'Healthcare & Life Sciences', salary: 150 },
  'Industrial Manufacturing': { skills: ['Mechanical Engineering', 'Manufacturing', 'Supply Chain', 'Automation', 'Project Delivery'], roles: ['Engineering', 'Production & Trades', 'Operations'], sector: 'Industrial Manufacturing', salary: 135 },
  'Infrastructure and Government': { skills: ['Civil Engineering', 'Asset Management', 'Operations', 'Project Delivery', 'Sustainability'], roles: ['Operations', 'Engineering & Projects', 'Corporate'], sector: 'Infrastructure & Government', salary: 138 },
};
const DEFAULT_PROFILE = GROUP_PROFILE['Energy & Natural Resources'];

// Build a full illustrative Company record from a compact roster entry.
export function buildRosterCompany(city: string, cityExchange: string, entry: RosterEntry): Company {
  const [ticker, name, group, exOverride, pillOverride] = entry;
  const exchange = exOverride || cityExchange;
  const pill = pillOverride || (ACRONYM_CITIES.has(city) ? nameAcronym(name) : undefined);
  const prof = GROUP_PROFILE[group] || DEFAULT_PROFILE;
  const h = hash01(ticker + name);
  const h2 = hash01(name + '::b');
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
  const metro = `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}% vs metro`;
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
    salary: `$${salaryNum.toLocaleString('en-US')}`,
    salaryShort: `$${salaryK}K`,
    salaryNum,
    turnover,
    salaryDelta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`,
    metroDelta: metro,
    trend,
    revPerEmp: +(0.4 + h * 2.4).toFixed(2),
    ebitdaPerEmp: +(0.1 + h2 * 0.8).toFixed(2),
    timeToFill: `${Math.round(32 + h * 26)} days`,
    competition: h > 0.66 ? 'Very high' : h > 0.33 ? 'High' : 'Medium',
    skills: prof.skills,
    roles,
  };
}
