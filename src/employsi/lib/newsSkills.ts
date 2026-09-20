import { skillsForText, SKILL_PARENT } from "../data/skillsTaxonomy";

/**
 * Skills tagged onto a NEWS ARTICLE, the way a market app tags indexes to a
 * story.
 *
 * THIS FILE IS THE BASELINE AND NOTHING MORE, on purpose. It is `skillsForText`
 * collapsed to broad skills, which is exactly what the panel would do if it
 * called the matcher directly. It exists so scripts/check-news-skills.ts has a
 * fixed seam to measure, and so the suppression work that follows can be shown
 * to improve something rather than asserted to.
 *
 * WHY IT NEEDS SUPPRESSION AT ALL. `skillsForText` is tuned for JOB TITLES,
 * where every word is there to name an occupation. News copy is not like that:
 * it reuses the same vocabulary for other things, and business copy especially.
 * Measured against the 256 real headlines in scripts/newsSkillFixtures.ts —
 *
 *     Developer seeks to raise height of Albert Street apartment building
 *     Goodman Group posts $1.2b profit and expands data centre pipeline
 *     Is Monadelphous Group (ASX:MND) A Risky Investment?
 *     CEFC finance accelerates coal exit for manufacturing giant
 *
 * — which the title matcher reads, correctly for its own purpose and wrongly
 * for this one, as Software Engineering, Pipeline Engineering, Risk &
 * Compliance and Finance & Accounting.
 *
 * THE FIX DOES NOT BELONG IN THE TAXONOMY. Teaching GATED_TERMS that
 * "developer" is a property developer would break the job matcher, where
 * "Developer" is a software engineer and is the single most common title in the
 * archive. The senses are opposite, so the news reading has to be a layer here
 * rather than an edit there — which keeps the repo's one-matcher rule intact.
 */

/**
 * BROAD SKILLS ONLY.
 *
 * A speciality is a fine tag on a vacancy, where the title is written to be
 * precise, and a bad one on ten words of headline: "Underground Mining" from a
 * job ad is a claim the advertiser made, while the same tag off a headline is a
 * guess at which part of mining a reporter meant. Specialities fold up to the
 * parent they narrow, and the parent is what the reader sees.
 */
function toBroad(skill: string): string {
  return SKILL_PARENT[skill] ?? skill;
}

/**
 * How many tags a story may carry.
 *
 * Three, because the chips sit under a headline and a fourth pushes the row
 * taller than the thumbnail. It is also a precision guard: the long tail of a
 * match list is where the weak hits live, so the cap trims the least
 * defensible tag rather than the least recent.
 */
export const MAX_NEWS_TAGS = 3;

/**
 * Tags for one article.
 *
 * `text` is the headline today. When og:description is carried through it
 * should be appended here rather than matched separately — the matcher wants
 * one haystack, and a term spanning the join is not a term.
 */
export function newsSkillTags(text: string): string[] {
  if (!text.trim()) return [];
  const broad: string[] = [];
  for (const s of skillsForText(text)) {
    const b = toBroad(s);
    if (!broad.includes(b)) broad.push(b);
  }
  return broad.slice(0, MAX_NEWS_TAGS);
}
