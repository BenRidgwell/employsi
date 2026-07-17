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
    domain: '',
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
