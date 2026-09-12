#!/usr/bin/env npx tsx
/**
 * Take a skill off archived rows whose title its own `except` disowns.
 *
 * The archive freezes each listing's skills when the row is written, so a
 * negative rule added later governs new rows only — every row written before it
 * keeps the mapping the rule exists to prevent, and keeps it forever, because
 * the cron's upsert is `skills = COALESCE(skills, ?)` and never revisits a row
 * that already has some. An except is therefore only half a fix until the
 * archive is brought into line with it.
 *
 * THE ONLY THING THIS REMOVES is a stored name whose def carries an `except`
 * that the row's title matches. It never adds, never reorders, and never
 * touches a name whose def has no except — so it cannot quietly re-map the
 * archive to today's matcher the way a full re-derive would. The complement of
 * scripts/backfill-skill-children.ts, which only ever adds.
 *
 * WHEN A ROW LOSES ITS LAST SKILL it is set to NULL rather than to an empty
 * array. Empty says "we looked and there is nothing", which is a claim, and
 * it would also freeze the row: COALESCE only refills a NULL, so an empty
 * array can never be re-derived. NULL says "unknown", and the next time the
 * cron sees that ad it maps it properly. Measured when this was written: 53 of
 * the 428 counsellor rows held Commercial & Legal and nothing else.
 *
 * Usage:
 *   npx tsx scripts/enforce-skill-excepts.ts            # dry run, writes nothing
 *   npx tsx scripts/enforce-skill-excepts.ts --apply
 *
 * Needs CLOUDFLARE_ACCOUNT_ID, JOBS_ARCHIVE_DB_ID and CLOUDFLARE_API_TOKEN.
 * Run under tsx/node, not bun: bun's fetch cannot reach the D1 API through
 * this repo's proxy setup.
 */
import { writeFileSync } from "node:fs";

import { SKILLS, SKILL_ALIAS, SKILL_PARENT } from "../src/employsi/data/skillsTaxonomy";

const APPLY = process.argv.includes("--apply");

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

/** skill -> the phrases that disown it, merged across duplicate defs the way
 *  the taxonomy's own export merges them. */
const EXCEPTS = new Map<string, string[]>();
for (const d of SKILLS) {
  if (!d.except?.length) continue;
  const got = EXCEPTS.get(d.skill) ?? [];
  for (const p of d.except) if (!got.includes(p)) got.push(p);
  EXCEPTS.set(d.skill, got);
}
if (!EXCEPTS.size) {
  console.log("No except rules in the taxonomy — nothing to enforce.");
  process.exit(0);
}

// Scan only rows that could possibly be wrong, which is two shapes and no
// others: the title contains an except phrase, or the row carries a speciality
// without the parent it narrows. Exact on both counts, and it turns a
// full-table walk into a handful of pages.
const PHRASES = [...new Set([...EXCEPTS.values()].flat())];
const q = (s: string) => s.replace(/'/g, "''");
const FILTER_CLAUSES = [
  ...PHRASES.map((p) => `lower(title) LIKE '%${q(p)}%'`),
  // Orphans are found in their own right, not only as a side effect of an
  // except firing on the same row. The first run of this script left eight:
  // it dropped Finance & Accounting from clinical-audit titles and the Audit
  // speciality stayed behind, and on the next run those rows no longer had an
  // excepted skill to trigger the scan at all.
  ...Object.entries(SKILL_PARENT).map(
    ([child, parent]) => `(skills LIKE '%"${q(child)}"%' AND skills NOT LIKE '%"${q(parent)}"%')`,
  ),
];

// D1 REFUSES A FILTER THIS WIDE IN ONE QUERY. SQLite caps an expression tree at
// depth 100, and a chain of ORs nests one level per term, so the scan started
// failing outright ("Expression tree is too large") the moment the taxonomy
// passed 66 specialities — the clause count is excepts plus one per child and
// it only ever grows. Running the same filter in bounded chunks and merging by
// rowid gives identical results; a row matching two chunks is simply planned
// once. 40 keeps a wide margin under the cap for the rest of the WHERE.
const CHUNK = 40;
const FILTER_CHUNKS: string[] = [];
for (let i = 0; i < FILTER_CLAUSES.length; i += CHUNK)
  FILTER_CHUNKS.push(FILTER_CLAUSES.slice(i, i + CHUNK).join(" OR "));

// The taxonomy normalises "&" to " and " before matching, and an except is a
// plain substring test against that same normalised title. Both halves have to
// agree or this would remove a skill the app still assigns.
const norm = (s: string) =>
  " " + (s || "").toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ") + " ";

interface Row {
  rowid: number;
  title: string | null;
  skills: string | null;
}
type Plan = { rowid: number; title: string; before: string[]; after: string[]; dropped: string[] };

// Keyed by rowid, because the chunked scan can return the same row from more
// than one chunk and it must be planned exactly once.
const planned = new Map<number, Plan>();
const seenRows = new Set<number>();
for (const ROW_FILTER of FILTER_CHUNKS) {
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
      if (seenRows.has(r.rowid)) continue;
      seenRows.add(r.rowid);
      let stored: unknown;
      try {
        stored = JSON.parse(r.skills ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(stored)) continue;
      const before = stored.map(String);
      const hay = norm(r.title ?? "");
      const dropped: string[] = [];
      const kept = before.filter((name) => {
        // Through SKILL_ALIAS, because a row written under an old name is still
        // that skill and is still governed by its except.
        const ex = EXCEPTS.get(SKILL_ALIAS[name] ?? name);
        if (ex?.some((p) => hay.includes(p))) {
          dropped.push(name);
          return false;
        }
        return true;
      });
      // CASCADE. A speciality is a subset of its parent and must never outlive
      // it: dropping "Finance & Accounting" from a clinical-audit title while
      // leaving "Audit" behind would leave the row claiming a narrowing of a
      // skill it no longer has. Caught by the integrity check after the first
      // run of this script, which found exactly 8 such rows.
      //
      // Iterated, because a grandchild would have to go too — the taxonomy is one
      // level deep today and this does not assume it stays that way.
      for (;;) {
        const have = new Set(kept.map((n) => SKILL_ALIAS[n] ?? n));
        const orphan = kept.findIndex((n) => {
          const parent = SKILL_PARENT[SKILL_ALIAS[n] ?? n];
          return parent !== undefined && !have.has(parent);
        });
        if (orphan < 0) break;
        dropped.push(kept[orphan]);
        kept.splice(orphan, 1);
      }
      if (!dropped.length) continue;
      planned.set(r.rowid, { rowid: r.rowid, title: r.title ?? "", before, after: kept, dropped });
    }
    if (rows.length < 2000) break;
  }
}
const plan = [...planned.values()].sort((a, b) => a.rowid - b.rowid);
const scanned = seenRows.size;

const bySkill = new Map<string, number>();
for (const p of plan) for (const d of p.dropped) bySkill.set(d, (bySkill.get(d) ?? 0) + 1);
const emptied = plan.filter((p) => !p.after.length);

console.log(`Rules: ${[...EXCEPTS].map(([s, e]) => `${s} (${e.length})`).join(", ")}`);
console.log(
  `Scanned ${scanned} rows: title matches an except phrase, or a speciality has no parent.`,
);
console.log(`${plan.length} rows need correcting.\n`);
for (const [s, n] of [...bySkill].sort((a, b) => b[1] - a[1]))
  console.log(`   ${s.padEnd(32)} dropped from ${String(n).padStart(5)} rows`);
console.log(
  `\n   ${"of which left with no skill".padEnd(32)} ${String(emptied.length).padStart(5)} rows -> NULL, for the cron to re-derive`,
);
console.log("\nSample:");
for (const p of plan.slice(0, 5))
  console.log(
    `  ${p.title.slice(0, 46).padEnd(48)} [${p.before.join(", ")}]\n${" ".repeat(50)}-> [${p.after.join(", ")}]`,
  );

// Guards. Nothing may be added, and only an excepted name may go.
const added = plan.filter((p) => p.after.some((s) => !p.before.includes(s)));
if (added.length) {
  console.error(`\n✗ ${added.length} rows would GAIN a skill. Refusing.`);
  process.exit(1);
}
const wrong = plan.filter((p) =>
  p.dropped.some((s) => {
    const name = SKILL_ALIAS[s] ?? s;
    // Either the skill's own except disowns the title, or it is a speciality
    // whose parent is going with it.
    return !EXCEPTS.has(name) && !(name in SKILL_PARENT);
  }),
);
if (wrong.length) {
  console.error(
    `\n✗ ${wrong.length} rows would lose a skill with no except and no dropped parent. Refusing.`,
  );
  process.exit(1);
}
const stillOrphaned = plan.filter((p) => {
  const have = new Set(p.after.map((n) => SKILL_ALIAS[n] ?? n));
  return p.after.some((n) => {
    const parent = SKILL_PARENT[SKILL_ALIAS[n] ?? n];
    return parent !== undefined && !have.has(parent);
  });
});
if (stillOrphaned.length) {
  console.error(
    `\n✗ ${stillOrphaned.length} rows would keep a speciality without its parent. Refusing.`,
  );
  process.exit(1);
}
console.log("\n✓ Nothing is added; every removal is a skill its own except disowns, or a");
console.log("  speciality whose parent went with it. No row keeps an orphaned speciality.");

if (!APPLY) {
  console.log("\nDry run — nothing written. Re-run with --apply.");
  process.exit(0);
}
if (!plan.length) {
  console.log("\nNothing to do.");
  process.exit(0);
}

const backupPath = `skills-except-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
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
      d1("UPDATE jobs SET skills = ?1 WHERE rowid = ?2", [
        p.after.length ? JSON.stringify(p.after) : null,
        p.rowid,
      ]),
    ),
  );
  written += chunk.length;
  process.stdout.write(`\r  written ${written}/${plan.length}`);
}
console.log(`\n\nCorrected ${written} rows.`);
