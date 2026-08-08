/**
 * Extra phrases to search for a roster company, beyond its own name.
 *
 * The daily Adzuna pull searches `what_phrase: target.name` — one phrase per
 * company. That is right for an employer who advertises under the name we hold,
 * and wrong for a holding company whose people are hired by its operating
 * businesses under THEIR names.
 *
 * Seven Group Holdings is the case that forced this. The roster holds it as
 * "SGH", so the pipeline searched Adzuna for the literal string "SGH" — which
 * matches almost nothing, because nobody advertises a job under a three-letter
 * ticker. Meanwhile Boral, WesTrac, Coates and Allight Sykes advertise
 * constantly, and every one of those ads was invisible to us.
 *
 * scripts/advertiser_match.py already maps those names BACK to sgh, so an ad
 * found under "Boral" is attributed correctly. That fixed attribution for ads
 * we happened to see; it could not make us look. This is the other half.
 *
 * WHY THIS FILE AND NOT auJobsTargets.ts: that file is generated
 * (scripts/gen-asx200.py), so a hand-added field there is lost the next time it
 * is regenerated. These are hand-researched corporate facts, so they live in a
 * file no generator writes.
 *
 * Only add a name the parent actually employs under. An ad found under a
 * subsidiary is filed against the PARENT, so a wrong entry here does not merely
 * add noise — it credits one employer with another's hiring.
 */
export const EXTRA_QUERIES: Record<string, string[]> = {
  // Seven Group Holdings (ASX:SGH). Its four operating businesses, which are
  // where essentially all of its ~11,000 people work:
  //   Boral         — construction materials (acquired outright 2024)
  //   WesTrac       — Caterpillar dealer, NSW/ACT/WA
  //   Coates        — industrial and general equipment hire
  //   Allight Sykes — lighting and dewatering pumps
  // SGH Energy is an investment arm and advertises under its own name rarely,
  // but is included because when it does, the ad is genuinely SGH's.
  "sydney-sgh": ["Boral", "WesTrac", "Coates Hire", "Allight Sykes", "SGH Energy"],
  // Swift Holdings Investments is the holding entity; every one of its
  // dealerships hires under the trading name Autoleague. Nobody advertises a
  // job under "Swift Holdings Investments", so the feeds were searching a
  // phrase that cannot match anything — the same failure SGH had above, and
  // invisible for the same reason: a company with no ads looks like a company
  // that is not hiring.
  //
  // This is only half the fix. It makes the feeds LOOK for the name;
  // ADVERTISER_ALIAS in scripts/advertiser_match.py is what lets an ad found
  // under "Autoleague" be attributed to the roster company rather than
  // rejected by the token rule.
  "priv-swift-holdings-investments": ["Autoleague"],
  // Perenti (ASX:PRN). Every one of its ~10,000 people is employed by a brand,
  // not by "Perenti" — its own SEEK advertiser record has served 0 ads every
  // time it has been checked, while the brands below were serving ~105.
  //
  // Worth knowing before adding more: on SEEK's keyword search the parent name
  // already returns these ads (the brands name Perenti in the ad body), so the
  // SEEK half of this was an ATTRIBUTION problem, fixed by ADVERTISER_ALIAS.
  // These phrases are here for Adzuna, which matches the phrase against the ad
  // rather than resolving an employer, and where the parent name finds nothing.
  "perth-prn": [
    "Barminco",
    "Ausdrill",
    "DDH1 Drilling",
    "Swick Mining Services",
    "BTP Group",
    "AUMS",
    "Strike Drilling",
  ],
  // Alkane Resources (ASX:ALK) hires under its two producing mines. Costerfield
  // arrived with the Mandalay Resources merger (completed 2025-08-05).
  alk: ["Costerfield Operations", "Tomingley Gold Operations"],
  // Seven West Media's newspaper arm. The television arm advertises as the bare
  // "Seven", which is far too short to search on — advertiser_match.py accepts
  // it when an ad arrives, but nobody should go looking for it.
  swm: ["West Australian Newspapers"],
  // Catalyst Metals (ASX:CYL) advertises through the operating entity for its
  // Plutonic gold mine rather than the listed parent.
  "perth-cyl": ["Catalyst Plutonic"],
};

/** Every phrase to search for this company: its own name first, then any extras. */
export function queryPhrases(id: string, name: string): string[] {
  const extra = EXTRA_QUERIES[id] ?? [];
  // Deduped case-insensitively so a subsidiary that shares the parent's name
  // does not cost a second identical request.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [name, ...extra]) {
    const k = p.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p.trim());
  }
  return out;
}
