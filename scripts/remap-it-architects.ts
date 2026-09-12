#!/usr/bin/env npx tsx
/**
 * Move the archived IT architects out of Architecture & Planning and into the
 * Digital skills they belong to — in one write, so no row passes through a
 * state where it claims nothing.
 *
 * WHY THIS EXISTS RATHER THAN JUST RUNNING enforce-skill-excepts.ts. That
 * script is removal-only by contract, so it would drop Architecture & Planning
 * and set 703 of these 1101 rows to NULL, on the theory that the cron re-derives
 * a NULL row the next time it sees the ad. That theory does not hold here:
 *
 *   - the upsert is `skills = COALESCE(skills, ?)`, which only fires when the
 *     ad is seen AGAIN, and an ad taken down last month never will be. Measured
 *     2026-09-12: of the 1101 rows, 703 would go to NULL and only a fraction
 *     are still live, so the rest would stay unmapped permanently;
 *   - NULL is not a rare "please recompute" marker in this archive. 101,731 of
 *     275,158 rows are NULL and none are '[]', which means NULL is simply how
 *     "no skill matched" is stored. Nulling these rows would file a known
 *     answer under the same marker as 101k genuine non-matches, where nothing
 *     could ever tell them apart again.
 *
 * So these rows are corrected to their real value instead. Every one of them is
 * an ad whose Digital skill we now know.
 *
 * THE RULE, and it is deliberately not a re-derive:
 *
 *     after = (stored - "Architecture & Planning") ∪ skillsForText(title)
 *
 * A union can only add, so a skill the cron derived with employer context this
 * script cannot see — the industry-gated terms, where "Principal" is a school
 * principal in education and a seniority grade everywhere else — survives
 * untouched. The single subtraction is the whole point of the exercise and is
 * asserted below: Architecture & Planning is the ONLY name this script may
 * remove, from rows whose title carries an excepted architect form and nothing
 * else.
 *
 * Idempotent: a second run finds nothing to do, because the rows no longer
 * carry Architecture & Planning. Writes an undo .jsonl before the first UPDATE.
 *
 * Usage:
 *   npx tsx scripts/remap-it-architects.ts            # dry run, writes nothing
 *   npx tsx scripts/remap-it-architects.ts --apply
 *
 * Needs CLOUDFLARE_ACCOUNT_ID, JOBS_ARCHIVE_DB_ID and CLOUDFLARE_API_TOKEN.
 * Run under tsx/node, not bun: bun's fetch cannot reach the D1 API through
 * this repo's proxy setup.
 */
import { writeFileSync } from "node:fs";

import {
  SKILLS,
  SKILL_ALIAS,
  SKILL_PARENT,
  skillsForText,
} from "../src/employsi/data/skillsTaxonomy";

const APPLY = process.argv.includes("--apply");
const TARGET = "Architecture & Planning";

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB = process.env.JOBS_ARCHIVE_DB_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT || !DB || !TOKEN) {
  console.error(
    "Set CLOUDFLARE_ACCOUNT_ID, JOBS_ARCHIVE_DB_ID and CLOUDFLARE_API_TOKEN before running.",
  );
  process.exit(2);
}
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`;

async function d1<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(params ? { sql, params } : { sql }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        errors?: { message?: string }[];
        result?: { results?: T[] }[];
      };
      if (!json.success) throw new Error(json.errors?.map((e) => e.message).join("; ") || "failed");
      return json.result?.[0]?.results ?? [];
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

// The forms come from the taxonomy itself, never a copy — the list in
// skillsTaxonomy.ts is the definition of which architects are IT architects,
// and a copy here would rot the first time one is added there.
const FORMS = SKILLS.filter((d) => d.skill === TARGET).flatMap((d) => d.except ?? []);
if (!FORMS.length) {
  console.error(`✗ ${TARGET} declares no except. Nothing to remap — is the taxonomy fix present?`);
  process.exit(1);
}
// Refuse to strand: every form must lead somewhere, which is the same
// invariant check-skills.ts asserts in CI.
const stranded = FORMS.filter((f) => skillsForText(f).length === 0);
if (stranded.length) {
  console.error(`✗ These forms map to no skill at all: ${stranded.join(", ")}. Refusing to run.`);
  process.exit(1);
}

const q = (s: string) => s.replace(/'/g, "''");
// Normalise the title the way the matcher does before comparing — "&" becomes
// " and " there, so a LIKE against the raw column would miss those titles.
const NORM_TITLE = `lower(replace(title,'&',' and '))`;
const ROW_FILTER = `skills LIKE '%"${q(TARGET)}"%' AND (${FORMS.map(
  (f) => `${NORM_TITLE} LIKE '%${q(f)}%'`,
).join(" OR ")})`;

const norm = (s: string) =>
  " " + (s || "").toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ") + " ";

interface Row {
  rowid: number;
  title: string | null;
  skills: string | null;
}
type Plan = { rowid: number; title: string; before: string[]; after: string[]; gained: string[] };

const plan: Plan[] = [];
let scanned = 0;
let after = 0;
for (;;) {
  const rows = await d1<Row>(
    `SELECT rowid, title, skills FROM jobs
      WHERE skills IS NOT NULL AND title IS NOT NULL AND (${ROW_FILTER}) AND rowid > ${after}
      ORDER BY rowid LIMIT 2000`,
  );
  if (!rows.length) break;
  after = rows[rows.length - 1].rowid;
  for (const r of rows) {
    scanned++;
    let stored: unknown;
    try {
      stored = JSON.parse(r.skills ?? "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(stored)) continue;
    const before = stored.map(String);
    const title = r.title ?? "";
    const hay = norm(title);
    // Belt and braces over the SQL LIKE: the row must really carry a form.
    if (!FORMS.some((f) => hay.includes(f))) continue;

    const kept = before.filter((n) => (SKILL_ALIAS[n] ?? n) !== TARGET);
    const derived = skillsForText(title);
    const out = [...kept];
    for (const s of derived) if (!out.some((n) => (SKILL_ALIAS[n] ?? n) === s)) out.push(s);
    // A speciality must never outlive its parent — the subtraction could have
    // taken one's parent away. (Architecture & Planning has no children today;
    // this does not assume it never will.)
    for (;;) {
      const have = new Set(out.map((n) => SKILL_ALIAS[n] ?? n));
      const orphan = out.findIndex((n) => {
        const parent = SKILL_PARENT[SKILL_ALIAS[n] ?? n];
        return parent !== undefined && !have.has(parent);
      });
      if (orphan < 0) break;
      out.splice(orphan, 1);
    }
    const gained = out.filter((s) => !before.includes(s));
    if (!gained.length && out.length === before.length) continue;
    plan.push({ rowid: r.rowid, title, before, after: out, gained });
  }
  if (rows.length < 2000) break;
}

const gainCount = new Map<string, number>();
for (const p of plan) for (const g of p.gained) gainCount.set(g, (gainCount.get(g) ?? 0) + 1);
const emptied = plan.filter((p) => !p.after.length);

console.log(`Forms (from the taxonomy's own except): ${FORMS.length}`);
console.log(`Scanned ${scanned} rows carrying ${TARGET} with an IT-architect title.`);
console.log(`${plan.length} rows to correct.\n`);
console.log(`   ${TARGET} removed from ${plan.length} rows, and in its place:\n`);
for (const [s, n] of [...gainCount].sort((a, b) => b[1] - a[1]))
  console.log(`   ${s.padEnd(34)} gained by ${String(n).padStart(5)} rows`);
if (emptied.length) console.log(`\n   ⚠ ${emptied.length} rows would end up with NO skill at all.`);
else console.log(`\n   ✓ no row is left without a skill.`);
console.log("\nSample:");
for (const p of plan.slice(0, 6))
  console.log(
    `  ${p.title.slice(0, 44).padEnd(46)} [${p.before.join(", ")}]\n${" ".repeat(48)}-> [${p.after.join(", ")}]`,
  );

// ── guards ────────────────────────────────────────────────────────────────
// Architecture & Planning is the only name that may leave. Anything else
// disappearing means the union rule was not applied and history is being lost.
const lost = plan.filter((p) =>
  p.before.some((s) => (SKILL_ALIAS[s] ?? s) !== TARGET && !p.after.includes(s)),
);
if (lost.length) {
  console.error(`\n✗ ${lost.length} rows would lose a skill other than ${TARGET}. Refusing.`);
  for (const p of lost.slice(0, 5))
    console.error(`   ${p.title}: [${p.before.join(", ")}] -> [${p.after.join(", ")}]`);
  process.exit(1);
}
const kept = plan.filter((p) => p.after.some((s) => (SKILL_ALIAS[s] ?? s) === TARGET));
if (kept.length) {
  console.error(`\n✗ ${kept.length} rows would keep ${TARGET}. Refusing.`);
  process.exit(1);
}
if (emptied.length) {
  console.error(
    `\n✗ ${emptied.length} rows would be left with no skill, which is the outcome this\n` +
      `   script exists to avoid. Give those titles a home in the taxonomy first.`,
  );
  for (const p of emptied.slice(0, 10)) console.error(`   ${p.title}`);
  process.exit(1);
}
console.log(`\n✓ ${TARGET} is the only name removed; every row keeps everything else and`);
console.log(`  ends with at least one skill.`);

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply.");
  process.exit(0);
}
if (!plan.length) {
  console.log("\nNothing to do.");
  process.exit(0);
}

const backupPath = `it-architect-remap-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
writeFileSync(
  backupPath,
  plan.map((p) => JSON.stringify({ rowid: p.rowid, skills: JSON.stringify(p.before) })).join("\n") +
    "\n",
);
console.log(`\nPrior values of all ${plan.length} rows saved to ${backupPath}`);

const BATCH = 50;
let written = 0;
for (let i = 0; i < plan.length; i += BATCH) {
  const chunk = plan.slice(i, i + BATCH);
  await Promise.all(
    chunk.map((p) =>
      d1("UPDATE jobs SET skills = ?1 WHERE rowid = ?2", [JSON.stringify(p.after), p.rowid]),
    ),
  );
  written += chunk.length;
  process.stdout.write(`\r  written ${written}/${plan.length}`);
}
console.log(`\n\nCorrected ${written} rows.`);
