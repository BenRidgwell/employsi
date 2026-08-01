/**
 * Is an advertised job plausibly placed BY the company it is filed under?
 *
 * The token comparison at the heart of the archive's attribution checks, in
 * one place so the three things that need it cannot drift:
 *   - workers/jobs-cron/advertiser.ts, which decides what Adzuna may write
 *   - lib/dataQualityFn.ts, which audits what is already written
 *   - scripts/advertiser_match.py, the Python feeds' copy (kept in step by
 *     hand — it runs in a different language, so the shape is mirrored rather
 *     than shared, and the cases below are the contract between them)
 *
 * WHY TOKENS AND NOT SUBSTRINGS
 * A substring test matches ACROSS a word: "igo" sits inside "Indigo", "ey"
 * inside "Wiley". Both of those really happened — "Indigo Shire Council" was
 * filed under IGO, a Western Australian lithium miner. Comparing whole tokens
 * means a partial word can never match.
 */

/** Normalisation shared with the D1 dedup key (see lib/jobArchive.ts). */
export function normName(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Do these two names refer to the same company, on whole tokens?
 *
 * Generous by design: it answers "are these the same name, one possibly
 * shortened", not "is this the same legal entity". "Flight Centre" against
 * "Flight Centre Travel Group" has to resolve, because the callers use this to
 * ask whether an advertiser is some OTHER company on the roster, and a near
 * match should count there.
 */
export function sameCompanyName(a: string, b: string): boolean {
  const x = normName(a).split(" ").filter(Boolean);
  const y = normName(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return false;
  const [long, short] = x.length >= y.length ? [x, y] : [y, x];
  return long.slice(0, short.length).join(" ") === short.join(" ");
}

/**
 * The roster name appears in the advertiser only INSIDE a word.
 *
 * This is the specific defect worth naming: not "these differ", which is
 * usually a brand (CHEP is Brambles), but "these look related and are not".
 */
export function substringOnlyMatch(advertiser: string, rosterName: string): boolean {
  const a = normName(advertiser);
  const n = normName(rosterName);
  if (!a || !n || n.length < 2) return false;
  if (sameCompanyName(advertiser, rosterName)) return false;
  const wholeToken = new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(a);
  return !wholeToken && a.includes(n);
}
