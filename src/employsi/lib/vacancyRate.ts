// Vacancy RATE: internet vacancies per 1,000 people already employed in the
// occupations that carry a skill.
//
// WHY A RATE AND NOT A COUNT
// A vacancy count answers "where are the most job ads", which is a question
// about the size of an occupation as much as about scarcity. Retail & Customer
// Service out-posts every engineering discipline in Australia because there are
// a great many retail workers and they change jobs often — not because retail
// labour is tight. Dividing by the employed stock down-weights large
// churn-heavy occupations and up-weights small ones where a handful of openings
// is a large share of the available pool.
//
// PER 1,000, not a percentage or a bare ratio: the raw figure is a few
// thousandths and reads as noise, and "12 openings per 1,000 people doing this
// work" is a sentence someone can check against their intuition.
//
// WHAT MAKES THE DIVISION LEGITIMATE
// Both sides are attributed by the same mapping. iviSkillDemand.ts and
// absOccupationSupply.ts are generated from the same OVERRIDE table and the same
// skillsTaxonomy matcher, so an occupation counted into a skill's vacancies is
// counted into that skill's employment too. Change the taxonomy and both move.
//
// An occupation that maps to two skills lands in both, on both sides. The
// per-skill rate is therefore coherent; adding employment across skills is not
// a share of the workforce and is not offered here.
import { IVI_MONTHS, IVI_SERIES } from "../data/iviSkillDemand";
import { ABS_EMPLOYMENT, ABS_EMPLOYMENT_NATIONAL, ABS_QUARTERS } from "../data/absOccupationSupply";

/** Vacancies per this many employed persons. */
export const RATE_BASE = 1000;

/**
 * Smallest denominator that may produce a rate.
 *
 * EQ08 is a household SURVEY, and its small cells are estimates built from very
 * few sampled records. Measured across the 604 skill/city pairs at 2026-05:
 * Canberra Quality Assurance came back with ONE employed person against 20
 * vacancies — 20,000 per 1,000 — and Canberra Mining Engineering with one
 * person against four. Six pairs implied more vacancies than workers and two
 * more were merely absurd; every one of the eight sat below 100 employed, while
 * nothing above about 140 was implausible.
 *
 * So the floor is 1,000: a cell smaller than the thousand-person unit the source
 * is denominated in is sampling noise, and a rate computed from it is noise
 * multiplied by a thousand. This is a judgement, not a threshold the ABS
 * publishes — it is set where the measured nonsense stops rather than tuned to
 * make a number look right, and it costs 66 of 604 pairs (11%), all of them in
 * Darwin, Hobart and Canberra where the specialist occupations are thinnest.
 *
 * Suppressed, not floored: those pairs return null and vanish from the map and
 * the rankings. Clamping them to a plausible-looking rate would be inventing the
 * figure the whole exercise exists to avoid.
 */
export const MIN_EMPLOYED = 1000;

/**
 * Index into ABS_QUARTERS for the quarter a month belongs to, or -1.
 *
 * The ABS publishes quarterly (mid-quarter Feb/May/Aug/Nov) and the IVI
 * monthly, so a month is resolved to the most recent quarter AT OR BEFORE it —
 * a step, deliberately, rather than interpolation. Employment between two
 * measured quarters is not known, and inventing a smooth path through it would
 * put made-up numbers under every rate in the app.
 */
export function quarterIndexForMonth(month: string): number {
  let found = -1;
  for (let i = 0; i < ABS_QUARTERS.length; i++) {
    if (ABS_QUARTERS[i] <= month) found = i;
    else break;
  }
  // A month before the first published quarter has no denominator. Clamping it
  // to the first quarter would silently date 2006 vacancies against 2006-02
  // employment for months that precede it; -1 lets the caller show nothing.
  return found;
}

/** Employed persons for a skill in a hub (or "national") at a month, or null. */
export function employmentFor(skill: string, hub: string, month: string): number | null {
  const qi = quarterIndexForMonth(month);
  if (qi < 0) return null;
  const series = hub === "national" ? ABS_EMPLOYMENT_NATIONAL[skill] : ABS_EMPLOYMENT[skill]?.[hub];
  const v = series?.[qi];
  // Zero is not a denominator, and neither is a survey cell too small to mean
  // anything — see MIN_EMPLOYED. A skill with no usable employment figure in a
  // territory has no rate, and reporting one would be division by an absence.
  return v && v >= MIN_EMPLOYED ? v : null;
}

/** Internet vacancies for a skill in a hub at a month, or null. */
export function vacanciesFor(skill: string, hub: string, month: string): number | null {
  const mi = IVI_MONTHS.indexOf(month);
  if (mi < 0) return null;
  if (hub === "national") {
    const byHub = IVI_SERIES[skill];
    if (!byHub) return null;
    return Object.values(byHub).reduce((a, arr) => a + (arr[mi] ?? 0), 0);
  }
  return IVI_SERIES[skill]?.[hub]?.[mi] ?? null;
}

/**
 * Vacancies per 1,000 employed for a skill in a hub at a month, or null when
 * either side is missing. Null rather than 0: "no rate could be formed" and
 * "the rate is zero" are different claims and only one of them is measured.
 */
export function vacancyRate(skill: string, hub: string, month: string): number | null {
  const vac = vacanciesFor(skill, hub, month);
  const emp = employmentFor(skill, hub, month);
  if (vac === null || emp === null) return null;
  return (vac / emp) * RATE_BASE;
}

/** The most recent month that has both a vacancy figure and a denominator. */
export function latestRateMonth(): string | null {
  for (let i = IVI_MONTHS.length - 1; i >= 0; i--) {
    if (quarterIndexForMonth(IVI_MONTHS[i]) >= 0) return IVI_MONTHS[i];
  }
  return null;
}

/**
 * How stale the denominator is at a given month, in months.
 *
 * Surfaced rather than hidden because it is never zero except in the mid-quarter
 * months, and at the leading edge it is at its worst: the IVI publishes about a
 * quarter ahead of EQ08, so the newest vacancy figures are divided by employment
 * measured up to five months earlier. That is fine for a stock that moves by a
 * percent or two a year, and it is not fine to leave unsaid.
 */
export function denominatorLagMonths(month: string): number | null {
  const qi = quarterIndexForMonth(month);
  if (qi < 0) return null;
  const [qy, qm] = ABS_QUARTERS[qi].split("-").map(Number);
  const [my, mm] = month.split("-").map(Number);
  return (my - qy) * 12 + (mm - qm);
}

export interface SkillRate {
  skill: string;
  vacancies: number;
  employed: number;
  /** Vacancies per 1,000 employed. */
  rate: number;
}

/**
 * Every skill that has both sides at a month, ranked by rate.
 *
 * Skills missing a denominator are OMITTED rather than ranked last. A skill with
 * no employment figure is unmeasured, and sorting it to the bottom would present
 * an absence as an abundance of labour.
 */
export function rankedByRate(hub: string, month: string): SkillRate[] {
  const out: SkillRate[] = [];
  for (const skill of Object.keys(IVI_SERIES)) {
    const vacancies = vacanciesFor(skill, hub, month);
    const employed = employmentFor(skill, hub, month);
    if (vacancies === null || employed === null) continue;
    out.push({ skill, vacancies, employed, rate: (vacancies / employed) * RATE_BASE });
  }
  return out.sort((a, b) => b.rate - a.rate);
}
