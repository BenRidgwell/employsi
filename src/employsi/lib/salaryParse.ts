/**
 * Advertised-salary strings in the D1 archive → an annual AUD number.
 *
 * The archive stores whatever text a board printed, and that text is wildly
 * inconsistent. Measured across the 7,356 currently-advertised rows that carry
 * both a salary and skills (2026-08-03):
 *
 *     2,236  $100k                       1,597  S$3,000–S$5,000/mo
 *     1,699  72,038                        528  $110k - $149k
 *       377  21,280–22,800                 207  A$95,000 - A$110,000
 *       176  ₱25,000 – ₱35,000 per month    72  1.5-2.5万
 *        58  RM 4,000 – RM 6,000 per month  35  $50k - $69k, $70k - $89k
 *        29  $32.02 - $37.35 an hour        23  Negotiable / 面议
 *
 * Three things have to be recovered before any of it can be compared: the
 * CURRENCY, the PERIOD and the MAGNITUDE. None is reliably in the string.
 *
 * CURRENCY. Adzuna writes a bare number for its US, UK and Canadian rows —
 * "72,038" is San Jose in USD, "21,280–22,800" London in GBP — and an
 * unqualified "$110k - $149k" is Australian only because its hub is Brisbane.
 * So the currency is read from, in order: an explicit marker in the text, then
 * the row's hub, then the row's source for the boards that serve exactly one
 * country (sa-gov is South Australia; jobstreet-ph is the Philippines). A row
 * that answers to none of the three is dropped, not guessed at.
 *
 * PERIOD. Singapore and the Philippines advertise monthly, Zhaopin advertises
 * monthly, Indeed sometimes advertises hourly, and Zhaopin occasionally
 * advertises a day rate. Getting this wrong is a 12x error, so it was measured
 * rather than assumed — see the note on 万 below.
 *
 * MAGNITUDE. "k" means thousands; the Chinese "万" means ten thousand.
 *
 * WHY 万 IS MONTHLY, WHICH IS NOT OBVIOUS
 * A range like "15-25万" reads as 150,000-250,000 and the instinct is to call
 * that an annual salary. It is not. In the same Beijing rows the archive holds
 * "7000-14000元" and "cny15,000 - cny20,000 per month", and "1.5-2.5万" sits at
 * exactly that magnitude — 15,000-25,000 a month. The one row that IS annual
 * says so: "cny300k - cny400k per year", which is 25-33k a month and agrees.
 * Reading 万 as annual would have published every Chinese salary 12x too low
 * against its peers; reading the monthly figures as annual would have published
 * them 12x too high.
 *
 * The "·13薪" suffix some Chinese ads carry is the number of months paid in a
 * year, and it is honoured — it is the ad's own statement about its total.
 *
 * A range becomes its MIDPOINT, the ad's single best figure, and medians are
 * taken across ads so one employer's wide band cannot drag a skill on its own.
 */
import { CITY_COUNTRY } from "../data/mapboxWorldGeo";
import { FX_TO_AUD, FX_AS_AT } from "../data/fxRates";

export { FX_AS_AT };

/** Country (as CITY_COUNTRY spells it) → the currency its ads are priced in. */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  au: "AUD",
  nz: "NZD",
  us: "USD",
  gb: "GBP",
  uk: "GBP",
  ca: "CAD",
  sg: "SGD",
  my: "MYR",
  ph: "PHP",
  cn: "CNY",
  hk: "HKD",
  in: "INR",
  jp: "JPY",
  kr: "KRW",
  ae: "AED",
  sa: "SAR",
  qa: "QAR",
  th: "THB",
  id: "IDR",
  ch: "CHF",
  za: "ZAR",
  de: "EUR",
  fr: "EUR",
  es: "EUR",
  it: "EUR",
  nl: "EUR",
  ie: "EUR",
  be: "EUR",
  at: "EUR",
  pt: "EUR",
  fi: "EUR",
};

/**
 * Boards that serve exactly one country, for rows whose hub is null.
 *
 * This is worth having rather than dropping those rows: 465 of the 891
 * hub-less salaried rows are sa-gov, which is South Australia by definition,
 * and another 182 are the single-country JobStreet sites. A board that spans
 * markets (Adzuna, LinkedIn, Indeed, SEEK) is deliberately absent — for those a
 * missing hub really does mean the country is unknown.
 */
const COUNTRY_BY_SOURCE: Record<string, string> = {
  "wa-gov": "au",
  "sa-gov": "au",
  "vic-gov": "au",
  "qld-gov": "au",
  "nsw-gov": "au",
  "nt-gov": "au",
  "tas-gov": "au",
  "aps-gov": "au",
  "nz-gov": "nz",
  mycareersfuture: "sg",
  jobstreet: "my",
  "jobstreet-ph": "ph",
  zhaopin: "cn",
  naukri: "in",
  gulftalent: "ae",
  "jobsdb-hk": "hk",
  // simplyhired.com.au — the Australian site, so an ad it carries is priced in
  // AUD even when the row's hub could not be resolved from its location text.
  simplyhired: "au",
};

/**
 * Explicit currency markers, longest and most specific first — "S$" and "A$"
 * must both be tested before a bare "$", and "US$"/"NZ$"/"HK$"/"C$" before
 * either. Order is load-bearing.
 */
const MARKERS: [RegExp, string][] = [
  [/US\$|\bUSD\b/i, "USD"],
  [/NZ\$|\bNZD\b/i, "NZD"],
  [/HK\$|\bHKD\b/i, "HKD"],
  [/S\$|\bSGD\b/i, "SGD"],
  [/A\$|\bAUD\b/i, "AUD"],
  [/C\$|\bCAD\b/i, "CAD"],
  [/\bRM\b|\bMYR\b/i, "MYR"],
  [/₱|\bPHP\b/i, "PHP"],
  [/\bCNY\b|元|万|¥/i, "CNY"],
  [/₹|\bINR\b/i, "INR"],
  [/£|\bGBP\b/i, "GBP"],
  [/€|\bEUR\b/i, "EUR"],
  [/\bAED\b/i, "AED"],
  [/\bSAR\b/i, "SAR"],
  [/\bQAR\b/i, "QAR"],
  [/\bTHB\b/i, "THB"],
  [/\bIDR\b/i, "IDR"],
  [/\bCHF\b/i, "CHF"],
  [/\bZAR\b/i, "ZAR"],
];

/** Paid hours in a year: a 38-hour week over 46 weeks, allowing four weeks'
 *  leave plus public holidays. Days use the same 46 weeks at 5 a week. */
const ANNUAL_HOURS = 38 * 46;
const ANNUAL_DAYS = 5 * 46;

/**
 * Plausible annual AUD once converted.
 *
 * THE FLOOR HAS TO BE LOW, and that is not sloppiness. It exists to catch a
 * period we failed to read or a stray number like a reference code, and an
 * earlier 20,000 draft did that — while also deleting every Philippine ad on
 * the board. ₱28,000 a month is an ordinary Manila salary and converts to about
 * A$7,800 a year, so an Australian-shaped floor silently erased a whole market
 * as if it had published nothing. 5,000 still rejects the things it is for:
 * London's unlabelled "14–18" (an hourly rate, A$27–34) and "180–240" (a day
 * rate, A$344–459) both fall well short.
 */
const MIN_ANNUAL = 5_000;
const MAX_ANNUAL = 600_000;

/** What a row tells us about where it is, in the order we trust it. */
export interface SalaryRow {
  salary: string | null | undefined;
  hub: string | null;
  source?: string | null;
}

function currencyFor(s: string, hub: string | null, source?: string | null): string | null {
  for (const [re, code] of MARKERS) if (re.test(s)) return code;
  const country = (hub && CITY_COUNTRY[hub]) || (source && COUNTRY_BY_SOURCE[source]) || null;
  return country ? (CURRENCY_BY_COUNTRY[country] ?? null) : null;
}

/**
 * One archived row's salary text → annual AUD, or null when it cannot be read
 * honestly.
 */
export function annualAud(row: SalaryRow): number | null {
  const s = (row.salary || "").trim();
  if (!s) return null;
  const currency = currencyFor(s, row.hub, row.source);
  if (!currency) return null;
  const rate = FX_TO_AUD[currency];
  if (!rate) return null;

  const low = s.toLowerCase();
  const nums = (s.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => Number(n.replace(/,/g, "")));
  if (!nums.length) return null;

  // Magnitude. "万" is ten thousand; "k" is a thousand. A string carrying 万
  // never also carries k.
  const wan = /万/.test(s);
  const thousands = !wan && /\d\s*k\b/i.test(s);
  let vals = nums.map((n) => (wan ? n * 10_000 : thousands ? n * 1_000 : n));

  // Period, most specific first. An explicit "per year" wins over everything;
  // 万 and 元 are monthly on this board (see the note above) unless the ad says
  // otherwise.
  const perYear = /\bper year\b|\byearly\b|\bper annum\b|\bp\.?a\.?\b|\/yr\b|年薪/.test(low);
  const perHour = /\ban hour\b|\bper hour\b|\bhourly\b|\/hr\b|\/hour\b/.test(low);
  const perDay = /\bper day\b|\bdaily\b|\/day\b|元\s*\/\s*天|\/天/.test(low);
  const perWeek = /\bper week\b|\bweekly\b|\/wk\b/.test(low);
  const perMonth =
    /\bper month\b|\bmonthly\b|\/mo\b|\/month\b|\/月/.test(low) ||
    (!perYear && (wan || /元/.test(s)));

  // "·13薪" — thirteen months' pay in the year. The ad's own statement about
  // its annual total, so it is used in place of 12.
  const monthsMatch = s.match(/(\d{2})\s*薪/);
  const monthsPerYear = monthsMatch ? Number(monthsMatch[1]) : 12;

  if (perHour) vals = vals.map((n) => n * ANNUAL_HOURS);
  else if (perDay) vals = vals.map((n) => n * ANNUAL_DAYS);
  else if (perWeek) vals = vals.map((n) => n * 46);
  else if (perMonth) vals = vals.map((n) => n * monthsPerYear);

  // Convert, then band-check: the band is in AUD, so it has to be applied after
  // conversion or every Philippine and Indonesian ad fails it.
  vals = vals.map((n) => n * rate).filter((v) => v >= MIN_ANNUAL && v <= MAX_ANNUAL);
  if (!vals.length) return null;
  // Midpoint of the advertised band. sa-gov posts two bands in one string
  // ("$50k - $69k, $70k - $89k"); min..max spans both, which is the range the
  // ad actually offers.
  return Math.round((Math.min(...vals) + Math.max(...vals)) / 2);
}

/**
 * Median of a set of annual AUD figures, or null when there are too few to
 * publish.
 *
 * MIN_ADS is a floor on how thin a median may be, not a statistical nicety.
 * Below it the row shows no figure at all, the same way the sparkline is
 * omitted when the archive is too young to draw one honestly.
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
