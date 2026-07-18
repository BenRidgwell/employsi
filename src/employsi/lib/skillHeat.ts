import { ALL_SKILLS } from '../data/skillsTaxonomy';
import type { SkillIndex } from './skillsFn';

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
