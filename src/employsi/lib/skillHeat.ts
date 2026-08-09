import { ALL_SKILLS } from "../data/skillsTaxonomy";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { CITY_CONTINENT } from "../data/geo";
import { REGION_HUBS } from "../data/mapboxWorldGeo";
import {
  IVI_SKILL_BY_CITY,
  IVI_SKILLS,
  IVI_SERIES,
  IVI_MONTHS,
  IVI_SKILL_NATIONAL,
} from "../data/iviSkillDemand";
import { CA_SERIES, CA_SKILL_BY_CITY } from "../data/caVacancyDemand";
import { SG_SERIES, SG_SKILL_BY_CITY } from "../data/sgVacancyDemand";
import { NZ_SERIES, NZ_SKILL_BY_CITY } from "../data/nzVacancyDemand";
import { UK_SERIES, UK_SKILL_BY_CITY } from "../data/ukVacancyDemand";
import { EU_SERIES, EU_SKILL_BY_CITY } from "../data/euVacancyDemand";
import { HK_SERIES, HK_SKILL_BY_CITY } from "../data/hkVacancyDemand";
import { PH_SERIES, PH_SKILL_BY_CITY } from "../data/phVacancyDemand";
import { US_SERIES, US_SKILL_BY_CITY } from "../data/usVacancyDemand";
import type { SkillIndex } from "./skillsFn";
import { rankedByRate, vacancyRate } from "./vacancyRate";

/**
 * Which question the map and the rankings are answering.
 *
 *   volume — internet vacancies. Where are the most job ads.
 *   rate   — vacancies per 1,000 employed. Where is labour tightest relative to
 *            the pool already doing the work.
 *
 * They are different questions, not better and worse answers, which is why this
 * is a mode the user chooses rather than a replacement.
 *
 * RATE IS AUSTRALIA-ONLY, and the code must not paper over that. The denominator
 * is ABS employment by occupation; there is no equivalent wired up for Canada,
 * Singapore, NZ, the UK, the EU, the US, Hong Kong or the Philippines. In rate
 * mode those cities are ABSENT from the results rather than zero — a city with
 * no denominator has an unknown rate, and drawing it as cold would assert
 * slackness we have not measured.
 */
export type DemandMode = "volume" | "rate";

// The AU (JSA/IVI), Canada (StatCan), Singapore (MRSD), New Zealand (MBIE), UK
// (ONS), EU (Eurostat, by country), US (BLS OEWS × JOLTS, by metro), Hong Kong
// (C&SD, by industry) and Philippines (PSA ISLE, by occupation) vacancy
// series all share one month axis
// (IVI_MONTHS), so a skill's per-city history is just the countries' city maps
// merged. Keeping them combined here means the heat map + time slider treat
// every country like AU.
export function seriesFor(skill: string): Record<string, number[]> | null {
  const parts = [
    IVI_SERIES[skill],
    CA_SERIES[skill],
    SG_SERIES[skill],
    NZ_SERIES[skill],
    UK_SERIES[skill],
    EU_SERIES[skill],
    US_SERIES[skill],
    HK_SERIES[skill],
    PH_SERIES[skill],
  ].filter(Boolean) as Record<string, number[]>[];
  if (!parts.length) return null;
  return Object.assign({}, ...parts);
}
// Latest-month per-city demand, merged across all countries. Exported (with
// seriesFor above) so the analyst reads the SAME merge the heat map does — one
// place decides which national series are in play.
export function latestFor(skill: string): Record<string, number> {
  return {
    ...(IVI_SKILL_BY_CITY[skill] || {}),
    ...(CA_SKILL_BY_CITY[skill] || {}),
    ...(SG_SKILL_BY_CITY[skill] || {}),
    ...(NZ_SKILL_BY_CITY[skill] || {}),
    ...(UK_SKILL_BY_CITY[skill] || {}),
    ...(EU_SKILL_BY_CITY[skill] || {}),
    ...(US_SKILL_BY_CITY[skill] || {}),
    ...(HK_SKILL_BY_CITY[skill] || {}),
    ...(PH_SKILL_BY_CITY[skill] || {}),
  };
}

// Demand level for a skill, bucketed Low / Moderate / High and coloured
// green / amber / red — contextual to the layer the search was made on:
//   • domestic → the AU IVI national vacancy count (whole labour market)
//   • global   → the live company/hub demand index
// Bucketing is relative to the distribution of all skills at that layer, so the
// label answers "how in-demand is this skill, here" rather than a raw count.
export type DemandTone = "lo" | "mid" | "hi";
export interface DemandBadge {
  label: string;
  tone: DemandTone;
}
const qtile = (arr: number[], p: number): number =>
  arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : 0;
const IVI_SORTED = Object.values(IVI_SKILL_NATIONAL)
  .filter((v) => v > 0)
  .sort((a, b) => a - b);
const IVI_LO = qtile(IVI_SORTED, 0.34);
const IVI_HI = qtile(IVI_SORTED, 0.67);

/**
 * The national rate distribution, for bucketing and percentiles in rate mode.
 *
 * Built once from the latest month. Skills with no denominator are absent here
 * exactly as they are absent from rankedByRate — including them at 0 would put
 * unmeasured skills at the bottom of the scale and make every measured skill
 * look tighter than it is.
 */
const RATE_LATEST: Record<string, number> = Object.fromEntries(
  rankedByRate("national", IVI_MONTHS[IVI_MONTHS.length - 1]).map((r) => [r.skill, r.rate]),
);
const RATE_SORTED = Object.values(RATE_LATEST).sort((a, b) => a - b);
const RATE_LO = qtile(RATE_SORTED, 0.34);
const RATE_HI = qtile(RATE_SORTED, 0.67);

export function demandLevel(
  skill: string,
  global: boolean,
  idx: SkillIndex | null,
  mode: DemandMode = "volume",
): DemandBadge {
  let v: number;
  let lo: number;
  let hi: number;
  if (!global && mode === "rate") {
    // A skill with no denominator gets no band. Falling through to the volume
    // buckets would label it from a different metric while the UI said "rate",
    // which is the kind of quiet substitution that makes a number untrustworthy.
    const r = RATE_LATEST[skill];
    if (r === undefined) return { label: "Rate unavailable", tone: "lo" };
    if (r >= RATE_HI && RATE_HI > 0) return { label: "Tight labour", tone: "hi" };
    if (r >= RATE_LO && RATE_LO > 0) return { label: "Moderately tight", tone: "mid" };
    return { label: "Loose labour", tone: "lo" };
  }
  if (global) {
    const totals = idx
      ? Object.values(idx.skills)
          .map((s) => s.total)
          .filter((x) => x > 0)
          .sort((a, b) => a - b)
      : [];
    v = idx?.skills[skill]?.total ?? 0;
    lo = qtile(totals, 0.34);
    hi = qtile(totals, 0.67);
  } else {
    v = IVI_SKILL_NATIONAL[skill] ?? 0;
    lo = IVI_LO;
    hi = IVI_HI;
  }
  if (v >= hi && hi > 0) return { label: "High demand", tone: "hi" };
  if (v >= lo && lo > 0) return { label: "Moderate demand", tone: "mid" };
  return { label: "Low demand", tone: "lo" };
}

/**
 * Where a skill sits in the demand distribution, 0–100.
 *
 * demandLevel() above buckets the same value into Low / Moderate / High; this
 * returns the underlying position so the search card can put a marker on the
 * scale rather than only naming the band. It is a real percentile — the share
 * of skills with less demand than this one — not a score out of 100, so a skill
 * at 90 genuinely has more demand than 90% of the taxonomy.
 */
export function demandPercentile(
  skill: string,
  global: boolean,
  idx: SkillIndex | null,
  mode: DemandMode = "volume",
): number {
  if (!global && mode === "rate") {
    const v = RATE_LATEST[skill];
    if (v === undefined || !RATE_SORTED.length) return 0;
    return Math.round((RATE_SORTED.filter((x) => x < v).length / RATE_SORTED.length) * 100);
  }
  const values = global
    ? idx
      ? Object.values(idx.skills)
          .map((s) => s.total)
          .filter((x) => x > 0)
      : []
    : Object.values(IVI_SKILL_NATIONAL).filter((v) => v > 0);
  const v = global ? (idx?.skills[skill]?.total ?? 0) : (IVI_SKILL_NATIONAL[skill] ?? 0);
  if (!values.length || v <= 0) return 0;
  const below = values.filter((x) => x < v).length;
  return Math.round((below / values.length) * 100);
}

// Real government vacancy demand for a skill across the mapped hub cities — the
// AU capital hubs (JSA/IVI) plus the Canadian hubs (StatCan). Empty when the
// skill has no such demand. Used to colour the domestic heat map with
// whole-of-market government data.
export function iviCityDemand(skill: string | null): Record<string, number> {
  if (!skill) return {};
  return latestFor(skill);
}

// Same, but at a specific month in the shared IVI/StatCan history (index into
// IVI_MONTHS), so the time slider can scrub the heat map back through the series.
// Falls back to the latest month when the index is out of range.
export function iviCityDemandAt(
  skill: string | null,
  monthIndex: number,
  mode: DemandMode = "volume",
): Record<string, number> {
  if (!skill) return {};
  const series = seriesFor(skill);
  if (!series) return {};
  const last = IVI_MONTHS.length - 1;
  const i = monthIndex < 0 || monthIndex > last ? last : monthIndex;
  if (mode === "rate") {
    // Only the cities that have BOTH sides appear. vacancyRate returns null for
    // a city with no ABS denominator — every non-AU hub, and the handful of
    // AU skill/territory pairs with no measured employment — and those are
    // omitted rather than coerced to 0. See DemandMode.
    const out: Record<string, number> = {};
    for (const city of Object.keys(series)) {
      const r = vacancyRate(skill, city, IVI_MONTHS[i]);
      if (r !== null) out[city] = r;
    }
    return out;
  }
  const out: Record<string, number> = {};
  for (const city of Object.keys(series)) out[city] = series[city][i] ?? 0;
  return out;
}

// Per-city % change in demand for a skill AT the given month, measured over a
// trailing window (default ~12 months = year-on-year momentum, or since the
// series start when there's less history). Drives the scrub callouts: as the
// time slider moves, each city shows how its demand for the skill is changing
// at that point in time. Cities with no baseline demand return 0.
export function iviCityChangeAt(
  skill: string | null,
  monthIndex: number,
  window = 12,
): Record<string, number> {
  if (!skill) return {};
  const series = seriesFor(skill);
  if (!series) return {};
  const last = IVI_MONTHS.length - 1;
  const i = monthIndex < 0 || monthIndex > last ? last : monthIndex;
  const b = Math.max(0, i - window);
  const out: Record<string, number> = {};
  for (const city of Object.keys(series)) {
    const base = series[city][b] ?? 0;
    const cur = series[city][i] ?? 0;
    out[city] = base > 0 ? ((cur - base) / base) * 100 : 0;
  }
  return out;
}

// The canonical skill a search query resolves to (exact, case-insensitive), or
// null if the query isn't a tracked skill. When non-null the maps switch from
// the salary/growth metric to real demand for that skill.
export function activeSkill(query: string): string | null {
  const q = (query || "").trim().toLowerCase();
  if (!q) return null;
  return ALL_SKILLS.find((s) => s.toLowerCase() === q) || null;
}

// Real demand counts for a skill, keyed by company id / city. Empty object when
// the index hasn't loaded or the skill has no demand yet.
export function demandByCompany(
  idx: SkillIndex | null,
  skill: string | null,
): Record<string, number> {
  if (!idx || !skill) return {};
  return idx.skills[skill]?.byCompany ?? {};
}
export function demandByCity(idx: SkillIndex | null, skill: string | null): Record<string, number> {
  if (!idx || !skill) return {};
  return idx.skills[skill]?.byCity ?? {};
}

// A city's whole-market vacancy demand per skill — AU capitals (JSA/IVI) plus the
// Canadian / Singapore / NZ / UK / EU hubs. Covers gov-heavy cities like Darwin /
// Hobart / Canberra that carry no mapped-company signal. Values are real job-ad /
// vacancy counts, so they can be summed directly with the company signal below.
function cityMarketDemand(city: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of ALL_SKILLS) {
    const v =
      (IVI_SKILL_BY_CITY[s]?.[city] || 0) +
      (CA_SKILL_BY_CITY[s]?.[city] || 0) +
      (SG_SKILL_BY_CITY[s]?.[city] || 0) +
      (NZ_SKILL_BY_CITY[s]?.[city] || 0) +
      (UK_SKILL_BY_CITY[s]?.[city] || 0) +
      (EU_SKILL_BY_CITY[s]?.[city] || 0) +
      (US_SKILL_BY_CITY[s]?.[city] || 0);
    if (v > 0) out[s] = v;
  }
  return out;
}

// The job-ad demand per skill from the companies actually located in a city (the
// live jobs pipeline). Same unit (ad counts) as cityMarketDemand, so the two add.
function cityCompanyDemand(idx: SkillIndex | null, city: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!idx) return out;
  const ids = new Set((CITY_COMPANIES[city] || []).map((c) => c.id));
  if (!ids.size) return out;
  for (const [name, agg] of Object.entries(idx.skills)) {
    let d = 0;
    for (const [id, v] of Object.entries(agg.byCompany)) if (ids.has(id)) d += v;
    if (d > 0) out[name] = d;
  }
  return out;
}

const rankByCity = (byCitySkill: Record<string, Record<string, number>>): string[] =>
  Object.entries(byCitySkill)
    .map(([s, byCity]) => [s, Object.values(byCity).reduce((a, b) => a + b, 0)] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

// Merge two skill→city→count maps (union of skills and, within a skill, union of
// cities). Used to rank the Europe view across the UK (London) and the EU-country
// series together.
function mergeByCity(
  a: Record<string, Record<string, number>>,
  b: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const src of [a, b]) {
    for (const [s, byCity] of Object.entries(src)) {
      out[s] = { ...(out[s] || {}), ...byCity };
    }
  }
  return out;
}

// Whole-of-market demand per skill for each domestic view that has a government
// vacancy series behind it. North America combines Canada (StatCan) and the US
// (BLS), and Europe the UK (ONS) and the EU countries (Eurostat), so a regional
// ranking reflects the whole region rather than whichever country was wired first.
const NORTHAMERICA_SKILLS: string[] = rankByCity(mergeByCity(CA_SKILL_BY_CITY, US_SKILL_BY_CITY));
const SG_SKILLS: string[] = rankByCity(SG_SKILL_BY_CITY);
const EUROPE_SKILLS: string[] = rankByCity(mergeByCity(UK_SKILL_BY_CITY, EU_SKILL_BY_CITY));

// Popular skills for the current map layer, ranked by real demand and always
// contextual to the layer the user is on:
//   • local    → an aggregate of that city's whole-market vacancy demand
//                (IVI/StatCan/etc.) AND its mapped companies' live job ads,
//                padded from region- then world-demand when the city is data-poor
//   • domestic → Australia: IVI national; North America: Canada + US; Europe:
//                UK + EU; Asia: Singapore; other regions: summed across the
//                region's hub companies
//   • global   → summed across every company worldwide
export interface LayerCtx {
  zoomedOut: boolean;
  globalOut: boolean;
  domesticRegion: string;
  localCity: string;
}
export function popularSkills(
  idx: SkillIndex | null,
  ctx: LayerCtx,
  n = 10,
  mode: DemandMode = "volume",
): string[] {
  // Domestic views with a whole-of-market government vacancy series.
  if (ctx.zoomedOut && !ctx.globalOut) {
    if (ctx.domesticRegion === "australia" && IVI_SKILLS.length) {
      // Australia is the only region with a supply side, so it is the only one
      // whose ranking can change with the mode. The others keep their volume
      // ordering rather than being silently left in a mode they cannot honour.
      if (mode === "rate") {
        const ranked = rankedByRate("national", IVI_MONTHS[IVI_MONTHS.length - 1]);
        if (ranked.length) return ranked.slice(0, n).map((r) => r.skill);
      }
      return IVI_SKILLS.slice(0, n);
    }
    if (ctx.domesticRegion === "northamerica" && NORTHAMERICA_SKILLS.length)
      return NORTHAMERICA_SKILLS.slice(0, n);
    if (ctx.domesticRegion === "asia" && SG_SKILLS.length) return SG_SKILLS.slice(0, n);
    if (ctx.domesticRegion === "europe" && EUROPE_SKILLS.length) return EUROPE_SKILLS.slice(0, n);
  }
  // Local city: an AGGREGATED view of what's in high demand in that city — the
  // whole-market vacancy demand (IVI/StatCan/etc.) blended with the mapped
  // companies' live job ads. The two are on wildly different scales (the whole
  // market is thousands of ads; a handful of mapped employers, tens), so a raw
  // sum would bury the companies. Instead each source is normalised to its own
  // top skill (0..1) and then blended, with the company signal weighted a little
  // HIGHER so the city's signature employers punch through — e.g. Perth's mining
  // skills rise to sit alongside the broad admin/education demand rather than
  // being drowned by it. When a city has little or no local signal (most global
  // hubs carry no whole-market series and no scraped ads) we pad from its
  // region's demand ranking and then global demand — never the raw taxonomy
  // order, whose head is mining-heavy and would show the same wrong list on
  // every data-poor city.
  if (!ctx.zoomedOut) {
    const norm = (m: Record<string, number>): Record<string, number> => {
      const mx = Math.max(0, ...Object.values(m));
      if (mx <= 0) return {};
      const o: Record<string, number> = {};
      for (const [s, v] of Object.entries(m)) o[s] = v / mx;
      return o;
    };
    const market = norm(cityMarketDemand(ctx.localCity));
    const company = norm(cityCompanyDemand(idx, ctx.localCity));
    const COMPANY_WEIGHT = 1.25; // > 1 so mapped-employer character punches through
    const score: Record<string, number> = {};
    for (const [s, v] of Object.entries(market)) score[s] = (score[s] || 0) + v;
    for (const [s, v] of Object.entries(company)) score[s] = (score[s] || 0) + v * COMPANY_WEIGHT;
    const out = Object.entries(score)
      .sort((a, b) => b[1] - a[1])
      .map(([s]) => s);
    if (out.length < n) {
      const region = CITY_CONTINENT[ctx.localCity] || ctx.domesticRegion;
      const pad = (list: string[]) => {
        for (const s of list) {
          if (out.length >= n) break;
          if (!out.includes(s)) out.push(s);
        }
      };
      // Region-level demand (domestic), then worldwide demand (global) — both
      // are demand-ranked from real data, so a data-poor city still gets a
      // sensible, region-appropriate list rather than the mining taxonomy head.
      pad(
        popularSkills(
          idx,
          { zoomedOut: true, globalOut: false, domesticRegion: region, localCity: ctx.localCity },
          n,
        ),
      );
      if (out.length < n)
        pad(
          popularSkills(
            idx,
            { zoomedOut: true, globalOut: true, domesticRegion: region, localCity: ctx.localCity },
            n,
          ),
        );
    }
    return out.slice(0, n);
  }
  // Other domestic regions / global: rank from the company index.
  if (!idx) return ALL_SKILLS.slice(0, n);
  let demandOf: (agg: SkillIndex["skills"][string]) => number;
  if (ctx.globalOut) {
    demandOf = (agg) => agg.total;
  } else {
    const cities = new Set(REGION_HUBS[ctx.domesticRegion] || []);
    demandOf = (agg) =>
      Object.entries(agg.byCity).reduce((s, [c, v]) => s + (cities.has(c) ? v : 0), 0);
  }
  const ranked = Object.entries(idx.skills)
    .map(([name, agg]) => [name, demandOf(agg)] as const)
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
  return ranked.length ? ranked : ALL_SKILLS.slice(0, n);
}
