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
