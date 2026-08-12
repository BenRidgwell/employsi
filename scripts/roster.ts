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
import { UNIVERSITY_TARGETS } from "../src/employsi/data/universityTargets";
import { CITY_ROSTERS } from "../src/employsi/data/cityRosters";
import { rosterId } from "../src/employsi/data/rosters";

// City-roster companies (the exchange-listed names plotted on each global hub).
// Included so the international scrapers can walk them too — Naukri needs the
// Mumbai and Bengaluru names, which exist only here and not in the AU rosters.
const CITY_TARGETS = Object.entries(CITY_ROSTERS).flatMap(([city, r]) =>
  r.companies.map(([ticker, name, group]) => ({
    id: rosterId(city, ticker),
    name,
    sector: group,
    group,
    cities: [city],
  })),
);

// The city rosters are OPT-IN (--with-cities). Folding them in by default would
// silently take every existing driver — Indeed, LinkedIn, JobsDB, Jora — from
// 355 companies to ~995 and change what those daily runs mean. Only the
// scrapers that actually cover those markets ask for them.
const withCities = process.argv.includes("--with-cities");
// KEEP IN STEP WITH workers/jobs-cron/index.ts, which composes the same three
// AU files for the Adzuna pull. Two independent assemblies of one roster: a
// category added there and not here is a set of companies the Worker pulls that
// no Python driver walks, and neither side errors. check-feed-coverage.py
// compares the two for exactly that reason.
const AU_ALL = [...AU_JOBS_TARGETS, ...TOP_PRIVATE_TARGETS, ...UNIVERSITY_TARGETS];
const all = withCities ? [...AU_ALL, ...CITY_TARGETS] : AU_ALL;
const seen = new Set<string>();
const out = all.filter((t) => {
  if (!t.id || seen.has(t.id)) return false;
  seen.add(t.id);
  return true;
});
process.stdout.write(JSON.stringify(out));
