#!/usr/bin/env bun
/**
 * Portal scheduling integrity check.
 *
 * Four lists have to move together or a career portal silently stops running:
 *
 *   SITES            (careerSites.ts)  every feed, keyed by `key ?? id`
 *   PORTAL_GROUPS    (careerSites.ts)  which feeds share a tick
 *   PORTAL_TICKS     (index.ts)        cron expression -> group index
 *   crons            (wrangler.jsonc)  the cron expressions Cloudflare fires
 *
 * The failure is silent by construction. A group with no tick, or a tick with
 * no cron, does not throw and does not log — the scheduler simply never calls
 * it, so the only symptom is rows that never appear in D1. That is exactly what
 * happened to groups 14-23: roughly thirty boards were added to SITES and
 * PORTAL_GROUPS through 2026-08 without the matching PORTAL_TICKS entries or
 * crons, and not one of them had ever fetched. It was found by querying D1, not
 * by anything failing.
 *
 * So this asserts the four are consistent, and CI runs it on every change to
 * any of them. Exits non-zero on:
 *   1. a PORTAL_GROUPS key that is not a SITES key (typo, or a renamed feed),
 *   2. a SITES feed in no group (added but never scheduled),
 *   3. a group index with no cron mapped to it (the 14-23 bug),
 *   4. a PORTAL_TICKS entry pointing past the end of PORTAL_GROUPS,
 *   5. a PORTAL_TICKS cron that wrangler.jsonc does not register,
 *   6. two ticks sharing one group index, or one cron used twice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PORTAL_GROUPS, SITES } from "../workers/jobs-cron/careerSites";

const ROOT = join(import.meta.dir, "..");
let failed = false;
const fail = (msg: string) => {
  console.error(`FAIL  ${msg}`);
  failed = true;
};

// PORTAL_TICKS and the cron list are read as text rather than imported: index.ts
// is a Worker entry point whose module scope expects the Workers runtime.
const indexSrc = readFileSync(join(ROOT, "workers/jobs-cron/index.ts"), "utf8");
const ticksBlock = /const PORTAL_TICKS[^{]*\{([\s\S]*?)\n\};/.exec(indexSrc);
if (!ticksBlock) throw new Error("could not find PORTAL_TICKS in workers/jobs-cron/index.ts");
const ticks: [string, number][] = [...ticksBlock[1].matchAll(/"([^"]+)":\s*(\d+)/g)].map((m) => [
  m[1],
  Number(m[2]),
]);

const wranglerSrc = readFileSync(join(ROOT, "workers/jobs-cron/wrangler.jsonc"), "utf8");
const cronsBlock = /"crons"\s*:\s*\[([\s\S]*?)\]/.exec(wranglerSrc);
if (!cronsBlock) throw new Error("could not find crons in workers/jobs-cron/wrangler.jsonc");
const crons = new Set([...cronsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));

// 1 + 2. SITES <-> PORTAL_GROUPS.
const siteKeys = new Set(SITES.map((s) => s.key ?? s.id));
const grouped = new Set(PORTAL_GROUPS.flat());
for (const k of grouped)
  if (!siteKeys.has(k)) fail(`PORTAL_GROUPS has "${k}", which is not a SITES key`);
for (const k of siteKeys)
  if (!grouped.has(k)) fail(`SITES feed "${k}" is in no PORTAL_GROUPS group, so it never runs`);

// 3 + 4. PORTAL_GROUPS <-> PORTAL_TICKS, both directions.
const scheduled = new Map<number, string[]>();
for (const [cron, idx] of ticks) scheduled.set(idx, [...(scheduled.get(idx) ?? []), cron]);
for (let i = 0; i < PORTAL_GROUPS.length; i++) {
  if (!scheduled.has(i)) {
    fail(
      `PORTAL_GROUPS[${i}] (${PORTAL_GROUPS[i].join(", ")}) has no PORTAL_TICKS entry, so it never runs`,
    );
  }
}
for (const [idx, cs] of scheduled) {
  if (idx >= PORTAL_GROUPS.length)
    fail(`PORTAL_TICKS maps ${cs.join(", ")} to group ${idx}, past the end of PORTAL_GROUPS`);
  if (cs.length > 1) fail(`group ${idx} is scheduled by more than one cron: ${cs.join(", ")}`);
}

// 5 + 6. PORTAL_TICKS <-> wrangler crons.
const seenCron = new Set<string>();
for (const [cron] of ticks) {
  if (!crons.has(cron))
    fail(`PORTAL_TICKS has "${cron}", which wrangler.jsonc does not register as a cron`);
  if (seenCron.has(cron)) fail(`cron "${cron}" appears twice in PORTAL_TICKS`);
  seenCron.add(cron);
}

if (failed) {
  console.error("\nportal scheduling is inconsistent — see above");
  process.exit(1);
}
console.log(
  `ok  ${SITES.length} feeds, ${PORTAL_GROUPS.length} groups, ${ticks.length} ticks, all scheduled`,
);
