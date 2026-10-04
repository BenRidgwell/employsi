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
// The full roster, so rule 3 recognises a global employer and not only the
// companies this pull searches — see rosterIndex below for what that was
// letting through.
import { COMPANIES } from "../../src/employsi/data/companies";
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

/**
 * Companies whose OWN name is too generic to search permissively, so the
 * advertiser must actually be them (the rule a subsidiary search already
 * applies, below). The value lists the other names they genuinely advertise
 * under.
 *
 * CCI is the case that forced it. The roster holds Catholic Church Insurance
 * as "CCI", a three-letter string that turns up in other employers' ads, and
 * the company has been in orderly run-off since May 2023 — it advertises
 * nothing. Measured 2026-09-30: all 40 archive rows on its card (23 live)
 * were other employers' — Brickworks 19, Avanade 11, ASC, Westpac and others.
 * A company in run-off should show a real zero, not someone else's hiring.
 */
const STRICT_NAME: Record<string, string[]> = {
  "priv-cci": ["Catholic Church Insurance"],
};

/**
 * Trading names that rule 3 cannot reach lexically, and the roster company
 * that actually owns them.
 *
 * Rule 3 asks "is this advertiser another roster company?" by comparing tokens,
 * so it only sees a brand that STARTS like the roster name. A company trading
 * under a different second word is invisible to it, and two were found filed
 * under a place-name collision (measured 2026-10-02, live rows still arriving):
 *
 *   'Opal HealthCare'  under uni-murdoch-university (8) and
 *                            uni-griffith-university (4) — Opal has care homes
 *                            in Murdoch WA and Griffith NSW, and the roster
 *                            holds the company as "Opal Aged Care"
 *   'Regis Connect'    under rrl (4) — Regis Healthcare's home-care brand, and
 *                            `rrl` is Regis Resources, a gold miner
 *
 * Each is checked, not assumed, and listed by the name the board prints. They
 * go through the same index as the roster names, so an ad is dropped for every
 * OTHER company and kept for the one that owns the brand.
 */
const TRADING_AS: Record<string, string> = {
  "Opal HealthCare": "priv-opal-aged-care",
  "Regis Connect": "melbourne-reg",
};

/**
 * Roster names, normalised, mapped to the company id that owns them.
 *
 * THE ROSTER HERE IS THE WHOLE ROSTER, not the list of companies the pull
 * searches. Until 2026-10-02 it was built from the Adzuna targets alone —
 * Australia's listed, private and university lines — so rule 3 could only
 * recognise an Australian employer. Every global company was invisible to it,
 * and an Australian keyword search returns their ads constantly, because the
 * search matches a PLACE as readily as an employer:
 *
 *   'Accor'            under 11 ids — Challenger, Melbourne/Perth/Canberra
 *                      Airport, the AFL, Zip and others, which are the venues
 *                      its hotels sit in or beside (90 rows)
 *   'Costco Wholesale' under priv-perth-airport (20) — the warehouse is in the
 *                      airport precinct
 *   'Amazon Web Services', 'Compass Group', 'Honeywell', 'Thiess', 'AECOM',
 *   'Newmont', 'Programmed', 'Marriott International', 'Hermès', 'BYD
 *   Australia', 'Nutrien', 'Mader Group', 'Singtel', 'Lenovo' … the same shape
 *   each time: a contractor, caterer or tenant on the searched company's site.
 *
 * lib/dataQualityFn.ts has always audited against the FULL roster, so it had
 * been reporting these all along while the gate that could have stopped them
 * ran on a shorter list. Measured 2026-10-02 over every Adzuna row in the
 * archive: the full roster rejects 556 rows across 157 advertiser/company
 * pairs, and every one of them is a third party on the searched company's
 * premises. None is the searched company under another name.
 *
 * What it still cannot judge is a LOCAL brand that shares a global company's
 * name — "Target Australia" is a Wesfarmers brand, not Target Corporation, and
 * nothing lexical separates them. None is in the archive today; if one arrives
 * the audit will report it and it belongs in DENY, which is what DENY is for.
 *
 * Indexed by first token because `sameCompanyName` requires the shorter name to
 * be a whole-token prefix of the longer, so the first tokens must be equal: a
 * lookup is exact and costs one Map hit instead of 1,500 comparisons a row.
 */
let ROSTER: Map<string, { name: string; id: string }[]> | null = null;
function rosterIndex(targets: JobsTarget[]): Map<string, { name: string; id: string }[]> {
  if (ROSTER) return ROSTER;
  const index = new Map<string, { name: string; id: string }[]>();
  // First id wins, matching how the archive resolves a dual-listed issuer: the
  // search targets are added before the roster so an Australian line keeps a
  // name its foreign twin shares.
  const claimed = new Set<string>();
  const add = (rawName: string, id: string) => {
    const n = norm(rawName);
    if (!n || claimed.has(n)) return;
    claimed.add(n);
    const head = n.split(" ")[0];
    const list = index.get(head);
    if (list) list.push({ name: n, id });
    else index.set(head, [{ name: n, id }]);
  };
  for (const t of targets) add(t.name, t.id);
  for (const c of COMPANIES) add(c.name, c.id);
  for (const [name, id] of Object.entries(TRADING_AS)) add(name, id);
  ROSTER = index;
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
    for (const entry of rosterIndex(allTargets).get(a.split(" ")[0]) ?? []) {
      if (entry.id === target.id) continue;
      if (sameCompanyName(adv, entry.name)) {
        return { keep: false, reason: `${JSON.stringify(adv)} is roster company ${entry.id}` };
      }
    }
  }

  // Rule 3b. A generic own name (STRICT_NAME) is held to the same standard as
  // a subsidiary search: the advertiser has to be the company.
  const strict = STRICT_NAME[target.id];
  if (strict) {
    const isThem =
      sameCompanyName(adv, target.name) || strict.some((alt) => sameCompanyName(adv, alt));
    if (!isThem) {
      return {
        keep: false,
        reason: `${JSON.stringify(adv)} is not ${target.name} (strict name for ${target.id})`,
      };
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
