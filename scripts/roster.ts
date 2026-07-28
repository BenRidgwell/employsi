// Offline roster dump — the single source of truth for "which companies do the
// scrapers walk", read from the TypeScript rather than regexed out of it.
//
// The listed roster (auJobsTargets.ts) declares its entries as object literals,
// so a regex over the source could see them. The Top-150 private roster does
// NOT: TOP_PRIVATE_TARGETS is built with `RAW.map(buildPrivate)`, so its ids and
// names exist only once the module has run. Every scraper that regexed the
// source therefore walked 205 companies and silently skipped 150 — no error, no
// warning, just a smaller roster than anyone thought.
//
// Importing the modules is the fix: it is exactly what the cron worker composes
// into AU_JOBS_TARGETS, so the scrapers and the worker cannot disagree.
//
// Writes a JSON array of {id, name, sector, group, cities} on stdout.
// Run: bun run scripts/roster.ts
import { AU_JOBS_TARGETS } from "../src/employsi/data/auJobsTargets";
import { TOP_PRIVATE_TARGETS } from "../src/employsi/data/topPrivateCompanies";

const all = [...AU_JOBS_TARGETS, ...TOP_PRIVATE_TARGETS];
const seen = new Set<string>();
const out = all.filter((t) => {
  if (!t.id || seen.has(t.id)) return false;
  seen.add(t.id);
  return true;
});
process.stdout.write(JSON.stringify(out));
