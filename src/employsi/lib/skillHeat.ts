import { ALL_SKILLS } from '../data/skillsTaxonomy';
import { CITY_COMPANIES } from '../data/mapboxGeo';
import { REGION_HUBS } from '../data/mapboxWorldGeo';
import { IVI_SKILL_BY_CITY, IVI_SKILLS, IVI_SERIES, IVI_MONTHS, IVI_SKILL_NATIONAL } from '../data/iviSkillDemand';
import type { SkillIndex } from './skillsFn';

// Demand level for a skill, bucketed Low / Moderate / High and coloured
// green / amber / red — contextual to the layer the search was made on:
//   • domestic → the AU IVI national vacancy count (whole labour market)
//   • global   → the live company/hub demand index
// Bucketing is relative to the distribution of all skills at that layer, so the
// label answers "how in-demand is this skill, here" rather than a raw count.
export type DemandTone = 'lo' | 'mid' | 'hi';
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

export function demandLevel(skill: string, global: boolean, idx: SkillIndex | null): DemandBadge {
  let v: number;
  let lo: number;
  let hi: number;
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
  if (v >= hi && hi > 0) return { label: 'High demand', tone: 'hi' };
  if (v >= lo && lo > 0) return { label: 'Moderate demand', tone: 'mid' };
  return { label: 'Low demand', tone: 'lo' };
}

// Real Jobs & Skills Australia IVI internet-vacancy demand for a skill across the
// AU capital-city hubs (WA→Perth, SA→Adelaide, QLD→Brisbane, VIC→Melbourne,
// NSW→Sydney). Empty when the skill has no IVI demand. Used to colour the AU
// domestic heat map with whole-of-market government data.
export function iviCityDemand(skill: string | null): Record<string, number> {
  if (!skill) return {};
  return IVI_SKILL_BY_CITY[skill] || {};
}

// Same, but at a specific month in the IVI history (index into IVI_MONTHS), so
// the time slider can scrub the heat map back to 2006. Falls back to the latest
// month when the index is out of range.
export function iviCityDemandAt(skill: string | null, monthIndex: number): Record<string, number> {
  if (!skill) return {};
  const series = IVI_SERIES[skill];
  if (!series) return {};
  const last = IVI_MONTHS.length - 1;
  const i = monthIndex < 0 || monthIndex > last ? last : monthIndex;
  const out: Record<string, number> = {};
  for (const city of Object.keys(series)) out[city] = series[city][i] ?? 0;
  return out;
}

// Per-city % change in demand for a skill AT the given month, measured over a
// trailing window (default ~12 months = year-on-year momentum, or since the
// series start when there's less history). Drives the scrub callouts: as the
// time slider moves, each city shows how its demand for the skill is changing
// at that point in time. Cities with no baseline demand return 0.
export function iviCityChangeAt(skill: string | null, monthIndex: number, window = 12): Record<string, number> {
  if (!skill) return {};
  const series = IVI_SERIES[skill];
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
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  return ALL_SKILLS.find((s) => s.toLowerCase() === q) || null;
}

// Real demand counts for a skill, keyed by company id / city. Empty object when
// the index hasn't loaded or the skill has no demand yet.
export function demandByCompany(idx: SkillIndex | null, skill: string | null): Record<string, number> {
  if (!idx || !skill) return {};
  return idx.skills[skill]?.byCompany ?? {};
}
export function demandByCity(idx: SkillIndex | null, skill: string | null): Record<string, number> {
  if (!idx || !skill) return {};
  return idx.skills[skill]?.byCity ?? {};
}

// Popular skills for the current map layer, ranked by real live demand:
//   • local    → summed across the companies in the current city
//   • domestic → summed across the cities in the current region
//   • global   → summed across every city worldwide
// Falls back to the taxonomy order before the first cron run has any data.
export interface LayerCtx {
  zoomedOut: boolean;
  globalOut: boolean;
  domesticRegion: string;
  localCity: string;
}
export function popularSkills(idx: SkillIndex | null, ctx: LayerCtx, n = 10): string[] {
  // AU domestic view: rank by real Jobs & Skills Australia IVI demand — the
  // whole Australian labour market, not just the mapped companies. IVI_SKILLS is
  // pre-sorted by national vacancy count, so the head is the most in-demand.
  if (ctx.zoomedOut && !ctx.globalOut && ctx.domesticRegion === 'australia' && IVI_SKILLS.length) {
    return IVI_SKILLS.slice(0, n);
  }
  if (!idx) return ALL_SKILLS.slice(0, n);
  let demandOf: (agg: SkillIndex['skills'][string]) => number;
  if (!ctx.zoomedOut) {
    const ids = new Set((CITY_COMPANIES[ctx.localCity] || []).map((c) => c.id));
    demandOf = (agg) => Object.entries(agg.byCompany).reduce((s, [id, v]) => s + (ids.has(id) ? v : 0), 0);
  } else if (ctx.globalOut) {
    demandOf = (agg) => agg.total;
  } else {
    const cities = new Set(REGION_HUBS[ctx.domesticRegion] || []);
    demandOf = (agg) => Object.entries(agg.byCity).reduce((s, [c, v]) => s + (cities.has(c) ? v : 0), 0);
  }
  const ranked = Object.entries(idx.skills)
    .map(([name, agg]) => [name, demandOf(agg)] as const)
    .filter(([, d]) => d > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
  return ranked.length ? ranked : ALL_SKILLS.slice(0, n);
}
