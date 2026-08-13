/**
 * Which OTHER rostered companies a headline names.
 *
 * THE GAP THIS CLOSES. Each company's "in the news" feed is built from its own
 * independent search, so an article about two employers lands only on the card
 * whose query happened to return it. Measured 2026-08-12: the AFR's "Trump taps
 * BHP and Rio Tinto to fix critical minerals gap" was in Rio Tinto's stored feed
 * and absent from BHP's, because Bing returns a different selection for each
 * query even when the underlying story is the same. Both cards should carry it.
 *
 * MATCHING A COMPANY NAME IN PROSE IS THE WHOLE RISK, and this codebase has
 * already paid for getting it wrong once: plain containment filed "Indigo Shire
 * Council" under IGO and "Wiley" under EY. So this reuses the rule liveNewsFn
 * already applies to its outlet pool — a WHOLE-TOKEN match, anchored on both
 * sides, never a substring:
 *
 *     /(?<![\p{L}\p{N}])Rio Tinto(?![\p{L}\p{N}])/iu
 *
 * "IGO" therefore does not match inside "Indigo", and "EY" is refused outright
 * by the length floor below rather than matching the middle of a word.
 *
 * THE LENGTH FLOOR IS DELIBERATELY BLUNT. Two-character names — EY, and a
 * handful of tickers — are refused entirely. A two-letter token appears inside
 * ordinary prose constantly, and there is no anchoring that rescues it: the
 * cost of missing EY's cross-mentions is one company's occasional second
 * appearance, and the cost of accepting them is a wrong company on a card,
 * which is the failure this archive is least willing to make.
 */

/** Whole-token headline matcher for one company name, or null if unusable. */
export function headlineMatcher(name: string): RegExp | null {
  const n = name.trim();
  // Under three characters there is no safe anchoring — see the note above.
  if (n.length < 3) return null;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "iu");
}

export interface CompiledMention {
  name: string;
  /** Lowercased name, for the cheap pre-filter before the regex runs. */
  needle: string;
  re: RegExp;
}

/**
 * Compile a roster once, so a sweep does not rebuild 395 regexes per article.
 *
 * Names that cannot be matched safely are dropped here rather than at match
 * time, so the caller never has to think about the floor.
 */
export function compileMentions(names: string[]): CompiledMention[] {
  const out: CompiledMention[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const re = headlineMatcher(name);
    if (!re) continue;
    seen.add(key);
    out.push({ name, needle: key, re });
  }
  return out;
}

/**
 * Every compiled company named in `title`, excluding `self`.
 *
 * The indexOf pre-filter is what makes this affordable: a nightly sweep tests
 * roughly a thousand headlines against the whole roster, and a lowercase
 * substring scan rejects almost all of those pairs before the regex — which
 * still has the final say, so the loose pre-filter cannot admit "Indigo".
 */
export function companiesNamedIn(
  title: string,
  compiled: CompiledMention[],
  self?: string,
): string[] {
  const hay = (title || "").toLowerCase();
  if (!hay) return [];
  const selfKey = self?.trim().toLowerCase();
  const hits: string[] = [];
  for (const c of compiled) {
    if (c.needle === selfKey) continue;
    if (!hay.includes(c.needle)) continue;
    if (c.re.test(title)) hits.push(c.name);
  }
  return hits;
}

/** KV key for a company's CROSS-REFERENCED articles. Mirrors `newsKey`. */
export function xrefKey(name: string): string {
  return `newsx:${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}

/** How long a cross-referenced article stays on another company's card. */
export const XREF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Most cross-referenced articles kept per company. */
export const XREF_PER_COMPANY = 6;
