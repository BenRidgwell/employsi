/**
 * Which ladders an EMPLOYER is known to run — the employer half of career
 * placement (see careerLadder.ts, `employerMatch`).
 *
 * WHY THIS EXISTS. A supermarket advertises "Team Member" and "Customer Service
 * Manager" with no retail word in the title — the employer is the only thing
 * that says it is a store role. Read from the title alone, those roles were
 * unplaced, and "Sales Consultant" at Harvey Norman landed on the B2B sales
 * ladder.
 *
 * WHY NOT THE SECTOR FIELD. The roster's "Consumer & Retail" sector holds 133
 * employers, and Coles and Woolworths share it with Qantas, Diageo, British
 * American Tobacco, casinos and hotel groups (measured 2026-09-24). Hinting on
 * it would make a Qantas "Customer Service Manager" a store rung. So the set is:
 *
 *   - every employer whose OWN sector names retail, supermarkets or grocery —
 *     except car dealerships, whose "Sales Consultant" is car sales, and
 *     consumer finance, which is not a shop at all;
 *   - plus the store operators hand-picked out of "Consumer & Retail" below.
 *
 * An id that stops resolving (a roster rename) would silently drop a retailer,
 * so scripts/check-career-ladder.ts asserts every one exists.
 *
 * Only rows with a company_id benefit. Board rows attributed by name text alone
 * carry no id, and matching them to one here would be a guess.
 */
import { COMPANIES } from "../data/companies";

/** Sectors that name a store business outright. */
const RETAIL_SECTOR = /retail|supermarket|grocer/i;
/** …except these, which use the word for something else. */
const NOT_STORE_RETAIL = /automotive|finance/i;
/**
 * The mixed sector. Its NAME contains "Retail", so RETAIL_SECTOR alone admits
 * all 133 members — airlines and tobacco included. That was the first draft of
 * this file, caught by the fixture asserting no member arrives this way.
 */
const MIXED_SECTOR = "Consumer & Retail";

/**
 * Store operators from the mixed "Consumer & Retail" sector. Brand owners that
 * also run shops (Nike, LVMH, Kering) are left out on purpose: their
 * store ads already say "store", and most of their ads are head office.
 */
export const CURATED_RETAILERS: Record<string, string> = {
  "melbourne-col": "Coles Group",
  "sydney-wow": "Woolworths Group",
  "melbourne-jbh": "JB Hi-Fi",
  "melbourne-lov": "Lovisa",
  "melbourne-pmv": "Premier Investments",
  "sydney-hvn": "Harvey Norman",
  "brisbane-sul": "Super Retail Group",
  // Dan Murphy's and BWS. Also ALH pubs — which is why "Duty Manager", the
  // pub and hotel title, is NOT in retail's employerMatch.
  "sydney-edv": "Endeavour Group",
  "seattle-cost": "Costco",
  "seattle-jwn": "Nordstrom",
  "singapore-ov8": "Sheng Siong Group",
  "tokyo-9983": "Fast Retailing",
  "tokyo-3382": "Seven & i Holdings",
  "london-tsco": "Tesco",
  "sanfrancisco-gap": "Gap Inc.",
  "sanfrancisco-wsm": "Williams-Sonoma",
  "montreal-atd": "Alimentation Couche-Tard",
  "montreal-dol": "Dollarama",
  "vancouver-lulu": "Lululemon Athletica",
  "dubai-spinneys": "Spinneys",
  "johannesburg-whl": "Woolworths Holdings",
  "johannesburg-shp": "Shoprite Holdings",
  "johannesburg-cls": "Clicks Group",
  "johannesburg-mrp": "Mr Price Group",
  "johannesburg-tfg": "The Foschini Group",
  "atlanta-hd": "The Home Depot",
  "bentonville-wmt": "Walmart",
  "charlotte-low": "Lowe's",
  "minneapolis-tgt": "Target",
  "cincinnati-kr": "Kroger",
  "boston-tjx": "The TJX Companies",
  "paris-ca": "Carrefour",
  "hongkong-01929": "Chow Tai Fook Jewellery",
  "beijing-09992": "Pop Mart",
};

export const RETAIL_EMPLOYERS: ReadonlySet<string> = new Set([
  // Wesfarmers ("Diversified Retail") is Bunnings, Kmart and Officeworks, and
  // also a chemicals and lithium business. Its plant roles are kept out by
  // retail's `exclude` (production, plant and process operators), not here.
  ...COMPANIES.filter(
    (c) =>
      c.sector !== MIXED_SECTOR && RETAIL_SECTOR.test(c.sector) && !NOT_STORE_RETAIL.test(c.sector),
  ).map((c) => c.id),
  ...Object.keys(CURATED_RETAILERS),
]);

const NONE: ReadonlySet<string> = new Set();
const RETAIL: ReadonlySet<string> = new Set(["retail"]);

/** The ladder families this employer is known to run, for placeTitle's ctx. */
export function employerFamilies(companyId: string | null | undefined): ReadonlySet<string> {
  return companyId && RETAIL_EMPLOYERS.has(companyId) ? RETAIL : NONE;
}
