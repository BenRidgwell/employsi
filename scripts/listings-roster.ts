// Roster rows for scripts/check-listings.py: every company that has a ticker,
// with the city it is plotted on.
//
// SEPARATE FROM dump-tickers.ts on purpose. That one dedupes on
// `ticker|exchange` because its consumer fetches one price series per symbol,
// and it carries no city. This one needs a row per COMPANY (two companies can
// share a ticker across venues) and needs the city, because that is what lets
// the listing check guess where a ticker with no recorded exchange trades.
// Widening dump-tickers' key would silently change how many symbols
// gen-share-prices.py fetches, so the two stay apart.
//
// Writes [{id, name, ticker, exchange, city}] on stdout.
// Run: bun run scripts/listings-roster.ts
import { COMPANIES } from "../src/employsi/data/companies";
import { CITY_COMPANIES } from "../src/employsi/data/mapboxGeo";

const cityOf = new Map<string, string>();
for (const [city, list] of Object.entries(CITY_COMPANIES as Record<string, { id: string }[]>)) {
  for (const c of list) if (!cityOf.has(c.id)) cityOf.set(c.id, city);
}

const out = COMPANIES.filter((c) => (c.ticker || "").trim()).map((c) => ({
  id: c.id,
  name: c.name,
  ticker: (c.ticker || "").trim(),
  // No default. companies.ts documents ASX as the fallback for the exchange
  // FILTER, but that is a UI convenience — applying it here would resolve
  // Chevron's CVX to a real, unrelated Australian listing. Blank means blank.
  exchange: ((c as { exchange?: string }).exchange || "").trim(),
  city: cityOf.get(c.id) ?? "",
}));
process.stdout.write(JSON.stringify(out));
