import { LOCAL_LOGO } from "../data/localLogos";
import { PRIVATE_LOGO_URL, PRIVATE_DOMAIN } from "../data/privateLogos";
import { WA_GOV_LOGO_URL, WA_GOV_CREST, WA_GOV_CREST_ID_SET } from "../data/waGovLogos";

/**
 * The badge image for a company, in one place.
 *
 * Three call sites used to build the same Google-favicon URL inline — the
 * company card, the compare card and the map marker — which meant a company's
 * logo could only ever be as good as a favicon, and improving it meant editing
 * three files that could drift apart.
 *
 * The order is best-available:
 *
 *   0. a file committed under public/logos/, named for the roster id. This
 *      wins over everything because it is the one source somebody chose
 *      deliberately, and the only one that cannot stop resolving when another
 *      party's server changes — the images are in the repo. It is therefore
 *      also how a wrong or ugly badge gets overridden without editing any of
 *      the data files below. See public/logos/README.md.
 *   1. the organisation's own logo file, where we have a verified one — the
 *      private roster from data/privateLogos.ts, the WA government agencies
 *      from data/waGovLogos.ts. A real brand mark, not a 16px favicon upscaled.
 *   2. the shared Government of WA crest, for the agencies that present the
 *      whole-of-government identity rather than a distinct logo of their own.
 *   3. the favicon service keyed on the organisation's REAL domain, where the
 *      roster's name-derived guess is known to be wrong.
 *   4. the favicon service on the roster domain — the previous behaviour, and
 *      still correct for everything we have nothing better for.
 *
 * Callers keep their own onError fallback to the ticker text: a logo file can
 * stop resolving long after it was verified, and a broken image is worse than
 * initials.
 */
export function logoFor(id: string, domain: string, size = 128): string {
  const direct = LOCAL_LOGO[id] || PRIVATE_LOGO_URL[id] || WA_GOV_LOGO_URL[id];
  if (direct) return direct;
  if (WA_GOV_CREST_ID_SET.has(id)) return WA_GOV_CREST;
  const host = PRIVATE_DOMAIN[id] || domain;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`;
}
