#!/usr/bin/env bun
/**
 * Skills-taxonomy integrity check — the automated guard that stops duplicate
 * skills from ever shipping again (see src/employsi/data/skillsTaxonomy.ts).
 *
 * Run by .github/workflows/skills-check.yml on every push/PR touching the
 * taxonomy, and locally with `bun run scripts/check-skills.ts`. Exits non-zero
 * (failing the build) if:
 *   1. ALL_SKILLS / SKILL_CATEGORY contain a duplicate canonical name, or
 *   2. two source defs share a name but disagree on category (a lossy merge).
 */
import { ALL_SKILLS, SKILL_CATEGORY, SKILL_NAME_CONFLICTS } from '../src/employsi/data/skillsTaxonomy';

let failed = false;

// 1. No duplicate canonical skill names in the exported list.
const counts = new Map<string, number>();
for (const s of ALL_SKILLS) counts.set(s, (counts.get(s) ?? 0) + 1);
const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);
if (dups.length) {
  failed = true;
  console.error(`✗ Duplicate skill names in ALL_SKILLS: ${dups.join(', ')}`);
} else {
  console.log(`✓ ${ALL_SKILLS.length} skills, all unique.`);
}

// SKILL_CATEGORY is keyed by name, so its size must equal the unique-name count.
if (Object.keys(SKILL_CATEGORY).length !== counts.size) {
  failed = true;
  console.error('✗ SKILL_CATEGORY key count does not match the unique skill count.');
}

// 2. No same-named defs with conflicting categories (silently dropped on merge).
if (SKILL_NAME_CONFLICTS.length) {
  failed = true;
  console.error(`✗ Duplicate skill names with mismatched categories: ${SKILL_NAME_CONFLICTS.join(', ')}`);
} else {
  console.log('✓ No category conflicts among merged defs.');
}

if (failed) {
  console.error('\nFix: add new match terms to the EXISTING def for that skill, '
    + 'do not add a second def with the same name (and keep its category consistent).');
  process.exit(1);
}
console.log('\nSkills taxonomy OK.');
