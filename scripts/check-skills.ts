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
import {
  ALL_SKILLS,
  SKILL_ALIAS,
  SKILL_CATEGORY,
  SKILL_NAME_CONFLICTS,
} from "../src/employsi/data/skillsTaxonomy";

let failed = false;

// 1. No duplicate canonical skill names in the exported list.
const counts = new Map<string, number>();
for (const s of ALL_SKILLS) counts.set(s, (counts.get(s) ?? 0) + 1);
const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);
if (dups.length) {
  failed = true;
  console.error(`✗ Duplicate skill names in ALL_SKILLS: ${dups.join(", ")}`);
} else {
  console.log(`✓ ${ALL_SKILLS.length} skills, all unique.`);
}

// SKILL_CATEGORY is keyed by name, so its size must equal the unique-name count.
if (Object.keys(SKILL_CATEGORY).length !== counts.size) {
  failed = true;
  console.error("✗ SKILL_CATEGORY key count does not match the unique skill count.");
}

// 2. No same-named defs with conflicting categories (silently dropped on merge).
if (SKILL_NAME_CONFLICTS.length) {
  failed = true;
  console.error(
    `✗ Duplicate skill names with mismatched categories: ${SKILL_NAME_CONFLICTS.join(", ")}`,
  );
} else {
  console.log("✓ No category conflicts among merged defs.");
}

// 3. No skill name stranded in the archive.
//
// The D1 archive freezes each listing's skills as JSON when the row is written,
// so renaming a canonical skill leaves every older row carrying the old string.
// Readers drop names they don't recognise, which means the demand is lost
// SILENTLY — nothing appears wrong, the skill is just quieter than it should be.
// One rename had already done this before anyone noticed: 245 rows held
// "Data Science & ML" after the skill became "Data Science & Machine Learning".
//
// So the archive is checked against the taxonomy. A stranded name is fixed by
// adding it to SKILL_ALIAS (which maps it forward on read) and backfilling the
// rows; this check then passes because the alias covers it.
//
// Skipped without D1 credentials, so the taxonomy checks above still run in a
// plain checkout — but the workflow supplies them, so CI does run it.
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB = process.env.JOBS_ARCHIVE_DB_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (ACCOUNT && DB && TOKEN) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT skills FROM jobs WHERE skills IS NOT NULL" }),
      },
    );
    const json = (await res.json()) as {
      success?: boolean;
      result?: { results?: { skills?: string }[] }[];
    };
    if (!json.success) throw new Error("D1 query failed");
    const seen = new Map<string, number>();
    for (const row of json.result?.[0]?.results ?? []) {
      let arr: unknown;
      try {
        arr = JSON.parse(row.skills ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const v of arr) {
        const name = String(v);
        if (name in SKILL_CATEGORY || name in SKILL_ALIAS) continue;
        seen.set(name, (seen.get(name) ?? 0) + 1);
      }
    }
    if (seen.size) {
      failed = true;
      console.error("✗ Archived skill names not in the taxonomy and not aliased:");
      for (const [name, n] of [...seen].sort((a, b) => b[1] - a[1])) {
        console.error(`    ${String(n).padStart(6)}  ${JSON.stringify(name)}`);
      }
      console.error(
        "  Fix: add each to SKILL_ALIAS pointing at its current name, then backfill the rows.",
      );
    } else {
      console.log("✓ Every archived skill name resolves to a current skill.");
    }
  } catch (e) {
    // A checking failure is not a taxonomy failure — say so and move on rather
    // than turning a network blip into a red build.
    console.log(`· Archive check skipped: ${(e as Error).message}`);
  }
} else {
  console.log("· Archive check skipped (no D1 credentials in the environment).");
}

if (failed) {
  console.error(
    "\nFix: add new match terms to the EXISTING def for that skill, " +
      "do not add a second def with the same name (and keep its category consistent).",
  );
  process.exit(1);
}
console.log("\nSkills taxonomy OK.");
