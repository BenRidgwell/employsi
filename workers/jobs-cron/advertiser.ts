/**
 * Should an Adzuna result be filed under the company we searched for?
 *
 * Adzuna is queried once per company with `what_phrase = <company name>`, and
 * until now whatever `company.display_name` came back was archived under that
 * company id with no check at all. Measured against the live archive, that
 * filed "Macquarie University" under Macquarie Group, "Anduril" under RAA,
 * "Flight Centre" under Corporate Travel Management, and — because the field
 * is scraped rather than structured — literal page furniture like "Subscribe
 * to job alerts" under Aurizon and "Job Details" under Cleanaway.
 *
 * WHY THIS IS NOT THE SAME RULE THE JOBSTREET FEED USES
 * A name test alone cannot work here. Adzuna returns the BRAND a role is
 * advertised under, and the brand is very often not the listed entity:
 *
 *     CHEP                     is Brambles
 *     Dan Murphy's             is Endeavour Group
 *     Woolworths Supermarkets  is Woolworths Group
 *     Barminco                 is Perenti
 *     Primero                  is NRW Holdings
 *
 * Those are correct attributions and they are the majority of the mismatches.
 * A strict name test would delete around three thousand rows of real coverage
 * to remove a few dozen wrong ones — a much worse trade than the one it fixes.
 *
 * So this rejects only what can be SHOWN to be wrong, and keeps everything
 * else. Three rules, each grounded in rows actually found in the archive:
 *
 *   1. The name is page furniture, not an employer.
 *   2. The roster name appears only INSIDE a word — "igo" in "Indigo".
 *   3. The name belongs to a DIFFERENT company on our own roster. If an ad is
 *      placed by Flight Centre, it is not a Corporate Travel Management ad,
 *      whatever the keyword search thought.
 *
 * Rule 3 is the powerful one and it is self-maintaining: it uses the roster we
 * already have rather than a list anyone has to curate.
 *
 * What it deliberately does NOT catch is a wrong name that is neither junk nor
 * on our roster — "Macquarie University" is a real employer we do not track,
 * so nothing lexical distinguishes it from "Dan Murphy's". Those need naming
 * individually, which is what DENY is for, and scripts/audit-attribution.py
 * lists the candidates.
 */
import type { JobsTarget } from "../../src/employsi/data/auJobsTargets";
// The token comparison lives in the app so the Adzuna filter and the
// data-quality audit that reviews its output cannot drift apart.
import { normName as norm, sameCompanyName } from "../../src/employsi/lib/advertiserMatch";

/**
 * Board page furniture that reached the archive as an employer name.
 *
 * Matched against the WHOLE name, not as a prefix. A prefix test was tried
 * first and immediately took real employers with it: "Next Payments Pty" and
 * "Show Group" are both companies on live Adzuna listings, and both start with
 * a word that also begins a pagination control. Page furniture is a fixed
 * phrase, so requiring the whole string to be one costs nothing and cannot
 * misfire on a company whose name merely starts the same way.
 *
 * "Subscribe to job alerts" (under Aurizon) and "Job Details" (under
 * Cleanaway) are the two found in live rows; the rest are the same class of
 * control and are listed so they never get there.
 */
const NOT_AN_EMPLOYER =
  /^(job details|job alerts?|jobs?|subscribe( to job alerts?)?|apply( now)?|click here|view (all )?jobs?|see (all )?jobs?|more jobs?|load more|read more|search jobs?|next page|previous page|back to (search|results)|all jobs|vacancies|position details)$/i;

/**
 * Advertisers confirmed NOT to be the company they were being filed under.
 *
 * Only for cases nothing lexical can settle — a real employer, not on our
 * roster, that a keyword search kept attaching to a roster company. Each was
 * checked rather than assumed. Keyed by company id so the same brand name can
 * be legitimate elsewhere.
 */
const DENY: Record<string, string[]> = {
  // The university is a separate institution from the bank, and shares only
  // the place name both are named after.
  "sydney-mqg": ["macquarie university"],
  // A US defence manufacturer, not the South Australian motoring club.
  "priv-raa": ["anduril"],
  // Karara is a Gindalbie/Ansteel joint venture, unrelated to Magnetite Mines.
  mgt: ["karara mining"],
  // Wood is an independent engineering contractor, not part of Ampol.
  "sydney-ald": ["wood group", "wood"],
};

/** Roster names, normalised, mapped to the company id that owns them. */
let ROSTER: Map<string, string> | null = null;
function rosterIndex(targets: JobsTarget[]): Map<string, string> {
  if (ROSTER) return ROSTER;
  ROSTER = new Map();
  for (const t of targets) {
    const n = norm(t.name);
    // First id wins, matching how the archive resolves a dual-listed issuer.
    if (n && !ROSTER.has(n)) ROSTER.set(n, t.id);
  }
  return ROSTER;
}

export interface AdvertiserVerdict {
  keep: boolean;
  /** Why it was dropped, for the run log. Absent when kept. */
  reason?: string;
}

export function checkAdvertiser(
  advertiser: string,
  target: JobsTarget,
  allTargets: JobsTarget[],
  /**
   * The phrase the search actually used, when it was not the target's own name
   * — a holding company is searched under its operating businesses too (see
   * ./companyQueries.ts). The name rules below must judge the advertiser
   * against WHAT WAS SEARCHED, not against the parent: an ad returned by a
   * "Boral" search should look like Boral's, and comparing it to "SGH" would
   * both fail to catch an unrelated advertiser and make the reject reason
   * nonsense. Defaults to the target's name, which is the ordinary case.
   */
  searchedAs?: string,
): AdvertiserVerdict {
  const adv = (advertiser || "").trim();
  // No name at all is not evidence of anything; the caller already falls back
  // to the target's own name, which is what the search asked for.
  if (!adv) return { keep: true };

  if (NOT_AN_EMPLOYER.test(adv)) {
    return { keep: false, reason: `not an employer name: ${JSON.stringify(adv)}` };
  }

  const expected = (searchedAs || target.name).trim();
  const a = norm(adv);
  const n = norm(expected);
  if (!a) return { keep: false, reason: `empty after normalisation: ${JSON.stringify(adv)}` };

  // The deny list stays keyed on the target: it records advertisers wrongly
  // attributed to THIS company, whichever phrase surfaced them.
  if ((DENY[target.id] ?? []).includes(a)) {
    return { keep: false, reason: `on the deny list for ${target.id}: ${JSON.stringify(adv)}` };
  }

  // Rule 2. Only fires when the name is NOT a whole-token match, so
  // "Woolworths Supermarkets" (which contains the token run "woolworths") is
  // untouched and "Indigo Shire Council" against "IGO" is not.
  const wholeToken = new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(a);
  if (!wholeToken && a.includes(n) && n.length >= 2) {
    return { keep: false, reason: `${JSON.stringify(adv)} only contains "${n}" inside a word` };
  }

  // Rule 3. An advertiser that IS another roster company belongs to that
  // company, not this one. Checked last because it is the most expensive.
  if (!sameCompanyName(adv, expected)) {
    for (const [rosterName, id] of rosterIndex(allTargets)) {
      if (id === target.id) continue;
      if (sameCompanyName(adv, rosterName)) {
        return { keep: false, reason: `${JSON.stringify(adv)} is roster company ${id}` };
      }
    }
  }

  // Rule 4, and ONLY for a subsidiary search. Everywhere else this function is
  // deliberately permissive — it rejects what it can prove wrong rather than
  // allowlisting, because an employer's own name has endless legitimate
  // variants. That is the right default when the phrase IS the company.
  //
  // It is the wrong default for an alias. Searching "Boral" on behalf of SGH
  // returns every ad mentioning Boral, including aggregator reposts — measured,
  // the first run filed "JobRadars - AU" and "ABCDEFG" under SGH. Those are not
  // near-misses to be argued about; they are third parties, and crediting SGH
  // with their ads is exactly the kind of quietly wrong number this codebase
  // exists to avoid.
  //
  // So when we searched a specific subsidiary we require the advertiser to
  // actually look like it. We know precisely who we are looking for here, which
  // is what makes strictness safe: it costs nothing but the reposts.
  if (searchedAs && norm(searchedAs) !== norm(target.name)) {
    const looksRight =
      sameCompanyName(adv, expected) ||
      new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(a) ||
      // The parent's own name is equally valid on a subsidiary's ad.
      sameCompanyName(adv, target.name);
    if (!looksRight) {
      return {
        keep: false,
        reason: `${JSON.stringify(adv)} does not look like ${JSON.stringify(searchedAs)} (subsidiary search for ${target.id})`,
      };
    }
  }

  return { keep: true };
}

/** Test seam: the index is memoised, and the roster differs between tests. */
export function resetRosterIndex(): void {
  ROSTER = null;
}
