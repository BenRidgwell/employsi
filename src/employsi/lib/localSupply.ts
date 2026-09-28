import type { Company } from "../data/companies";
import { filedHeadcount } from "./companyCard";
import { AU_RATE_HUBS, employmentFor } from "./vacancyRate";

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
 * The searched skill's employment for a whole city, or null.
 *
 * This is the only skill-aligned employment figure the local layer has, and it
 * exists for the eight Australian capitals and nowhere else. Null here means the
 * banner SAYS so; it is never approximated from a covered city.
 *
 * AU_RATE_HUBS IS THE GATE, NOT A SHORTCUT, and dropping it would print a wrong
 * number rather than none. employmentFor also answers for "singapore", from
 * SingStat M182081 — but that table is EIGHT SSOC MAJOR GROUPS, so it reads
 * 495,500 for Nursing because Nursing, Legal and Software Engineering all share
 * "Professionals" (see the generated file's header). As a rate DENOMINATOR that
 * coarseness is disclosed and survivable, which is what employmentFor was
 * written for. As a headcount printed beside a skill's name it is simply false —
 * Singapore does not employ 495,500 nurses — so this caller takes the
 * occupation-level hubs only.
 */
export function cityEmployment(skill: string | null, city: string, month: string): number | null {
  if (!skill) return null;
  if (!AU_RATE_HUBS.includes(city)) return null;
  return employmentFor(skill, city, month);
}
