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
export const NEWS_QUERY_OVERRIDE: Record<string, string> = {
  // The roster carries the WA civil contractor as "Georgiou"; the company trades
  // as Georgiou Group, and the bare surname is what pulled unrelated coverage in.
  Georgiou: "Georgiou Group",
};

/** The phrase to search for a company, defaulting to its own name. */
export function newsQueryFor(name: string): string {
  const clean = name.replace(/^"|"$/g, "").trim();
  return NEWS_QUERY_OVERRIDE[clean] ?? clean;
}
