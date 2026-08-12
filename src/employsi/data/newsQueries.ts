/**
 * Search phrases for companies whose roster name is too generic to search on.
 *
 * "In the news" is built from the roster name in quotes, which is right for
 * almost every employer. It fails when the name is also an ordinary word or a
 * common surname: searching `"Georgiou"` returns the Greek-Australian surname
 * across politics, sport and court reporting, not the WA civil contractor.
 *
 * ABN Group hit the same problem from the other direction and was fixed by
 * renaming the roster entry, but a rename changes the company id — and the id is
 * what the D1 archive, the logo map and the sector map are all keyed on — so it
 * is only safe before a company has any stored history. This map leaves the
 * roster name (and therefore the id, the card title and every join) alone and
 * changes ONLY the phrase sent to the news providers.
 *
 * Keyed by roster NAME, matching officialNewsFeeds.ts, because both the app's
 * liveNewsFn and the nightly cron in workers/jobs-cron/news.ts start from there.
 * The KV cache key still uses the roster name, so the app and the cron agree on
 * where a company's stored feed lives regardless of what was searched for.
 */
/**
 * AN ENTRY IS THE FINISHED QUERY, quotes included, not a phrase to be quoted.
 *
 * It used to be a bare phrase that both call sites wrapped in `"..."`, which
 * made every override a PHRASE match and left no way to express the one thing
 * BHP needed. Writing the quotes here costs one pair of characters and buys the
 * whole query language the provider supports.
 */
export const NEWS_QUERY_OVERRIDE: Record<string, string> = {
  // The roster carries the WA civil contractor as "Georgiou"; the company trades
  // as Georgiou Group, and the bare surname is what pulled unrelated coverage in.
  // Quoted, because here the exact phrase IS the point.
  Georgiou: '"Georgiou Group"',
  // BHP IS THE OPPOSITE PROBLEM: not too broad, too NARROW. Measured 2026-08-12,
  // same day, same market:
  //
  //     "BHP"          2 items      BHP mining   12 items
  //     "BHP Group"    7 items
  //
  // and KV held exactly the 2 that `"BHP"` returns, so the card was showing
  // everything the query could find — the query was the ceiling.
  //
  // Bing clusters hard on a short quoted token, and the two survivors are all
  // that is left of the day's coverage. Unquoting is what lifts it: the same
  // search unquoted returns the Port Hedland strike, the union dispute, the
  // revenue hit, Escondida and the Trump roundtable — the operational news this
  // card exists to show.
  //
  // "mining" is a narrowing term, NOT decoration: bare `BHP` unquoted still
  // returns 2, because the clustering is on the token and not on the quoting.
  // It also keeps the ticker symbol's finance-wire noise down, which is why it
  // reads better than `"BHP Group"` — that one returns 7, but mostly analyst
  // hold-ratings and ADR listings rather than anything about the company.
  BHP: "BHP mining",
};

/**
 * The finished provider query for a company, defaulting to its own name as an
 * exact phrase.
 *
 * Callers must NOT add quotes — an override that wanted them has them already,
 * and one that deliberately went without them (see BHP) would be broken by a
 * caller putting them back.
 */
export function newsQueryFor(name: string): string {
  const clean = name.replace(/^"|"$/g, "").trim();
  return NEWS_QUERY_OVERRIDE[clean] ?? `"${clean}"`;
}
