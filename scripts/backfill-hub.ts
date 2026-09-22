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
 * RUN LOG — 2026-09-22, the Penang + Johor Bahru hubs.
 *   Read 880 candidate rows; all 880 resolved into --hubs, none to no hub and
 *   none outside the allowlist. Verified against the table:
 *
 *     hub NULL      80,960 -> 80,080   (-880)
 *     penang             0 ->    582   (+582)
 *     johorbahru         0 ->    298   (+298)
 *
 *   Leaving Penang with 240 currently-advertised roles and Johor Bahru 137,
 *   which is exactly what the pre-registration count of each metro predicted.
 *   wrangler again reported one more change than the deltas show (881), as in
 *   the run below; read the table, not the meta.
 *
 * RUN LOG — 2026-09-22, the table-wide run, keyed on location.
 *   Run after the namesake guards landed, and only after a dry run over all
 *   12,975 unplaced locations came back with no known-wrong placement; the
 *   run before the guards would have put 17 rows on the wrong continent.
 *
 *     hub NULL      80,095 -> 49,293   (-30,802)
 *
 *   30,802 rows over 16 hubs, 51 statements: brisbane 8,201, sydney 7,985,
 *   perth 4,800, melbourne 4,464, adelaide 1,374, canberra 1,256, darwin 877,
 *   hobart 833, bengaluru 611, mumbai 292, auckland 64, wellington 30,
 *   johannesburg 9, chicago 3, beijing 2, washington 1. Nothing resolved
 *   outside --hubs. 48,055 rows resolved to no hub and were left alone, plus
 *   1,238 that carry no location at all.
 *
 *   WHAT IT DELIBERATELY DID NOT FIX. `AND hub IS NULL` means a row already
 *   holding a WRONG hub keeps it, so the namesake guards corrected the unplaced
 *   copies and not the placed ones: "Hamilton, Newcastle Area" still has one row
 *   on Brisbane, "Hobart, Indiana" two on Hobart, and four Glenelg Area rows sit
 *   on the junk hub "Australia". Repairing those is an OVERWRITE, a different
 *   operation from filling a gap, and this script will not do it.
 *
 *   Related, and larger: 3,899 rows carry hub = "Australia", which is not a hub
 *   id and matches nothing in the registries. They are as invisible as a NULL
 *   but no `hub IS NULL` query finds them, so every backfill so far has skipped
 *   them silently.
 *
 * RUN LOG — 2026-09-22, repairing the hub values that were never hub ids.
 *   openRolesFn.ts had been writing Adzuna's `where` FILTER into `hub`, so
 *   4,082 rows sat on "Australia" (3,899), "Johannesburg" (80), "Singapore"
 *   (53) and "London" (50). Invisible on the map like a NULL, but no
 *   `hub IS NULL` run reaches them, so every earlier backfill skipped them.
 *
 *     hub IN (those four)   4,082 -> 0
 *     hub NULL             49,371 -> 51,094   (+1,723)
 *
 *   2,359 rows resolved from their own location — perth 1,196, brisbane 302,
 *   adelaide 236, sydney 202, melbourne 118, johannesburg 80, canberra 53,
 *   singapore 53, darwin 49, london 43, hobart 27 — and 1,723 whose location
 *   is country-only ("Australia") were set NULL, which is what they are.
 *
 *   The source bug is fixed in the same change, but note the ordering: five
 *   more rows ("Wellington" 4, "Auckland" 1) appeared between the snapshot and
 *   the verification, written by the app Worker still running the old code. A
 *   repair before its deploy is a repair with the tap open.
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

// --from turns this from a FILL into a REPAIR, and the guard changes with it.
//
// Without it every statement carries `AND hub IS NULL`: the script fills gaps
// and can never contradict a placement. That is the right default and most runs
// want nothing else.
//
// But a column can hold a value that is wrong rather than missing. `hub` held
// 4,082 rows on "Australia", "Johannesburg", "Singapore" and "London" — Adzuna
// location FILTERS written where a hub id belongs, from a bug in
// openRolesFn.ts. No `hub IS NULL` run can reach those, and they are invisible
// on the map exactly as a NULL is.
//
// So --from names the values that may be overwritten, and the guard becomes
// `hub IN (...)` over that list alone. It is the same safety property stated
// differently: a run can only ever touch rows whose hub was named on the
// command line, so a valid placement is still unreachable. It is never a bare
// "overwrite anything", and there is no flag that makes it one.
const from = arg("from")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const raw = readFileSync(inFile, "utf8");
const rows: { job_key?: string; location: string; n?: number }[] = JSON.parse(
  raw.slice(raw.indexOf("[")),
)[0].results;

// TWO WAYS TO NAME THE ROWS TO UPDATE, and which one is available decides.
// Keying on job_key is exact but means reading every key out of D1 first, which
// for a table-wide run is ~13 MB of primary keys moved in order to write a
// column that depends on NONE of them. `hub` is a pure function of `location`,
// so a query that has already grouped by location names the same rows in a
// fraction of the payload: 12,976 locations for 80,095 rows. The mode is chosen
// by what the input carries rather than by a flag, so the two cannot disagree.
const byLocation = !rows.some((r) => r.job_key);
const weight = (r: { n?: number }) => r.n ?? 1;

const byHub = new Map<string, string[]>();
const rowsFor = new Map<string, number>();
const clearKeys: string[] = [];
let clearRows = 0;
const skipped = new Map<string, number>();
let unresolved = 0;
let total = 0;

for (const r of rows) {
  total += weight(r);
  const hub = hubFor(r.location ?? "", null, NEVER, undefined, false);
  if (!hub) {
    unresolved += weight(r);
    // In repair mode an unresolvable location is not a no-op: the row is
    // sitting on a value we know to be wrong, and NULL is the honest
    // replacement for it — "we did not determine this", which is repairable,
    // rather than a place it is not.
    if (from.length) {
      clearKeys.push(byLocation ? r.location : (r.job_key as string));
      clearRows += weight(r);
    }
    continue;
  }
  if (!allow.has(hub)) {
    skipped.set(hub, (skipped.get(hub) ?? 0) + weight(r));
    continue;
  }
  const list = byHub.get(hub) ?? [];
  list.push(byLocation ? r.location : (r.job_key as string));
  byHub.set(hub, list);
  rowsFor.set(hub, (rowsFor.get(hub) ?? 0) + weight(r));
}

const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";
// Fill mode can only touch a NULL; repair mode can only touch a value named in
// --from. Neither can reach a hub that is already right.
const guard = from.length ? `hub IN (${from.map(q).join(",")})` : "hub IS NULL";
const sql: string[] = [];
for (const [hub, keys] of [...byHub].sort()) {
  for (let i = 0; i < keys.length; i += chunk) {
    const slice = keys.slice(i, i + chunk);
    const col = byLocation ? "location" : "job_key";
    sql.push(
      `UPDATE jobs SET hub = ${q(hub)} WHERE ${guard} AND ${col} IN (${slice.map(q).join(",")});`,
    );
  }
}
const col = byLocation ? "location" : "job_key";
for (let i = 0; i < clearKeys.length; i += chunk) {
  const slice = clearKeys.slice(i, i + chunk);
  sql.push(`UPDATE jobs SET hub = NULL WHERE ${guard} AND ${col} IN (${slice.map(q).join(",")});`);
}
writeFileSync(outFile, sql.join("\n") + "\n");

console.log(
  "mode                   " + (from.length ? "REPAIR of " + from.join(", ") : "fill (hub IS NULL)"),
);
console.log("keyed on               " + (byLocation ? "location" : "job_key"));
console.log("input entries read     " + rows.length);
console.log("rows they cover        " + total);
console.log(
  "resolve to no hub      " + unresolved + (from.length ? " -> will be set NULL" : " (left alone)"),
);
for (const [hub, n] of [...skipped].sort((a, b) => b[1] - a[1]))
  console.log("resolved but NOT in --hubs  " + hub.padEnd(14) + n);
console.log("--- will write ---");
let written = 0;
for (const [hub, keys] of [...byHub].sort(
  (a, b) => (rowsFor.get(b[0]) ?? 0) - (rowsFor.get(a[0]) ?? 0),
)) {
  console.log(
    "  " +
      hub.padEnd(14) +
      String(rowsFor.get(hub) ?? 0).padStart(7) +
      " rows over " +
      keys.length +
      " " +
      (byLocation ? "locations" : "keys"),
  );
  written += rowsFor.get(hub) ?? 0;
}
console.log("total rows to write    " + written);
console.log("statements             " + sql.length + "  -> " + outFile);
