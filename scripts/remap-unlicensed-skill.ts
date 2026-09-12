#!/usr/bin/env npx tsx
/**
 * Correct archived rows that carry a skill the matcher NO LONGER LICENSES.
 *
 * The archive freezes each listing's skills when the row is written and the
 * cron's upsert is `skills = COALESCE(skills, ?)`, so a matcher change governs
 * new rows only. Every row written before it keeps the old mapping, and keeps
 * it forever unless something goes back over the archive. This is that thing.
 *
 * It replaces scripts/remap-it-architects.ts, which did the same job for one
 * skill. A second rule (the French "chef de X" titles) needed byte-identical
 * logic and one different answer to one question, so the two are one script
 * with a table rather than two files drifting apart.
 *
 * THE DECISION IS THE LIVE TAXONOMY, never a copy of it. A row is corrected
 * when skillsForText(title) no longer returns the skill the row is carrying.
 * The `prefilter` below is ONLY a way to avoid walking 275k rows — it narrows
 * the scan, it never decides anything — so a rule cannot drift out of step with
 * the taxonomy the way a hand-maintained list of forms would.
 *
 * THE RULE, and it is deliberately not a re-derive:
 *
 *     after = (stored - skill) ∪ skillsForText(title)
 *
 * A union can only add, so a skill the cron derived with employer context this
 * script cannot see — the industry-gated terms, where "Principal" is a school
 * principal in education and a seniority grade everywhere else — survives
 * untouched. The single subtraction is the point of the exercise and is
 * asserted: the run refuses if any row would lose another name or keep the
 * target.
 *
 * Idempotent: a second run finds nothing, because the rows no longer carry the
 * skill. Writes an undo .jsonl before the first UPDATE.
 *
 * Usage:
 *   npx tsx scripts/remap-unlicensed-skill.ts                    # every rule, dry
 *   npx tsx scripts/remap-unlicensed-skill.ts it-architects
 *   npx tsx scripts/remap-unlicensed-skill.ts chef-de --apply
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

interface Rule {
  /**
   * What this rule does to a row.
   *
   *   "remove"  the row carries `skill` and the matcher no longer licenses it.
   *   "fill"    the row's skills are NULL and the matcher now maps the title.
   *
   * The second exists because a TERM ADDED to the taxonomy reaches new rows
   * only. The cron's upsert is `skills = COALESCE(skills, ?)`, so it refills a
   * NULL row when it sees the ad again — and an ad taken down last month never
   * will be. Teaching the taxonomy that a facilities manager works in
   * facilities does nothing for the 110 archived ones already sitting at NULL
   * unless something goes back for them.
   */
  mode: "remove" | "fill";
  /** The skill to take off rows whose title no longer licenses it ("remove"). */
  skill: string;
  /** SQL LIKE bodies against the normalised title. Narrows the scan ONLY. */
  prefilter: () => string[];
  /**
   * May a corrected row end up with no skill at all?
   *
   * This is the one question the two rules answer differently, and it is the
   * reason they are worth keeping in one place. For the IT architects the
   * answer is NO: every excepted form was given a home in Digital first, so a
   * row left with nothing means a destination is missing and the run should
   * stop. For the French managers the answer is YES: "Chef de Bureau" is an
   * office manager and this taxonomy has no French office-management skill, so
   * mapping it to nothing is correct. Suppress rather than fabricate — a row
   * with no skill says "unknown", which is true, where leaving it under
   * Hospitality said something false.
   */
  allowEmpty: boolean;
  note: string;
}

const RULES: Record<string, Rule> = {
  "it-architects": {
    mode: "remove",
    skill: "Architecture & Planning",
    // Straight from the taxonomy's own except list, so adding a form there is
    // all that is ever needed here.
    prefilter: () =>
      SKILLS.filter((d) => d.skill === "Architecture & Planning").flatMap((d) => d.except ?? []),
    allowEmpty: false,
    note: "Solution, enterprise, data and security architects design systems, not buildings.",
  },
  "chef-de": {
    mode: "remove",
    skill: "Hospitality & Food Service",
    // "chef de" catches both the culinary forms and the managerial ones; the
    // matcher then decides which is which, through the `chef` gate in
    // GATED_TERMS. Nothing about that gate is restated here.
    prefilter: () => ["chef de "],
    allowEmpty: true,
    note: '"Chef de X" is French for "head of X", and almost none of them cook.',
  },
  rehabilitation: {
    mode: "remove",
    skill: "Environmental",
    // Bare "rehabilitation" was an Environmental term until 2026-09-12. The
    // matcher now decides: a title saying "mine rehabilitation" or
    // "rehabilitation and closure" still licenses the skill, a spinal rehab
    // ward does not.
    prefilter: () => ["rehabilitation"],
    allowEmpty: true,
    note: "417 of 429 rehabilitation titles were clinical, not mine rehabilitation.",
  },
  "fill-unmapped": {
    mode: "fill",
    skill: "",
    // No prefilter: every NULL row is a candidate, because the terms added on
    // 2026-09-12 (facilities management, town planning, service desk, the
    // university research grades, sales engineer) are spread across the
    // archive and listing them here would be a copy of the taxonomy that rots.
    // The matcher decides, one row at a time.
    prefilter: () => [],
    allowEmpty: false,
    note: "Rows stored as NULL — unknown — that the taxonomy can now map.",
  },
};

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const named = args.filter((a) => !a.startsWith("--"));
const bad = named.filter((n) => !(n in RULES));
if (bad.length) {
  console.error(`Unknown rule(s): ${bad.join(", ")}. Known: ${Object.keys(RULES).join(", ")}`);
  process.exit(2);
}
const TO_RUN = named.length ? named : Object.keys(RULES);

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

const q = (s: string) => s.replace(/'/g, "''");
// The matcher rewrites "&" as " and " before it reads a title, so a LIKE
// against the raw column would miss those rows.
const NORM_TITLE = `lower(replace(title,'&',' and '))`;

interface Row {
  rowid: number;
  title: string | null;
  skills: string | null;
}
type Plan = { rowid: number; title: string; before: string[]; after: string[]; gained: string[] };

let failed = false;
let totalWritten = 0;

for (const name of TO_RUN) {
  const rule = RULES[name];
  const { skill: TARGET } = rule;
  const patterns = rule.prefilter();
  console.log(`\n${"═".repeat(72)}\n${name} — ${TARGET}\n  ${rule.note}\n${"═".repeat(72)}`);
  if (!patterns.length && rule.mode !== "fill") {
    console.error(`✗ ${name} produced no prefilter. Is the taxonomy rule present?`);
    failed = true;
    continue;
  }

  // Both shapes: a row still carrying the target, and a row already NULL. The
  // second happens when enforce-skill-excepts.ts runs first — it is
  // removal-only, so it strips the skill and leaves nothing behind. Covering
  // both here means run order stops mattering.
  const TITLE_MATCH = patterns.length
    ? `AND (${patterns.map((p) => `${NORM_TITLE} LIKE '%${q(p)}%'`).join(" OR ")})`
    : "";
  const ROW_FILTER =
    rule.mode === "fill"
      ? `skills IS NULL ${TITLE_MATCH}`
      : `(skills LIKE '%"${q(TARGET)}"%' OR skills IS NULL) ${TITLE_MATCH}`;

  const plan: Plan[] = [];
  let scanned = 0;
  let after = 0;
  for (;;) {
    const rows = await d1<Row>(
      `SELECT rowid, title, skills FROM jobs
        WHERE title IS NOT NULL AND (${ROW_FILTER}) AND rowid > ${after}
        ORDER BY rowid LIMIT 2000`,
    );
    if (!rows.length) break;
    after = rows[rows.length - 1].rowid;
    for (const r of rows) {
      scanned++;
      // A NULL row reads as [], which is the right starting point: it claims
      // nothing, so the union is simply what the title derives to.
      let stored: unknown;
      try {
        stored = JSON.parse(r.skills ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(stored)) continue;
      const before = stored.map(String);
      const title = r.title ?? "";
      const derived = skillsForText(title);
      // THE DECISION. In "remove" mode the matcher still licensing the title
      // means the row is right and is left alone — this is what keeps a
      // culinary "Chef de Partie" out of the plan without restating the gate.
      // In "fill" mode there is nothing to remove and the only question is
      // whether the taxonomy can now say anything at all.
      if (rule.mode === "fill") {
        if (!derived.length) continue;
      } else if (derived.includes(TARGET)) continue;

      const kept = before.filter((n) => (SKILL_ALIAS[n] ?? n) !== TARGET);
      const out = [...kept];
      for (const s of derived) if (!out.some((n) => (SKILL_ALIAS[n] ?? n) === s)) out.push(s);
      // A speciality must never outlive its parent — the subtraction may have
      // taken one's parent away.
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

  console.log(`Scanned ${scanned} rows; ${plan.length} to correct.\n`);
  console.log(
    rule.mode === "fill"
      ? `   ${plan.length} rows stored as NULL now map to:\n`
      : `   ${TARGET} removed from ${plan.length} rows, and in its place:\n`,
  );
  for (const [s, n] of [...gainCount].sort((a, b) => b[1] - a[1]))
    console.log(`   ${s.padEnd(34)} gained by ${String(n).padStart(5)} rows`);
  if (!gainCount.size) console.log("   (nothing — these titles map to no skill at all)");
  console.log(
    emptied.length
      ? `\n   ${emptied.length} rows end with NO skill -> NULL${rule.allowEmpty ? ", which is the intended answer for this rule" : ""}`
      : `\n   ✓ no row is left without a skill.`,
  );
  for (const p of plan.slice(0, 4))
    console.log(
      `\n  ${p.title.slice(0, 50)}\n     [${p.before.join(", ")}] -> [${p.after.join(", ") || "NULL"}]`,
    );

  // ── guards ──────────────────────────────────────────────────────────────
  const lost = plan.filter((p) =>
    p.before.some((s) => (SKILL_ALIAS[s] ?? s) !== TARGET && !p.after.includes(s)),
  );
  if (lost.length) {
    console.error(`\n✗ ${lost.length} rows would lose a skill other than ${TARGET}. Refusing.`);
    failed = true;
    continue;
  }
  if (plan.some((p) => p.after.some((s) => (SKILL_ALIAS[s] ?? s) === TARGET))) {
    console.error(`\n✗ Some rows would keep ${TARGET}. Refusing.`);
    failed = true;
    continue;
  }
  if (emptied.length && !rule.allowEmpty) {
    console.error(
      `\n✗ ${emptied.length} rows would be left with no skill, which this rule forbids.\n` +
        `   Give those titles a home in the taxonomy before running it.`,
    );
    for (const p of emptied.slice(0, 10)) console.error(`   ${p.title}`);
    failed = true;
    continue;
  }
  console.log(
    rule.mode === "fill"
      ? `\n✓ Nothing removed; every row here claimed nothing before.`
      : `\n✓ ${TARGET} is the only name removed; every row keeps everything else.`,
  );

  if (!APPLY) {
    console.log("Dry run — nothing written.");
    continue;
  }
  if (!plan.length) continue;

  const backupPath = `remap-${name}-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
  writeFileSync(
    backupPath,
    plan.map((p) => JSON.stringify({ rowid: p.rowid, skills: p.before })).join("\n") + "\n",
  );
  console.log(`Prior values of all ${plan.length} rows saved to ${backupPath}`);

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
  totalWritten += written;
  console.log(`\nCorrected ${written} rows.`);
}

if (APPLY) console.log(`\n${totalWritten} rows corrected in total.`);
process.exit(failed ? 1 : 0);
