// Emits the roster's ticker/exchange pairs as JSON on stdout, for
// scripts/gen-share-prices.py.
//
// COMPANIES is assembled at runtime from several roster files, so the only
// correct reading of "which tickers does the app have" is the one TypeScript
// itself produces. An earlier regex over companies.ts saw 50 of 1,485 and gave
// every one of them the ASX default, which would have fetched CVX.AX (a
// different, tiny listing) for Chevron.
import { COMPANIES } from "../src/employsi/data/companies";

const seen = new Set<string>();
const out: { id: string; ticker: string; exchange: string }[] = [];
for (const c of COMPANIES) {
  const ticker = (c.ticker || "").trim();
  if (!ticker) continue;
  // NO default. companies.ts documents ASX as the fallback for the exchange
  // FILTER, but that is a UI convenience and applying it here would be a
  // fabrication: 677 roster entries carry a ticker and no exchange, including
  // `chevron` (CVX) and `shell` (SHEL), and defaulting those to ASX resolves
  // CVX.AX and SHEL.AX — real, unrelated Australian listings. An unknown
  // exchange is emitted as "" and skipped by the fetcher.
  const exchange = (c.exchange || "").trim();
  const key = `${ticker}|${exchange}`;
  if (seen.has(key)) continue;
  seen.add(key);
  out.push({ id: c.id, ticker, exchange });
}
console.log(JSON.stringify(out));
