import { PRIVATE_LOGO_URL, PRIVATE_DOMAIN } from "../data/privateLogos";

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
 *   1. the company's own logo file, where we have a verified one
 *      (data/privateLogos.ts). A real brand mark, not a 16px favicon upscaled.
 *   2. the favicon service keyed on the company's REAL domain, where the
 *      roster's name-derived guess is known to be wrong.
 *   3. the favicon service on the roster domain — the previous behaviour, and
 *      still correct for every company we have nothing better for.
 *
 * Callers keep their own onError fallback to the ticker text: a logo file can
 * stop resolving long after it was verified, and a broken image is worse than
 * initials.
 */
export function logoFor(id: string, domain: string, size = 128): string {
  const direct = PRIVATE_LOGO_URL[id];
  if (direct) return direct;
  const host = PRIVATE_DOMAIN[id] || domain;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`;
}
