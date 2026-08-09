// Every plotted city must name a country, and every country the news pool can
// serve must be reachable from some city.
//
// The failure this guards is silent. A city added to CITY_COMPANIES without a
// CITY_COUNTRY entry does not break: its companies simply stop being offered
// their national press and quietly fall back to Bing, which looks exactly like
// a quiet news week. Nothing on screen says a country was missed.
//
// Run: bun run scripts/check-city-country.ts
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";
import { CITY_COUNTRY } from "../src/employsi/data/cityCountry";
import { NEWS_OUTLETS, OUTLETS_UNCOVERED } from "../src/employsi/data/newsOutletFeeds";

let bad = 0;

const cities = Object.keys(CITY_COMPANIES).filter((c) => (CITY_COMPANIES[c] ?? []).length > 0);
const missing = cities.filter((c) => !CITY_COUNTRY[c]);
if (missing.length) {
  bad++;
  console.error(`✗ ${missing.length} plotted cities have no country: ${missing.join(", ")}`);
} else {
  console.log(`✓ all ${cities.length} plotted cities name a country.`);
}

// A country key in the feed file that no city maps to is dead weight in the
// bundle — it can never be selected.
const used = new Set(Object.values(CITY_COUNTRY));
const orphan = Object.keys(NEWS_OUTLETS).filter((k) => k !== "business" && !used.has(k));
if (orphan.length) {
  bad++;
  console.error(`✗ feed buckets no city can reach: ${orphan.join(", ")}`);
} else {
  console.log(`✓ every feed bucket is reachable from a plotted city.`);
}

// Not a failure — a fact worth printing, so the gap stays visible rather than
// being rediscovered each time someone wonders why a Zurich company has no
// local coverage.
const noFeeds = [...used].filter((c) => !NEWS_OUTLETS[c]).sort();
const companies = Object.entries(CITY_COMPANIES)
  .filter(([c]) => noFeeds.includes(CITY_COUNTRY[c]))
  .reduce((n, [, list]) => n + list.length, 0);
console.log(
  `· ${noFeeds.length} countries have no national feeds (${noFeeds.join(", ")}) — ` +
    `${companies} companies, which use the business pool and Bing only.`,
);
console.log(`· upstream list does not cover: ${OUTLETS_UNCOVERED.join(", ")}`);

if (bad) process.exit(1);
console.log("\nCity/country map OK.");
