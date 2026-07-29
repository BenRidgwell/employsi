/**
 * Cities where a roster company runs a substantial office BEYOND its head
 * office, and which city counts as the head office when it does.
 *
 * WHY THIS IS SEPARATE FROM CITY_COMPANIES
 * The multi-city entries already inside CITY_COMPANIES (BHP, Rio Tinto, South32,
 * Santos) carry GEOCODED street addresses — real buildings, verified. This table
 * is deliberately city-level only: it records that a company has a real presence
 * in a city without claiming to know the street. mapboxGeo fans these pins
 * around the city centre the same way the government rosters are placed, so the
 * map never implies a precision the data does not have.
 *
 * WHAT IS IN IT
 * Offices the employer publicly operates and hires from — a state head office, a
 * second corporate centre, a regional headquarters. Not sites, mines, stores or
 * branches: a bank has a branch in every suburb, and plotting those would say
 * nothing about where it employs corporate staff.
 *
 * This is a FIRST TRANCHE covering the Australian majors and the international
 * cases that are unambiguous. It is not exhaustive across all 52 cities, and it
 * is meant to be extended — an entry is a claim about a real employer, so each
 * one should be added because it is known, not because it is plausible.
 */

// company id → cities with a further office. Keys are roster ids; values are
// city keys from CITY_VIEWS.
export const SECONDARY_OFFICES: Record<string, string[]> = {
  // ── Australian banks ──────────────────────────────────────────────────────
  // The four majors each run a second corporate centre in the other's home city
  // and state head offices in the remaining capitals.
  "sydney-cba": ["melbourne", "brisbane", "perth", "adelaide"],
  "sydney-wbc": ["melbourne", "brisbane", "perth", "adelaide"],
  "melbourne-nab": ["sydney", "brisbane", "perth", "adelaide"],
  "melbourne-anz": ["sydney", "brisbane", "perth", "adelaide"],
  // Macquarie is the one Australian financial with genuine offshore corporate
  // centres rather than representative offices.
  "sydney-mqg": ["melbourne", "brisbane", "perth", "london", "newyork", "singapore", "hongkong"],

  // ── Australian telecoms, retail and transport ─────────────────────────────
  "melbourne-tls": ["sydney", "brisbane", "perth", "adelaide", "canberra"],
  "sydney-wow": ["melbourne", "brisbane"],
  "melbourne-col": ["sydney", "brisbane"],
  "sydney-qan": ["melbourne", "brisbane", "perth"],
  wes: ["melbourne", "sydney"], // Wesfarmers — Perth HQ, Bunnings/Kmart in Melbourne

  // ── Australian energy, resources and infrastructure ───────────────────────
  "sydney-org": ["brisbane", "melbourne", "adelaide"],
  "sydney-agl": ["melbourne", "adelaide"],
  "sydney-apa": ["brisbane", "perth"],
  "sydney-ald": ["brisbane"],
  "sydney-whc": ["brisbane"], // Whitehaven — QLD coal operations run from Brisbane
  "melbourne-ori": ["perth", "brisbane"],
  "sydney-llc": ["melbourne", "brisbane"],
  "sydney-dow": ["melbourne", "brisbane", "perth"],
  // Worley is an engineering contractor with delivery centres, not branches, in
  // each of these.
  "sydney-wor": ["perth", "brisbane", "melbourne", "houston", "london"],
  // Woodside's US business is run out of Houston following the BHP Petroleum
  // merger, which brought the Gulf of Mexico assets with it.
  wds: ["houston"],
  // Santos runs its Queensland gas business (GLNG, Cooper Basin east) from
  // Brisbane; it already has geocoded pins in Adelaide and Perth.
  sto: ["brisbane"],

  // ── International ─────────────────────────────────────────────────────────
  // Both supermajors run their American businesses from Houston.
  "london-bp": ["houston"],
  "london-shel": ["houston"],
};

/**
 * Head office, where it is NOT the first city the roster happens to plot.
 *
 * Everything else falls back to the first city in CITY_COMPANIES holding the
 * company, which for single-city companies is the only answer there is. These
 * four are plotted in Perth first because the app grew out of a Perth map, but
 * their registered head offices are elsewhere — and global search is supposed to
 * take you to the head office, so it has to say so.
 */
export const HQ_OVERRIDE: Record<string, string> = {
  bhp: "melbourne", // 171 Collins St — BHP Group's global head office
  sto: "adelaide", // 60 Flinders St — Santos is an Adelaide company
  rio: "melbourne", // 360 Collins St — the principal Australian office (the
  // London line is carried separately as `london-rio`)
};
