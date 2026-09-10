#!/usr/bin/env npx tsx
/**
 * Add speciality skills to archived rows, without touching the broad skills
 * already stored on them.
 *
 * WHY THIS IS ADDITIVE AND NOT A RE-MAP.
 * The obvious backfill — re-run skillsForText over every title and write the
 * result — would be wrong, and much bigger than it looks. These rows were
 * written across years of taxonomy changes: the "Principal" gate was added
 * after most of them, terms have been retuned, skills renamed. Re-deriving
 * would silently restate every row's BROAD skills as today's matcher sees
 * them, mixing a correction nobody asked for into a change that was. It would
 * also be unreviewable, because the diff would be enormous and mostly
 * incidental.
 *
 * So this reads each row's stored array, keeps every string in it exactly as
 * written — including names no longer in the taxonomy, which SKILL_ALIAS and
 * parseStoredSkills exist to handle on read — and appends only the children
 * whose parent that row ALREADY claims. childSkillsForTitle in the taxonomy is
 * the same code path the live pipeline's pass two uses, so a backfilled row
 * and a freshly written one map identically.
 *
 * IDEMPOTENT. A row that already carries its children is not rewritten, so the
 * script can be re-run after adding a new speciality and will only touch what
 * that speciality changes.
 *
 * Usage:
 *   npx tsx scripts/backfill-skill-children.ts            # dry run, writes nothing
 *   npx tsx scripts/backfill-skill-children.ts --apply    # perform the writes
 *   npx tsx scripts/backfill-skill-children.ts --apply --limit 500
 *
 * Needs CLOUDFLARE_ACCOUNT_ID, JOBS_ARCHIVE_DB_ID and CLOUDFLARE_API_TOKEN.
 * Run under tsx/node rather than bun: bun's fetch cannot reach the D1 API
 * through this repo's proxy setup, node's can.
 */
import { writeFileSync } from "node:fs";

import {
  SKILL_ALIAS,
  SKILL_CHILDREN,
  SKILL_PARENT,
  childSkillsForTitle,
} from "../src/employsi/data/skillsTaxonomy";

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

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
      // The archive is reached over a proxy and a single reset should not
      // abandon a half-finished backfill. Four tries, backing off.
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

const PARENTS = Object.keys(SKILL_CHILDREN);
if (!PARENTS.length) {
  console.log("No specialities defined — nothing to backfill.");
  process.exit(0);
}

/** Rows can only gain a child if they already carry one of the parents, so the
 *  scan is scoped to those rather than to the whole table. */
const PARENT_FILTER = PARENTS.map((p) => `skills LIKE '%"${p.replace(/'/g, "''")}"%'`).join(" OR ");

interface Row {
  rowid: number;
  title: string | null;
  skills: string | null;
}

type Plan = { rowid: number; before: string[]; after: string[]; added: string[] };

async function buildPlan(): Promise<{ plan: Plan[]; scanned: number }> {
  const plan: Plan[] = [];
  let scanned = 0;
  let after = 0;
  for (;;) {
    const rows = await d1<Row>(
      `SELECT rowid, title, skills FROM jobs
        WHERE (${PARENT_FILTER}) AND rowid > ${after}
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
        continue; // unparseable JSON is left exactly as found
      }
      if (!Array.isArray(stored)) continue;
      const before = stored.map(String);
      // The parents this row claims, read through SKILL_ALIAS so a row written
      // under an old name still matches — the alias is what every reader
      // applies, so the backfill must agree with them about what a row says.
      const parents = new Set(before.map((s) => SKILL_ALIAS[s] ?? s));
      const added = childSkillsForTitle(r.title ?? "", parents).filter(
        (c) => !before.includes(c) && !parents.has(c),
      );
      if (!added.length) continue;
      // Appended, never reordered: the existing entries keep their positions so
      // a diff of any row shows only what this script added.
      plan.push({ rowid: r.rowid, before, after: [...before, ...added], added });
      if (plan.length >= LIMIT) return { plan, scanned };
    }
    if (rows.length < 2000) break;
  }
  return { plan, scanned };
}

const { plan, scanned } = await buildPlan();

const byChild = new Map<string, number>();
for (const p of plan) for (const c of p.added) byChild.set(c, (byChild.get(c) ?? 0) + 1);

console.log(`Scanned ${scanned} rows carrying ${PARENTS.join(" / ")}.`);
console.log(`${plan.length} rows would gain a speciality.\n`);
for (const [parent, kids] of Object.entries(SKILL_CHILDREN)) {
  console.log(`  ${parent}`);
  for (const c of kids.slice().sort((a, b) => (byChild.get(b) ?? 0) - (byChild.get(a) ?? 0))) {
    console.log(`     ${c.padEnd(31)} ${String(byChild.get(c) ?? 0).padStart(6)} rows`);
  }
}
console.log("\nSample:");
for (const p of plan.slice(0, 5)) {
  console.log(`  rowid ${p.rowid}: [${p.before.join(", ")}]`);
  console.log(`             + ${p.added.join(", ")}`);
}

// Nothing below here reads a row again, so a parent skill cannot be lost: the
// UPDATE writes `after`, which is `before` verbatim plus the additions.
const lostParent = plan.filter((p) => !p.before.every((s) => p.after.includes(s)));
if (lostParent.length) {
  console.error(`\n✗ ${lostParent.length} rows would lose an existing skill. Refusing.`);
  process.exit(1);
}
const addedNonChild = plan.filter((p) => p.added.some((c) => !(c in SKILL_PARENT)));
if (addedNonChild.length) {
  console.error(`\n✗ ${addedNonChild.length} rows would gain a non-speciality. Refusing.`);
  process.exit(1);
}
console.log(`\n✓ Every planned row keeps all ${plan.length ? "its" : ""} existing skills.`);
console.log("✓ Everything added is a speciality.");

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply to perform the backfill.");
  process.exit(0);
}
if (!plan.length) {
  console.log("\nNothing to do.");
  process.exit(0);
}

// THE UNDO, written before the first UPDATE. D1 has no transaction spanning
// these requests and no way back from a bad write, so the prior value of every
// row about to change is put on disk first — and the run aborts if it cannot
// be. Restore is one UPDATE per line of this file.
const backupPath = `skills-backfill-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
writeFileSync(
  backupPath,
  plan.map((p) => JSON.stringify({ rowid: p.rowid, skills: JSON.stringify(p.before) })).join("\n") +
    "\n",
);
console.log(`\nPrior values of all ${plan.length} rows saved to ${backupPath}`);
console.log("  restore with: UPDATE jobs SET skills = <skills> WHERE rowid = <rowid>");

// One statement per row, batched into multi-statement requests. The skills
// column is written as a bound parameter rather than interpolated, so a title
// or skill name containing a quote cannot alter the statement.
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
console.log(`\n\nBackfilled ${written} rows.`);
