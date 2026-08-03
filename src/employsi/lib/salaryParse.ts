/**
 * Advertised-salary strings in the D1 archive → an annual AUD number.
 *
 * The archive stores whatever text a board printed, and that text is wildly
 * inconsistent. Measured across the 7,356 currently-advertised rows that carry
 * both a salary and skills (2026-08-03), the shapes are:
 *
 *     2,236  $100k                       1,597  S$3,000–S$5,000/mo
 *     1,699  72,038                        528  $110k - $149k
 *       377  21,280–22,800                 207  A$95,000 - A$110,000
 *       176  ₱25,000 – ₱35,000 per month    72  15-25万
 *        58  RM 4,000 – RM 6,000 per month  35  $50k - $69k, $70k - $89k
 *        29  $32.02 - $37.35 an hour        23  Negotiable
 *
 * THE CURRENCY IS NOT IN THE STRING. That is the single fact this module is
 * built around. Adzuna writes a bare number for its US, UK and Canadian rows —
 * "72,038" is a San Jose listing in USD, "21,280–22,800" a London one in GBP,
 * "62,400–104,000" a Toronto one in CAD — and an unqualified "$110k - $149k"
 * is Australian only because its hub is Brisbane. Averaging those together
 * produces a number that is not a salary in any currency, which is exactly the
 * kind of plausible-looking invention this codebase keeps having to undo.
 *
 * So a row counts only when BOTH hold:
 *
 *   1. its hub is an Australian city we plot, and
 *   2. its salary text carries no foreign-currency marker.
 *
 * Everything else is dropped rather than converted. Converting would mean
 * carrying an FX rate, and a figure that moves because the dollar moved is not
 * a labour-market measurement.
 *
 * A range becomes its MIDPOINT — the ad's own single best figure — and the
 * medians are then taken across ads, so one employer posting a 200k band cannot
 * drag a skill on its own.
 */

/** Hubs whose unqualified "$" is Australian dollars. */
const AU_HUBS = new Set([
  "perth",
  "sydney",
  "melbourne",
  "brisbane",
  "adelaide",
  "canberra",
  "darwin",
  "hobart",
]);

/**
 * Any marker that says "this is not AUD".
 *
 * `S$` has to be tested before a bare `$`, and `A$` must NOT match — hence the
 * explicit alternation rather than a "starts with $" test. "万" is the Chinese
 * ten-thousand unit used by Zhaopin ("15-25万"), which is both a foreign
 * currency and a foreign magnitude.
 */
const FOREIGN =
  /S\$|US\$|NZ\$|HK\$|C\$|RM|₱|PHP|SGD|USD|MYR|CNY|IDR|INR|THB|¥|£|€|₹|元|万|AED|SAR|QAR/i;

/** Paid hours in an Australian year: a 38-hour week over 46 weeks, which allows
 *  for four weeks' leave plus public holidays. Only used for "an hour" ads. */
const ANNUAL_HOURS = 38 * 46;

/**
 * Plausible annual AUD. Below the floor is almost always an hourly or weekly
 * figure that did not say so, or a stray number like a reference code; above
 * the ceiling is almost always a total contract value. Both are dropped rather
 * than guessed at.
 */
const MIN_ANNUAL = 20_000;
const MAX_ANNUAL = 600_000;

/**
 * One archived row's salary text → annual AUD, or null when it cannot be read
 * honestly. `hub` is the row's hub column, which is what carries the currency.
 */
export function annualAud(salary: string | null | undefined, hub: string | null): number | null {
  const s = (salary || "").trim();
  if (!s || !hub || !AU_HUBS.has(hub)) return null;
  if (FOREIGN.test(s)) return null;
  const low = s.toLowerCase();
  // "per month" / "/mo" on an unmarked figure is a foreign board's shape and,
  // more importantly, an ambiguity we do not need to resolve: drop it.
  if (
    /\bper month\b|\/mo\b|\bmonthly\b|\bper week\b|\bweekly\b|\bper day\b|\bdaily rate\b/.test(low)
  )
    return null;
  const nums = (s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => Number(n.replace(/,/g, "")));
  if (!nums.length) return null;
  // "$110k - $149k" — the k applies to every figure in the string; no archived
  // row mixes a k figure with a plain one.
  const thousands = /\d\s*k\b/i.test(s);
  const hourly = /\ban hour\b|\bper hour\b|\bhourly\b|\/hr\b/.test(low);
  let vals = nums.map((n) => (thousands ? n * 1000 : n));
  if (hourly) vals = vals.map((n) => n * ANNUAL_HOURS);
  vals = vals.filter((v) => v >= MIN_ANNUAL && v <= MAX_ANNUAL);
  if (!vals.length) return null;
  // Midpoint of the advertised band. sa-gov posts two bands in one string
  // ("$50k - $69k, $70k - $89k"); min..max spans both, which is the range the
  // ad actually offers.
  return Math.round((Math.min(...vals) + Math.max(...vals)) / 2);
}

/**
 * Median of a set of annual figures, or null when there are too few to publish.
 *
 * MIN_ADS is a floor on how thin a median may be, not a statistical nicety.
 * Measured on the live archive: 80 skills have at least one salaried Australian
 * ad, 67 have three, 54 have five and 45 have eight — the count stops falling
 * steeply at eight, so that is where the floor sits. Below it the row shows no
 * figure at all, the same way the sparkline is omitted when the archive is too
 * young to draw one honestly.
 */
export const MIN_ADS = 8;

export function medianAnnual(values: number[]): number | null {
  if (values.length < MIN_ADS) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** 114000 → "$114k". The ticker's figure is a magnitude, not an exact salary,
 *  and the design prints it rounded to the nearest thousand. */
export function fmtPay(annual: number): string {
  return `$${Math.round(annual / 1000)}k`;
}
