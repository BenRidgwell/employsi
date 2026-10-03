import { HAYS_PAY, HAYS_ROLES, HAYS_SOURCE } from "../data/haysSalary";
import { HAYS_ROLE_NODE } from "../data/haysRoleMap";

/**
 * The Hays Salary Guide band for a career rung, where the guide covers it.
 *
 * WHAT THIS IS FOR. A rung's own `pay` is the median of what employers
 * ADVERTISED, and it is null on 75% of rungs — 55% have no disclosing ad at
 * all. Nothing computed from our own archive can fill that: no ad stated a
 * figure. The guide can, and this is the only thing in the app that answers
 * "what does this rung pay" when the market has not said.
 *
 * IT IS NOT THE SAME QUANTITY AND MUST NEVER BE TREATED AS ONE.
 *   * The guide is a recruiter's view of what a role commands; `pay` is what
 *     was advertised; salaryBaseline.ts is what people received. Three
 *     instruments, three questions, and the gap between any two of them is
 *     mostly the gap between two ways of measuring.
 *   * The guide EXCLUDES superannuation; an advertised package usually
 *     includes it.
 * So this is shown INSTEAD OF a median, never beside it and never averaged
 * into one, and whatever shows it names the guide.
 */
export interface HaysBand {
  /** Thousands, as the guide publishes. */
  lo: number;
  hi: number;
  /** AUD or NZD — the guide's NZ cities are in NZD. */
  currency: "AUD" | "NZD";
  /** The edition these figures are from. Named on screen: a 2023 band is a
   *  statement about 2023, and a reader comparing it to today should be able
   *  to see that it is. */
  edition: string;
  /** How many of the guide's roles map to this rung, and how many figures sit
   *  behind the band. A span built from one role in one city is a different
   *  claim from one built from nine roles across eight, and the surface can
   *  only say so if it is told. */
  roles: number;
  figures: number;
  /** "Hays Salary Guide". */
  source: string;
}

/** Country -> whether a guide row belongs to it. The guide covers AU and NZ
 *  only, and its NZ rows are NZD, so a country that mixed them would produce a
 *  band in two currencies at once. */
const IN_COUNTRY: Record<string, (state: string) => boolean> = {
  au: (s) => s !== "NZ",
  nz: (s) => s === "NZ",
};

/** node -> the Hays role indices mapped onto it, built once. */
const ROLES_FOR_NODE = (() => {
  const m = new Map<string, number[]>();
  for (const [idx, node] of Object.entries(HAYS_ROLE_NODE)) {
    const arr = m.get(node);
    if (arr) arr.push(Number(idx));
    else m.set(node, [Number(idx)]);
  }
  return m;
})();

/** role index -> its rows, built once. */
const ROWS_FOR_ROLE = (() => {
  const m = new Map<number, typeof HAYS_PAY>();
  for (const row of HAYS_PAY) {
    const arr = m.get(row[0]);
    if (arr) arr.push(row);
    else m.set(row[0], [row]);
  }
  return m;
})();

/**
 * The band for `family|track|rung` in this country, or null.
 *
 * ONE EDITION, THE NEWEST THAT COVERS THE RUNG. Spanning editions would put
 * FY22/23 and FY24/25 figures in one range and call the result current — a
 * three-year-wide band read as this year's. The edition is returned so the
 * surface can say which year it is quoting.
 *
 * THE SPAN IS THE WIDEST THE MAPPED ROLES OFFER, not an average of them.
 * Averaging the bounds of several roles' bands yields a figure that is nobody's
 * published band; the span answers "what do roles on this rung pay", which is
 * the question being asked of it.
 */
export function haysBandFor(node: string, country: string): HaysBand | null {
  const inCountry = IN_COUNTRY[country];
  if (!inCountry) return null;
  const roleIdxs = ROLES_FOR_NODE.get(node);
  if (!roleIdxs?.length) return null;

  // Newest edition first. The labels sort usefully as strings — "FY24/25" after
  // "FY22/23" after "2023" is wrong by a year, so they are ranked by the last
  // two digits of the span they name rather than lexically.
  const yearOf = (ed: string) => {
    const m = ed.match(/(\d{2})(?!.*\d)/);
    return m ? Number(m[1]) : 0;
  };

  const byEdition = new Map<string, { lo: number; hi: number; roles: Set<number>; n: number }>();
  for (const idx of roleIdxs) {
    for (const row of ROWS_FOR_ROLE.get(idx) ?? []) {
      const [, edition, , state, , , lo, hi] = row;
      if (!inCountry(state)) continue;
      if (!(lo > 0) || !(hi > 0)) continue;
      const e = byEdition.get(edition) ?? { lo: Infinity, hi: 0, roles: new Set<number>(), n: 0 };
      e.lo = Math.min(e.lo, lo);
      e.hi = Math.max(e.hi, hi);
      e.roles.add(idx);
      e.n += 1;
      byEdition.set(edition, e);
    }
  }
  if (!byEdition.size) return null;
  const [edition, best] = [...byEdition.entries()].sort((a, b) => yearOf(b[0]) - yearOf(a[0]))[0];
  return {
    lo: best.lo,
    hi: best.hi,
    currency: country === "nz" ? "NZD" : "AUD",
    edition,
    roles: best.roles.size,
    figures: best.n,
    source: HAYS_SOURCE.name,
  };
}

/** "$95k–$160k", or with the currency named where it is not the reader's. */
export function haysBandLabel(b: HaysBand): string {
  const unit = b.currency === "NZD" ? "NZ$" : "$";
  return `${unit}${Math.round(b.lo)}k–${unit}${Math.round(b.hi)}k`;
}

/** Which Hays roles sit behind a rung's band — for a surface that wants to say
 *  what was mapped rather than ask the reader to trust it. */
export function haysRolesFor(node: string): string[] {
  return (ROLES_FOR_NODE.get(node) ?? [])
    .map((i) => HAYS_ROLES[i]?.role)
    .filter((x): x is string => !!x);
}
