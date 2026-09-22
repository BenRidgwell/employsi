/**
 * Recompute `hub` for archive rows that hold NULL, and emit the SQL to set it.
 *
 * WHY THIS EXISTS. archiveJobs' upsert never rewrites `hub`: ON CONFLICT(job_key)
 * bumps last_seen and seen_count and backfills only empty columns. So a row that
 * archived before its city had a HUB_MATCH needle keeps hub NULL for as long as
 * the ad keeps being re-seen, however many times the needle matches it later.
 * Adding a needle therefore fixes NEW rows only; the ones already in the table
 * need this. Measured 2026-09-22, the Kuala Lumpur and Manila needles added that
 * day left 2,037 such rows behind, 896 of them currently advertised.
 *
 * WHAT IT WILL AND WILL NOT DO
 *   - It only ever fills a NULL. Every statement carries `AND hub IS NULL`, so a
 *     row that gained a hub between the read and the write is left alone and a
 *     second run is a no-op rather than a second opinion.
 *   - It resolves through the real hubFor, not a SQL LIKE, so needle PRECEDENCE
 *     is honoured. "Mumbai, India, ... Kuala Lumpur, Malaysia" resolves to mumbai
 *     because the India block sits above the SE Asian one, which is the answer
 *     the scraper would give today.
 *   - It passes home = null and a homeCountry that cannot match, so the home-hub
 *     fallback at the end of hubFor is dead here. Only a global HUB_MATCH needle
 *     can place a row. Site hints are per-SiteDef and are NOT applied: this
 *     cannot reproduce a hint-driven placement, so it declines to guess one.
 *   - Every hub it writes must be named in --hubs. Anything else it resolves is
 *     counted and reported but never written, which keeps a run scoped to the
 *     needles it was written for instead of quietly re-placing the whole table.
 *
 * RUN LOG — 2026-09-22, the Kuala Lumpur + Manila needles.
 *   Read 2,037 candidate rows (hub NULL, location matching one of the new
 *   needles). 2,036 resolved into --hubs; one resolved to `mumbai` and was
 *   therefore NOT written — "Mumbai, India, ... Kuala Lumpur, Malaysia", where
 *   the India block legitimately wins on precedence. Nothing resolved to no hub.
 *
 *   Predicted, then verified against the table rather than against wrangler's
 *   own `changes` meta, which reported 2,037 cumulatively and does not agree
 *   with the per-hub deltas:
 *
 *     hub NULL      82,960 -> 80,924   (-2,036)
 *     manila         3,207 ->  3,530   (  +323)
 *     kualalumpur    1,480 ->  3,193   (+1,713)
 *
 *   After it, Kuala Lumpur carries 1,398 currently-advertised roles and Manila
 *   1,391, where the career-portal half of both was previously on no pin.
 *   Largest source in the set was jobstreet (936), then wayback (277) and the
 *   Oracle, eFinancial and SmartRecruiters portals.
 *
 * Usage:
 *   bun run scripts/backfill-hub.ts --in rows.json --hubs kualalumpur,manila \
 *     [--out backfill.sql] [--chunk 150]
 *
 * `rows.json` is the output of `wrangler d1 execute --json` for a query
 * selecting job_key and location from rows with hub IS NULL.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { hubFor } from "../workers/jobs-cron/careerSites";

const arg = (n: string, d = "") => {
  const i = process.argv.indexOf("--" + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const inFile = arg("in");
const outFile = arg("out", "backfill.sql");
const chunk = Number(arg("chunk", "150"));
const allow = new Set(
  arg("hubs")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
if (!inFile || !allow.size) {
  console.error("need --in <rows.json> and --hubs <a,b>");
  process.exit(2);
}

// A homeCountry that can never match, so hubFor's home-hub fallback is dead and
// only a HUB_MATCH needle can place a row.
const NEVER = /(?!)/;

const raw = readFileSync(inFile, "utf8");
const rows: { job_key: string; location: string }[] = JSON.parse(raw.slice(raw.indexOf("[")))[0]
  .results;

const byHub = new Map<string, string[]>();
const skipped = new Map<string, number>();
let unresolved = 0;

for (const r of rows) {
  const hub = hubFor(r.location ?? "", null, NEVER, undefined, false);
  if (!hub) {
    unresolved++;
    continue;
  }
  if (!allow.has(hub)) {
    skipped.set(hub, (skipped.get(hub) ?? 0) + 1);
    continue;
  }
  const list = byHub.get(hub) ?? [];
  list.push(r.job_key);
  byHub.set(hub, list);
}

const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
const sql: string[] = [];
for (const [hub, keys] of [...byHub].sort()) {
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    // AND hub IS NULL: fill a gap, never overwrite a placement.
    sql.push(
      `UPDATE jobs SET hub = ${q(hub)} WHERE hub IS NULL AND job_key IN (${slice.map(q).join(",")});`,
    );
  }
}
writeFileSync(outFile, sql.join("\n") + "\n");

console.log("candidate rows read      " + rows.length);
console.log("resolved to no hub       " + unresolved);
for (const [hub, n] of [...skipped].sort((a, b) => b[1] - a[1]))
  console.log("resolved but NOT in --hubs  " + hub.padEnd(14) + n);
console.log("--- will write ---");
let total = 0;
for (const [hub, keys] of [...byHub].sort()) {
  console.log("  " + hub.padEnd(14) + keys.length);
  total += keys.length;
}
console.log("total updates            " + total);
console.log("statements               " + sql.length + "  -> " + outFile);
