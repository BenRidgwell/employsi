import { ALL_SKILLS } from "../data/skillsTaxonomy";
import { IVI_MONTHS, IVI_SOURCE } from "../data/iviSkillDemand";
import { CA_SOURCE } from "../data/caVacancyDemand";
import { SG_SOURCE } from "../data/sgVacancyDemand";
import { NZ_SOURCE } from "../data/nzVacancyDemand";
import { UK_SOURCE } from "../data/ukVacancyDemand";
import { EU_SOURCE } from "../data/euVacancyDemand";
import { US_SOURCE } from "../data/usVacancyDemand";
import { CITY_COUNTRY } from "../data/mapboxWorldGeo";
import { CITY_LABEL, GLOBAL_HUB_LABEL } from "../data/geo";
import { seriesFor, latestFor } from "./skillHeat";

/**
 * The long-run side of "Ask an analyst".
 *
 * The D1 archive behind analystFn.ts only goes back as far as collection
 * started, so it can say what is open today but not how a market has moved over
 * years. That history does exist in this app: the national vacancy series the
 * heat map's time slider already runs on — Jobs and Skills Australia's IVI,
 * StatCan, Singapore MRSD, NZ MBIE, UK ONS, Eurostat and BLS OEWS×JOLTS — all
 * aligned to one 243-month axis (2006-03 → 2026-05).
 *
 * This module reads exactly the same merged series the map colours by (via
 * seriesFor/latestFor in skillHeat), aggregates it over whatever hubs a scope
 * covers, and derives the figures an analyst would quote: latest month, year on
 * year, five year, and the series peak. Every answer carries the statistical
 * agencies it came from, because "up 12% year on year" means nothing without
 * knowing whose count that is.
 *
 * Nothing here is modelled or projected. Where a scope has no coverage — most
 * of Asia, Africa and the Middle East have no published series in this app —
 * the functions return null and the analyst says so rather than interpolating.
 */

// Which agency publishes the series behind a given map key. Keys are hub cities
// except for the EU, whose series are country-level and sit on country codes.
const EU_COUNTRIES = new Set([
  "at",
  "be",
  "bg",
  "cy",
  "cz",
  "de",
  "dk",
  "ee",
  "el",
  "es",
  "fi",
  "fr",
  "hr",
  "hu",
  "ie",
  "it",
  "lt",
  "lu",
  "lv",
  "mt",
  "nl",
  "pl",
  "pt",
  "ro",
  "se",
  "si",
  "sk",
]);

export function sourceForKey(key: string): string | null {
  if (EU_COUNTRIES.has(key)) return EU_SOURCE;
  const country = CITY_COUNTRY[key];
  switch (country) {
    case "au":
      return IVI_SOURCE;
    case "ca":
      return CA_SOURCE;
    case "sg":
      return SG_SOURCE;
    case "nz":
      return NZ_SOURCE;
    case "gb":
      return UK_SOURCE;
    case "us":
      return US_SOURCE;
    case "fr":
    case "ch":
      return EU_COUNTRIES.has(country) ? EU_SOURCE : null;
    default:
      return null;
  }
}

function labelFor(key: string): string {
  return GLOBAL_HUB_LABEL[key] || CITY_LABEL[key] || key;
}

export interface SkillHistory {
  skill: string;
  /** Keys that actually contributed a series. */
  covered: string[];
  /** Summed monthly vacancies across `covered`, on the IVI_MONTHS axis. */
  series: number[];
  /** Index of the first month with any data, so short series aren't padded. */
  from: number;
  latest: number;
  latestMonth: string;
  yoy: number | null;
  fiveYear: number | null;
  peak: { month: string; v: number } | null;
  sources: string[];
  /** Per-key latest-month value, biggest first — "where the demand sits". */
  byKey: { key: string; label: string; v: number }[];
}

function pctChange(now: number, then: number): number | null {
  if (!then) return null;
  return ((now - then) / then) * 100;
}

/**
 * A skill's history summed over the keys of a scope.
 *
 * Returns null when no key in the scope has a published series for the skill,
 * which is a real and common answer — the taxonomy is global, the statistics
 * are not.
 */
export function skillHistory(skill: string, keys: string[]): SkillHistory | null {
  const byCity = seriesFor(skill);
  if (!byCity) return null;
  const scope = keys.length ? keys : Object.keys(byCity);
  const covered = scope.filter((k) => Array.isArray(byCity[k]) && byCity[k].some((v) => v > 0));
  if (!covered.length) return null;

  const series = new Array(IVI_MONTHS.length).fill(0);
  for (const k of covered) {
    const arr = byCity[k];
    for (let i = 0; i < series.length && i < arr.length; i++) series[i] += arr[i] || 0;
  }
  // Trim the leading run of months before ANY contributing series began; a
  // series that starts in 2017 (UK) must not read as a decade of zero demand.
  const from = series.findIndex((v) => v > 0);
  if (from < 0) return null;

  const last = series.length - 1;
  const latest = series[last];
  const yoy = last - 12 >= from ? pctChange(latest, series[last - 12]) : null;
  const fiveYear = last - 60 >= from ? pctChange(latest, series[last - 60]) : null;

  let peakIdx = from;
  for (let i = from; i <= last; i++) if (series[i] > series[peakIdx]) peakIdx = i;

  const latestByKey = latestFor(skill);
  const byKey = covered
    .map((k) => ({ key: k, label: labelFor(k), v: latestByKey[k] ?? 0 }))
    .filter((r) => r.v > 0)
    .sort((a, b) => b.v - a.v);

  const sources = [...new Set(covered.map(sourceForKey).filter(Boolean) as string[])];

  return {
    skill,
    covered,
    series,
    from,
    latest,
    latestMonth: IVI_MONTHS[last],
    yoy,
    fiveYear,
    peak: { month: IVI_MONTHS[peakIdx], v: series[peakIdx] },
    sources,
    byKey,
  };
}

export interface ScopeSkillRow {
  skill: string;
  latest: number;
  yoy: number | null;
}

/**
 * The biggest skills in a scope by latest-month published vacancies, with each
 * one's year-on-year move. This is the market-level answer for a question that
 * doesn't name a skill.
 */
export function topSkillsInScope(keys: string[], n = 5): ScopeSkillRow[] {
  const rows: ScopeSkillRow[] = [];
  for (const skill of ALL_SKILLS) {
    const h = skillHistory(skill, keys);
    if (!h || h.latest <= 0) continue;
    rows.push({ skill, latest: h.latest, yoy: h.yoy });
  }
  rows.sort((a, b) => b.latest - a.latest);
  return rows.slice(0, n);
}

/** Movers: the sharpest year-on-year changes among skills with real volume. */
export function moversInScope(keys: string[], n = 5): ScopeSkillRow[] {
  const rows: ScopeSkillRow[] = [];
  for (const skill of ALL_SKILLS) {
    const h = skillHistory(skill, keys);
    // A volume floor keeps a skill with 6 vacancies going to 12 out of the
    // "fastest growing" list, where it would be noise rather than signal.
    if (!h || h.yoy === null || h.latest < 200) continue;
    rows.push({ skill, latest: h.latest, yoy: h.yoy });
  }
  rows.sort((a, b) => Math.abs(b.yoy ?? 0) - Math.abs(a.yoy ?? 0));
  return rows.slice(0, n);
}

/**
 * Whether a scope has any published long-run coverage at all.
 *
 * An empty key list is the Worldwide scope — every series we hold — so it is
 * covered by definition; only a named area with no publishing agency is not.
 */
export function hasCoverage(keys: string[]): boolean {
  if (!keys.length) return true;
  return keys.some((k) => sourceForKey(k) !== null);
}

export const HISTORY_SPAN = `${IVI_MONTHS[0]} to ${IVI_MONTHS[IVI_MONTHS.length - 1]}`;
