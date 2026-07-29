import { COMPANIES, SECTOR_GROUPS, companyGroup } from "../data/companies";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { SKILL_CATEGORY } from "../data/skillsTaxonomy";

/**
 * Narrowing "Ask an analyst" to one sector.
 *
 * The catch is that the two datasets behind the analyst express "sector" in
 * completely different terms, so a single filter cannot be applied to both:
 *
 *  • The D1 vacancy archive stores an EMPLOYER against each row (company_id),
 *    and sector is a property of the employer. So a sector filter there is
 *    exact: it is the set of roster companies in that sector. Rows with no
 *    company_id — market-wide board listings we have not attributed to a
 *    tracked employer — are necessarily excluded, because we do not know whose
 *    they are and will not guess.
 *
 *  • The national vacancy series (JSA, StatCan, MBIE, ONS, Eurostat, BLS) are
 *    published per OCCUPATION and area. There is no employer, so there is no
 *    sector. The nearest honest narrowing is to the occupations that sector
 *    hires, which is what SECTOR_SKILL_CATS does — and the answer says so,
 *    because "engineering vacancies" is not the same claim as "vacancies at
 *    mining companies".
 *
 * Categories deliberately overlap: safety and engineering roles genuinely
 * belong to resources, manufacturing and infrastructure alike. Corporate, Admin
 * and the catch-all "Sector" bucket are in NO group — every sector employs
 * accountants, so attributing them to one would overstate it.
 */

export const ALL_SECTORS = "All sectors";

// Sector group → skill-taxonomy categories (see SKILL_CATEGORY).
const SECTOR_SKILL_CATS: Record<string, string[]> = {
  "Energy & Natural Resources": ["Mining", "Energy", "Agriculture", "Engineering", "Safety"],
  "Financial Services": ["Financial"],
  "Technology, Media and Telecommunications": ["Digital", "Creative"],
  "Consumer and Retail": ["Sales", "Hospitality", "Personal", "Cleaning"],
  "Industrial Manufacturing": ["Manufacturing", "Engineering", "Trades", "Safety"],
  "Healthcare and Life Sciences": ["Health", "Care", "Science"],
  "Infrastructure and Government": [
    "Public Sector",
    "Construction",
    "Built Environment",
    "Transport",
    "Property",
    "Community",
    "Education",
    "Safety",
  ],
};

/** The skills a sector hires, for narrowing the national series. Empty = no filter. */
export function skillsForSector(sector: string): Set<string> | undefined {
  const cats = SECTOR_SKILL_CATS[sector];
  if (!cats) return undefined;
  const want = new Set(cats);
  const out = new Set<string>();
  for (const [skill, cat] of Object.entries(SKILL_CATEGORY)) {
    if (want.has(cat)) out.add(skill);
  }
  return out.size ? out : undefined;
}

// Archive company_ids are roster slugs; anything else is rejected before it can
// reach a SQL string. The ids are inlined rather than bound because a sector can
// span several hundred employers and D1 caps bound parameters well below that.
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The roster companies in `sector` that sit inside this scope's hubs.
 *
 * Restricting to the scope first is what keeps the id list small: a city has a
 * few dozen employers in any one sector, not the several hundred a worldwide
 * sector holds. `hubs` empty means Worldwide, where every plotted company
 * qualifies.
 */
export function companyIdsForSector(sector: string, hubs: string[]): string[] {
  if (!sector || sector === ALL_SECTORS) return [];
  const inSector = new Set(COMPANIES.filter((c) => companyGroup(c) === sector).map((c) => c.id));
  if (!inSector.size) return [];
  let ids: string[];
  if (hubs.length) {
    const keys = new Set(hubs.map((h) => h.toLowerCase()));
    const found = new Set<string>();
    for (const [city, list] of Object.entries(CITY_COMPANIES)) {
      if (!keys.has(city.toLowerCase())) continue;
      for (const c of list) if (inSector.has(c.id)) found.add(c.id);
    }
    ids = [...found];
  } else {
    ids = [...inSector];
  }
  return ids.filter((id) => SAFE_ID.test(id));
}

/** Sectors with at least one plotted employer in this scope, in display order. */
export function sectorsInScope(hubs: string[]): string[] {
  return SECTOR_GROUPS.filter((s) => companyIdsForSector(s, hubs).length > 0);
}
