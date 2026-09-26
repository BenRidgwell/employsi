// GENERATED — do not edit by hand. Run scripts/gen-acnc-workforce.py.
// Workforce FTE from the ACNC Annual Information Statement register, for
// roster cards that are registered charities and are reached by none of the
// other sources — not listed, not in WGEA, not a public servant.
//
// Matched by ABN ONLY. A name search over 54,000 charities offers a real
// staff count for the wrong organisation every time, so every entry in the
// generator is one ABN that was looked up and read, and the load fails if
// that ABN's registered name ever changes.
//
// `asof` is each charity's OWN reporting period end, never the dataset year:
// the 2024 file holds a year to 30 June for one of these and a year to
// 31 December for the other.
//
// FTE, because the register states it. Its three head-count columns would
// have to be summed here, and a sum of this script is not a figure the
// charity reported.
import type { Headcount } from "./companyHeadcount";
export const ACNC_HEADCOUNT: Record<string, Headcount> = {
  "nsw-gov-legal-aid-nsw": { now: 1642.01, prev: 1463.6, yoy: 12.2, asof: "Jun 2024", span: 1, unit: "fte" },
  "uni-nan-tien-institute": { now: 16.0, prev: 13.39, yoy: 19.5, asof: "Dec 2024", span: 1, unit: "fte" },
};
