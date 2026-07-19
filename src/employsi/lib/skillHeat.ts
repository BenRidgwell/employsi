import { ALL_SKILLS } from '../data/skillsTaxonomy';
import { CITY_COMPANIES } from '../data/mapboxGeo';
import { REGION_HUBS } from '../data/mapboxWorldGeo';
import { IVI_SKILL_BY_CITY, IVI_SKILLS } from '../data/iviSkillDemand';
import type { SkillIndex } from './skillsFn';

// Real Jobs & Skills Australia IVI internet-vacancy demand for a skill across the
// AU capital-city hubs (WA→Perth, SA→Adelaide, QLD→Brisbane, VIC→Melbourne,
// NSW→Sydney). Empty when the skill has no IVI demand. Used to colour the AU
// domestic heat map with whole-of-market government data.
export function iviCityDemand(skill: string | null): Record<string, number> {
  if (!skill) return {};
  return IVI_SKILL_BY_CITY[skill] || {};
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
