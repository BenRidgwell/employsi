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
  skillsForText,
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

// 3. No seniority grade read as an education job.
//
// "Principal" names a school principal only in a school. Everywhere else it is
// a SENIORITY GRADE — "Principal Cost Management", "Principal Geotechnical
// Engineer", "Principal Policy Officer" — and reading it literally does two
// kinds of damage: it invents education demand where there is none (Education
// Leadership surfaced as an emerging skill AT BHP, which is how this was
// found), and it hides the skill the title actually describes, because the
// informative word is the one AFTER "Principal".
//
// The gate that prevents this used to depend on the caller passing the
// employer's industry, and exactly one caller did, so in practice it never
// ran. This check is here because that class of failure — a control that is
// silently opted out of — does not announce itself.
//
// Each case asserts both halves: no education skill, AND the skill implied by
// the rest of the title is still found. A fix that suppressed "Principal"
// titles entirely would satisfy the first half and fail the second.
const PRINCIPAL_CASES: { title: string; wants: string; forbids?: boolean }[] = [
  { title: "Principal Cost Management", wants: "Project Management" },
  { title: "Principal Geotechnical Engineer", wants: "Geotechnical" },
  { title: "Principal Mining Engineer", wants: "Mining Engineering" },
  { title: "Principal Data Scientist", wants: "Data Science & Machine Learning" },
  { title: "Principal Project Manager", wants: "Project Management" },
  { title: "Principal Policy Officer", wants: "Policy & Programs" },
  // The genuine article still has to work, or the gate has overcorrected.
  { title: "School Principal", wants: "Education Leadership", forbids: false },
  { title: "Assistant Principal", wants: "Education Leadership", forbids: false },
  { title: "Deputy Principal", wants: "Education Leadership", forbids: false },
  { title: "Principal - Secondary College", wants: "Education Leadership", forbids: false },
];
const EDUCATION_SKILLS = new Set(
  Object.entries(SKILL_CATEGORY)
    .filter(([, cat]) => cat === "Education")
    .map(([name]) => name),
);
const principalProblems: string[] = [];
for (const c of PRINCIPAL_CASES) {
  const got = skillsForText(c.title);
  if (c.forbids !== false && got.some((s) => EDUCATION_SKILLS.has(s))) {
    principalProblems.push(`${JSON.stringify(c.title)} → education skill ${JSON.stringify(got)}`);
  }
  if (!got.includes(c.wants)) {
    principalProblems.push(
      `${JSON.stringify(c.title)} lost ${JSON.stringify(c.wants)} — got ${JSON.stringify(got)}`,
    );
  }
}
if (principalProblems.length) {
  failed = true;
  console.error("✗ 'Principal' is being read as a school principal outside education:");
  for (const p of principalProblems) console.error(`    ${p}`);
  console.error("  See GATED_TERMS in src/employsi/data/skillsTaxonomy.ts.");
} else {
  console.log(`✓ ${PRINCIPAL_CASES.length} 'Principal' titles map by what follows the word.`);
}

// 4. No skill name stranded in the archive.
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

// 5. No archived "Principal ..." row carrying a stale education skill.
//
// A SEPARATE block from check 4 on purpose. Both need D1, but check 4 reads
// every skills cell in the table and that response is large enough to drop the
// connection; when it does, anything sharing its try{} is skipped in silence.
// A control that stops running whenever an unrelated query is having a bad day
// is exactly the failure mode this check exists to catch, so it gets its own.
if (ACCOUNT && DB && TOKEN) {
  try {
    // The row-level half of check 3. The corpus above proves the TAXONOMY is
    // right today; this proves the ARCHIVE is, which is a different question —
    // rows are written with the skills frozen in at scrape time, so a title
    // mapped wrongly last month still carries the wrong skill after the
    // taxonomy is fixed, and a feed that stops passing titles correctly starts
    // writing new bad rows tomorrow. Either way a company's card shows
    // education demand it does not have.
    // Its own query: pulling title and company for EVERY row makes the
    // response large enough that D1 drops the connection, and this pass only
    // cares about a few hundred of them.
    const pRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sql:
            "SELECT title, company, skills FROM jobs " +
            // '%Principal%', not 'Principal%'. The word is not always first —
            // BHP advertises "HSS Principal Integration", which an anchored
            // filter walks straight past.
            "WHERE skills IS NOT NULL AND title LIKE '%Principal%'",
        }),
      },
    );
    const pJson = (await pRes.json()) as {
      success?: boolean;
      result?: { results?: { title?: string; company?: string; skills?: string }[] }[];
    };
    if (!pJson.success) throw new Error("D1 principal query failed");
    const stale: { title: string; company: string; skills: string[] }[] = [];
    for (const row of pJson.result?.[0]?.results ?? []) {
      const title = row.title ?? "";
      if (!/\bprincipal\b/i.test(title)) continue;
      let arr: unknown;
      try {
        arr = JSON.parse(row.skills ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      const stored = arr.map(String).filter((s) => EDUCATION_SKILLS.has(s));
      if (!stored.length) continue;
      // Only a disagreement with the CURRENT matcher is a fault. A genuine
      // "Principal - Secondary College" row keeps its education skill and is
      // not flagged.
      const now = skillsForText(title);
      if (stored.some((s) => !now.includes(s))) {
        stale.push({ title, company: row.company ?? "", skills: stored });
      }
    }
    if (stale.length) {
      failed = true;
      console.error(
        `✗ ${stale.length} archived "Principal ..." rows carry an education skill the ` +
          "current taxonomy does not give them:",
      );
      for (const s of stale.slice(0, 20)) {
        console.error(`    ${s.company} — ${s.title} ${JSON.stringify(s.skills)}`);
      }
      if (stale.length > 20) console.error(`    … and ${stale.length - 20} more`);
      console.error("  Fix: re-map those rows' skills (scripts/remap-skills.py).");
    } else {
      console.log("✓ No archived 'Principal' row carries a stale education skill.");
    }
  } catch (e) {
    console.log(`· Principal archive check skipped: ${(e as Error).message}`);
  }
} else {
  console.log("· Principal archive check skipped (no D1 credentials in the environment).");
}

if (failed) {
  console.error(
    "\nFix: add new match terms to the EXISTING def for that skill, " +
      "do not add a second def with the same name (and keep its category consistent).",
  );
  process.exit(1);
}
console.log("\nSkills taxonomy OK.");
