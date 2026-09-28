import type { Company } from "../data/companies";
import { filedHeadcount } from "./companyCard";
import { AU_RATE_HUBS, employmentFor, NZ_SUPPLY_CITIES } from "./vacancyRate";
import { NZ_GROUP_NAME, NZ_SKILL_GROUP, NZ_SUPPLY_YEARS } from "../data/nzOccupationSupply";
import { quarterLabelFor } from "./skillCard";

/**
 * WHAT THE LOCAL LAYER CAN HONESTLY SAY IN SUPPLY MODE.
 *
 * Demand mode colours a company pin by how many of its live ads want the
 * searched skill. Supply mode has no such figure and cannot get one: there is
 * no employees-by-company-by-skill source anywhere in this repo, and the two
 * ways to manufacture one — an industry skill-mix, or the employer's own ad-mix
 * — would both be a formula over a number rather than a row somewhere. The ad
 * mix in particular would put DEMAND data behind a supply figure, which is the
 * exact conflation supply mode exists to avoid.
 *
 * So the two questions are answered at the two grains each actually has:
 *
 *   - How big is this employer?   -> a filed total headcount, all occupations.
 *   - How much of this skill is
 *     employed here?              -> the CITY total, from ABS. See cityEmployment.
 *
 * and the pin never carries the second one. The channels are kept apart
 * deliberately: in demand mode the skill lives in the pin's COLOUR, and supply
 * mode drops that channel entirely rather than repurposing it, so a large pin
 * can only read as "large employer" — which is all we know.
 */
export interface LocalSupply {
  n: number;
  unit: "headcount" | "fte";
  /** Reporting date of the filed figure; "" for a curated record. */
  asof: string;
}

/**
 * A company's total staff, or null when we have not got one.
 *
 * `Company.headcount` IS NOT A MEASUREMENT FOR MOST COMPANIES. `illustrative`
 * records derive it from hash01(ticker + name) — 805 of 1,549 of them, and not
 * merely soft: BWP Trust comes out at 4,226 staff against a real headcount in
 * the low tens (see the field's comment in data/companies.ts). Sizing a pin by
 * that would be sizing it by the company's name. So a filed figure is required,
 * and the curated fallback is allowed only where `illustrative` is unset.
 */
export function localSupplyFor(c: Company): LocalSupply | null {
  const filed = filedHeadcount(c.id);
  if (filed) return { n: filed.now, unit: filed.unit, asof: filed.asof };
  if (!c.illustrative && c.headcount > 0) return { n: c.headcount, unit: "headcount", asof: "" };
  return null;
}

/**
 * The noun for the figure. WGEA and the annual reports file a head count
 * including casuals; ACNC files full-time equivalent. They are different
 * measures of the same workforce, so each pin names the one it carries rather
 * than both hiding under one word.
 */
export function supplyNoun(unit: "headcount" | "fte"): string {
  return unit === "fte" ? "FTE" : "staff";
}

// Pin scale bounds. A pin must stay readable at the small end (it still carries
// a logo and a caption) and must not swallow its neighbours at the large end, so
// the range is deliberately narrow — this encodes rank and rough magnitude, not
// a proportional area you could measure off the screen.
export const SUPPLY_MIN_SCALE = 0.68;
export const SUPPLY_MAX_SCALE = 1.42;

/**
 * Pin scale from a headcount, normalised within the city's own largest employer.
 *
 * SQUARE ROOT, because headcount spans three orders of magnitude inside one city
 * — Perth runs from ~120 to ~35,000 — and a linear scale puts every company
 * except the two biggest at the floor, which reads as "nobody here employs
 * anyone". The root also means the pin's AREA is roughly proportional to the
 * headcount, since scale applies to both dimensions.
 */
export function supplyScale(n: number, max: number): number {
  if (!(max > 0) || !(n > 0)) return SUPPLY_MIN_SCALE;
  const t = Math.min(1, Math.sqrt(n) / Math.sqrt(max));
  return SUPPLY_MIN_SCALE + (SUPPLY_MAX_SCALE - SUPPLY_MIN_SCALE) * t;
}

/**
 * WHAT A CITY'S EMPLOYMENT FIGURE ACTUALLY COUNTS.
 *
 * `label` is the point of this type. Australia's source is ANZSCO UNIT groups,
 * so the figure really is the searched skill and may be shown under its name.
 * New Zealand's finest published occupation grain is ANZSCO SUB-MAJOR, so the
 * figure is every skill in that group at once — 37,644 "Health Professionals" in
 * Auckland is every nurse, doctor, pharmacist, dentist, physiotherapist and
 * radiographer in the region, and printing it beside the word Nursing would be
 * false. So the label travels WITH the number, and the caller renders the label.
 *
 * That is the whole mechanism keeping a coarse source usable: name the group and
 * the figure is true; name the skill and it is not.
 */
export interface CityEmployment {
  n: number;
  /** The name to show. The skill itself only when grain is "occupation". */
  label: string;
  grain: "occupation" | "group";
  /** Reporting period, e.g. "Feb 2026 quarter" or "2023 Census". */
  asof: string;
  source: string;
}

/**
 * The searched skill's employment for a whole city, or null.
 *
 * Two sources, at two grains, and the difference is carried rather than hidden:
 *
 *   · the eight Australian capitals, from ABS EQ08 at unit-group grain -> the
 *     skill's own figure, labelled with the skill;
 *   · Auckland and Wellington, from the 2023 Census at sub-major grain -> the
 *     ANZSCO group's figure, labelled with the group.
 *
 * SINGAPORE IS STILL EXCLUDED, and that is not an oversight. SingStat M182081 is
 * EIGHT SSOC majors — it reads 495,500 for Nursing because Nursing, Legal and
 * Software Engineering share "Professionals". The same group-labelling could in
 * principle rescue it, but eight groups is coarse enough that the label would be
 * doing all the work and the number almost none; NZ's 43 are a different
 * proposition. employmentFor still uses it as a disclosed rate denominator.
 *
 * Everywhere else returns null, and the banner SAYS so rather than reaching for
 * a covered city's figure.
 */
export function cityEmployment(
  skill: string | null,
  city: string,
  month: string,
): CityEmployment | null {
  if (!skill) return null;
  if (AU_RATE_HUBS.includes(city)) {
    const n = employmentFor(skill, city, month);
    return n === null
      ? null
      : { n, label: skill, grain: "occupation", asof: quarterLabelFor(month), source: "ABS" };
  }
  if (NZ_SUPPLY_CITIES.includes(city)) {
    const n = employmentFor(skill, city, month);
    const group = NZ_SKILL_GROUP[skill];
    const label = group ? NZ_GROUP_NAME[group] : null;
    // No label means no group, which means no figure either — but assert it
    // rather than assume, because a figure shown without its group name is the
    // exact thing this type exists to prevent.
    if (n === null || !label) return null;
    return { n, label, grain: "group", asof: nzCensusAsof(month), source: "Stats NZ" };
  }
  return null;
}

/** Which census the figure came from, given the month the timeline is scrubbed to. */
function nzCensusAsof(month: string): string {
  const year = month.slice(0, 4);
  let best = "";
  for (const y of NZ_SUPPLY_YEARS) if (y <= year) best = y;
  return best ? `${best} Census` : "2023 Census";
}
