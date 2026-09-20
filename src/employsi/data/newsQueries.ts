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

  // ── HOMOGRAPH COLLISIONS, found by reading 256 stored articles on 2026-09-20
  //
  // A different failure from Georgiou's. Georgiou returned the WRONG PEOPLE for
  // a surname; these four return the wrong ENTITY ENTIRELY, and the token is a
  // perfect match every time — so no matcher over the headline can catch them.
  // A whole-token gate on the stored feed was measured and rejected for exactly
  // that reason: it dropped 18 of 256 articles, nearly all of them legitimate
  // (headlines say "La Trobe" and "Manildra" where the roster says "La Trobe
  // University" and "Manildra Group"), and caught none of these. The fix has to
  // be the query, because by the time an article is fetched it is too late.
  //
  // Each was verified against the live provider before being written down, two
  // passes six seconds apart because one Bing probe proves nothing.

  // `"AKD"` returned Sri Lankan politics: 7 of 8 stored articles were about
  // President Anura Kumara Dissanayake — the Budget, the Jaffna visit, the
  // electorate count — from Colombo Telegraph, Daily Mirror, FT and Island.
  // `"AKD Softwoods"` QUOTED returns NOTHING AT ALL, which is the BHP trap in
  // reverse; unquoted it returns 9, every one the timber company, and it keeps
  // the Yarram sawmill closure that was the single real article before.
  AKD: "AKD Softwoods",

  // `"CCI"` returned the Competition Commission of India closing its Google
  // antitrust case, 6 of 7 stored articles. The roster's CCI is Catholic Church
  // Insurance of Melbourne (ccinsurance.org.au, per privateLogos).
  //
  // `"CCI" insurance Australia` is NOT the fix and was tried: it returns
  // consumer credit insurance — the PRODUCT the initials also stand for, ASIC
  // crackdowns and cold-call bans. The full trading name is the only thing that
  // separates three different CCIs. It returns 2 items where the broken query
  // returned 7, and that is the right trade: the company is winding up, so thin
  // coverage is the true state of it.
  CCI: '"Catholic Church Insurance"',

  // `"Redox"` returned redox chemistry from Nature and Frontiers, plus Redox
  // OS, a Linux distribution, from ZDNet — alongside the real ASX chemicals
  // distributor.
  //
  // "chemicals" ALONE MAKES IT WORSE, which is the counter-intuitive part and
  // the reason this is written down: `Redox chemicals` pulls "Focus on Redox
  // Chemical Biology" and "Chemical Kinetics and Redox Reaction Dynamics"
  // straight back in, because the chemistry sense is *more* chemical than the
  // company is. "Australia" is what excludes them — 4 items, all the
  // distributor, including the IPO and buyout coverage.
  Redox: "Redox chemicals Australia",

  // `"Built"` is the worst of the four and is only PARTLY fixed. The plain
  // query returned built-in ovens (Which), Built protein bars (USA Today),
  // built-in storage (Forbes) and two unrelated American firms, Built
  // Technologies and Built Robotics.
  //
  // `"Built" construction Australia` returns 4: the Wesfarmers modular-housing
  // JV and the $100m digital investment are the right company, while "Chinese-
  // made modular homes built in 20 days" and "Building the workforce for
  // Australia's construction boom" merely contain the word. Two right and two
  // generic beats none right and five wrong, but the residue is real: "built"
  // is too ordinary an English word for any query to isolate, and finishing
  // this one needs a per-company title guard rather than a better search.
  Built: '"Built" construction Australia',
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
