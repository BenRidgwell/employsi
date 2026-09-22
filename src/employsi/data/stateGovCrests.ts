/**
 * The whole-of-government identity for Queensland, Victoria and New South
 * Wales, used as the badge for their agencies.
 *
 * WHY A SHARED CREST RATHER THAN 117 LOOKUPS
 *
 * The state government rosters carry no domain of their own — brisbaneGov.ts,
 * melbourneGov.ts and the NSW roster all synthesise one with `deriveDomain()`,
 * which is the agency name plus ".com". For a state agency that is wrong every
 * time, and not harmlessly wrong: measured 2026-09-22 across the three cities,
 * 117 agencies sat on such a domain and many of those domains are real
 * businesses. The Queensland Department of Education was drawing education.com's
 * orange F; Justice was drawing justice.com's mark; WorkSafe, the Lottery
 * Corporation, the Country Fire Authority, Museums Victoria and the Office of
 * Sport were each showing a stranger's brand, and four more were on the same
 * parked-domain favicon that NZ Police was (sha1 c20af3aed3de).
 *
 * Correcting 117 domains one at a time would fix that, but it is the wrong
 * shape of fix, because these agencies mostly do not HAVE a distinct badge to
 * find: Queensland, Victoria and NSW each mandate a single visual identity and
 * their agencies present it rather than a logo of their own. So the crest is
 * not a fallback standing in for the real mark — for most of these it IS the
 * real mark.
 *
 * That is the same argument, and the same shape, as WA_GOV_CREST in
 * waGovLogos.ts, which already does this for thirteen Perth agencies. Agencies
 * here will look alike. That is correct rather than a bug.
 *
 * WHERE IT SITS IN THE LADDER
 *
 * Below every source that is specific to one agency — a file in public/logos/,
 * a supplied URL, a confirmed LinkedIn avatar — and above the favicon service.
 * So an agency that does have its own mark keeps it, and only the ones that
 * would otherwise land on a guessed domain get the crest. See
 * lib/companyLogo.ts.
 *
 * THE FILES ARE COMMITTED, NOT HOTLINKED
 *
 * WA_GOV_CREST points at wa.gov.au and carries the standing risk that the file
 * moves. These three are in public/crests/ instead, taken from each
 * government's own site on 2026-09-22 and each opened and checked:
 *
 *   qld-gov.png  192x192  the Queensland state arms, "AUDAX AT FIDELIS"
 *                         (forgov.qld.gov.au's android icon)
 *   nsw-gov.png  180x180  the NSW Government waratah over "NSW"
 *   vic-gov.png   64x67   the Victorian Government "VIC" chevron. Small — it
 *                         is the largest flat mark vic.gov.au publishes, and
 *                         the badge draws at up to 128px, so it upscales about
 *                         2x. The shape is flat enough to survive it; replace
 *                         it if a bigger one turns up.
 */

/** Roster-id prefix → the crest that prefix's agencies present. */
export const STATE_GOV_CREST: Record<string, string> = {
  "qld-gov-": "/crests/qld-gov.png",
  "vic-gov-": "/crests/vic-gov.png",
  "nsw-gov-": "/crests/nsw-gov.png",
};

/**
 * The crest for a roster id, or "" if it is not a state agency covered here.
 *
 * Prefix-matched rather than listed per agency, unlike WA's explicit id list.
 * The WA list exists because the supplied workbook said, agency by agency,
 * which ones present the whole-of-government identity — that was real
 * information and worth keeping. There is no such source for these three, and
 * a prefix is honest about that: it says "every agency of this government,
 * unless something more specific was found for it", which is what the ladder
 * above it already enforces.
 */
export function stateGovCrest(id: string): string {
  for (const prefix in STATE_GOV_CREST) {
    if (id.startsWith(prefix)) return STATE_GOV_CREST[prefix];
  }
  return "";
}
