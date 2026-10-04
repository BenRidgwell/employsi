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
import { SG_GROUP_EMPLOYMENT, SG_SKILL_GROUP, SG_SUPPLY_YEARS } from "../data/sgOccupationSupply";
import {
  NZ_GROUP_EMPLOYMENT,
  NZ_MIN_EMPLOYED,
  NZ_SKILL_GROUP,
  NZ_SUPPLY_YEARS,
} from "../data/nzOccupationSupply";
import { SG_SERIES } from "../data/sgVacancyDemand";

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

export type RateGranularity = "occupation" | "occupation-group";

/**
 * How precisely a hub's denominator is measured. The two are NOT the same claim
 * and the UI should say which it is showing.
 *
 *   occupation        Australia. ABS EQ08, 478 ANZSCO unit groups — a skill
 *                     divides by the people doing that specific work.
 *   occupation-group  Singapore. SingStat M182081, 8 SSOC major groups — a
 *                     skill divides by its whole major group, so Software
 *                     Engineering and Medical Practice share one denominator.
 *
 * The Singapore reweighting is real ACROSS groups (Craftsmen ~52k against
 * Service & Sales ~247k is a four-fold correction) and absent WITHIN them,
 * where two skills keep the order their vacancy counts already gave them.
 */
export function rateGranularity(hub: string): RateGranularity | null {
  if (hub === "singapore") return "occupation-group";
  return "occupation";
}

/**
 * Singapore employment for a skill at a month, or null.
 *
 * The source is ANNUAL and newest-first, and the month steps back to the most
 * recent year AT OR BEFORE it — the same rule Australia's quarters use, for the
 * same reason: nothing is interpolated.
 *
 * Matching the year EXACTLY was the first version and it returned null for
 * every current month. SingStat's latest is 2025 and the vacancy series runs to
 * 2026-05, so exact matching silently produced no Singapore rate at all — a
 * feature that looks simply absent rather than broken. The cost of stepping is
 * that the newest months divide by employment up to eighteen months old; that
 * is a real lag on a stock that moves a percent or two a year, and it is worth
 * naming rather than hiding. A month BEFORE the first published year still
 * returns null, because there is nothing to step back to.
 */
function sgEmploymentFor(skill: string, month: string): number | null {
  const group = SG_SKILL_GROUP[skill];
  if (!group) return null;
  const year = month.slice(0, 4);
  // Newest-first, so the first entry at or before the month is the one wanted.
  const yi = SG_SUPPLY_YEARS.findIndex((y) => y <= year);
  if (yi < 0) return null;
  const v = SG_GROUP_EMPLOYMENT[group]?.[yi];
  // null is 'na' in the source — not measured, which must never become a zero
  // denominator. See the generated file's header.
  return typeof v === "number" && v >= MIN_EMPLOYED ? v : null;
}

/**
 * New Zealand employment for a skill in a city at a month, or null.
 *
 * Census years, so the month steps back to the most recent census AT OR BEFORE
 * it — the same rule as Australia's quarters and Singapore's years. The steps
 * are FIVE YEARS wide, which is the real cost: a month in 2027 divides by 2023.
 * That is named in the generated file's header and it is why New Zealand gets a
 * level and not a trend.
 *
 * NZ_SKILL_GROUP resolves a skill to an ANZSCO SUB-MAJOR group, so the figure is
 * every skill in that group at once. As a rate denominator that coarseness
 * behaves exactly as Singapore's does — real across groups, absent within them.
 * As a number printed beside a skill's name it would be false, which is why
 * cityEmployment in lib/localSupply.ts reads NZ through its own path and carries
 * the GROUP NAME out with the figure.
 */
function nzEmploymentFor(skill: string, city: string, month: string): number | null {
  const group = NZ_SKILL_GROUP[skill];
  if (!group) return null;
  const year = month.slice(0, 4);
  // Oldest-first here, unlike Singapore's table: walk forward and keep the last
  // census at or before the month.
  let yi = -1;
  for (let i = 0; i < NZ_SUPPLY_YEARS.length; i++) if (NZ_SUPPLY_YEARS[i] <= year) yi = i;
  if (yi < 0) return null;
  const v = NZ_GROUP_EMPLOYMENT[group]?.[city]?.[yi];
  return typeof v === "number" && v >= NZ_MIN_EMPLOYED ? v : null;
}

/** The NZ cities the census tables cover. */
export const NZ_SUPPLY_CITIES = ["auckland", "wellington"];

/** Employed persons for a skill in a hub (or "national") at a month, or null. */
export function employmentFor(skill: string, hub: string, month: string): number | null {
  if (NZ_SUPPLY_CITIES.includes(hub)) return nzEmploymentFor(skill, hub, month);
  if (hub === "singapore") return sgEmploymentFor(skill, month);
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
  // Singapore's vacancies are their own series (MRSD), not the Australian IVI.
  // Reading IVI_SERIES for the singapore hub returns undefined, so the rate
  // would never form and the whole feature would look simply absent — the
  // quietest possible way for this to be broken.
  if (hub === "singapore") return SG_SERIES[skill]?.singapore?.[mi] ?? null;
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

/**
 * Every skill with an employment figure at a month, ranked by how many people
 * do the work — the SUPPLY side read as a level rather than as a denominator.
 *
 * This is the same ABS stock `vacancyRate` divides by, asked the other question:
 * not "how tight is this labour" but "how many people are in it". The supply
 * side of the app ranks on this, because a reader looking at the workforce wants
 * the big occupations first, which is the ordering a vacancy count actively
 * fights — see the note at the top of this file for why the two disagree.
 *
 * MIN_EMPLOYED applies here too, for the same reason: a cell below the
 * thousand-person unit the survey is denominated in is sampling noise, and a
 * noisy cell ranked among real ones is worse in a list than in a ratio, because
 * a list makes it look chosen.
 */
export function rankedByEmployment(
  hub: string,
  month: string,
): { skill: string; employed: number }[] {
  const out: { skill: string; employed: number }[] = [];
  for (const skill of Object.keys(IVI_SERIES)) {
    const employed = employmentFor(skill, hub, month);
    if (employed === null) continue;
    out.push({ skill, employed });
  }
  return out.sort((a, b) => b.employed - a.employed);
}

/**
 * The hubs ABS EQ08 covers: the eight Australian capitals, one per state and
 * territory. Exported because the supply-side map has to iterate the cities it
 * CAN answer for rather than asking every hub and discarding nulls — the
 * difference matters when the alternative is a fallback that would quietly
 * light a non-AU city from the vacancy series instead.
 */
export const AU_RATE_HUBS: string[] = [
  "sydney",
  "melbourne",
  "brisbane",
  "perth",
  "adelaide",
  "canberra",
  "hobart",
  "darwin",
];
