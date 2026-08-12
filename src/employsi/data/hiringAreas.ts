/**
 * Hiring areas: one vocabulary for the company card's "Where they're hiring"
 * bars, mapped from the job boards' own category taxonomies.
 *
 * WHY A MAPPING AT ALL. The archive's `category` column is not one thing.
 * jobArchive types it "job category / posted-via platform" and most feeds mean
 * the second — measured across the live archive, linkedin, jora, indeed, the
 * government boards and two thirds of the career portals store ONE distinct
 * value each (their own name), and simplyhired stores 355, free text like
 * "Full-time, Monday to Friday". Only two AU feeds publish a real taxonomy:
 * Adzuna (55 values) and SEEK (29). Everything else is excluded.
 *
 * WHY NOT JUST MAP SEEK ONTO ADZUNA. They do not nest. SEEK's "Mining,
 * Resources & Energy" — 802 live rows, the largest single category on this
 * roster — has no Adzuna equivalent at all; the closest is "Energy, Oil & Gas",
 * which is not the same thing. Going the other way, SEEK's "Manufacturing,
 * Transport & Logistics" spans two separate Adzuna categories. So the target is
 * a canonical set of its own, and where the two disagree it sits at the COARSER
 * grain, because merging Adzuna's two into SEEK's one is a real loss of detail
 * while splitting SEEK's one into Adzuna's two would be a guess.
 *
 * WHAT IS DROPPED. A source category that is not a functional area — "Unknown",
 * "Other/General", "Part time", "Graduate" — maps to null and the ad is left
 * out of the breakdown rather than bucketed somewhere plausible. The card
 * reports how many ads it could classify, so the shortfall is visible.
 *
 * Adzuna also publishes its French-market categories in French. They are the
 * same categories, so they fold into the same canonical names — otherwise one
 * area arrives as two and splits its own count.
 *
 * Both lists were read off the live archive (`SELECT category, COUNT(*) FROM
 * jobs WHERE source = ? GROUP BY category`) rather than from either board's
 * documentation, so they cover what is actually stored.
 */

/** Feeds whose `category` is a real taxonomy. Everything else stores a platform
 *  name or free text there — see the header. */
export const AREA_SOURCES = new Set(["adzuna", "seek"]);

/**
 * source category (lowercased, trailing "jobs" stripped) → canonical area.
 *
 * A `null` means "recognised, and deliberately not an area". A name missing
 * from the table entirely is also dropped, so a new board category shows up as
 * unclassified rather than as a new bar nobody chose.
 */
const AREA_MAP: Record<string, string | null> = {
  // ── resources ────────────────────────────────────────────────────────────
  "mining, resources & energy": "Mining, Resources & Energy", // seek
  "energy, oil & gas": "Mining, Resources & Energy", // adzuna

  // ── engineering, trades, industry ────────────────────────────────────────
  engineering: "Engineering", // both
  "emplois ingénierie": "Engineering",
  "trades & services": "Trades & Construction", // seek
  construction: "Trades & Construction", // seek
  "trade & construction": "Trades & Construction", // adzuna
  maintenance: "Trades & Construction", // adzuna
  "emplois industrie et construction": "Trades & Construction",
  "emplois maintenance": "Trades & Construction",
  // SEEK bundles manufacturing with transport; Adzuna splits them. The bundle
  // wins — see the header.
  "manufacturing, transport & logistics": "Manufacturing, Transport & Logistics",
  manufacturing: "Manufacturing, Transport & Logistics",
  "logistics & warehouse": "Manufacturing, Transport & Logistics",
  "emplois fabrication": "Manufacturing, Transport & Logistics",
  "emplois distribution et entrepôts": "Manufacturing, Transport & Logistics",

  // ── technology and science ───────────────────────────────────────────────
  "information & communication technology": "Information Technology", // seek
  it: "Information Technology", // adzuna
  "emplois informatique": "Information Technology",
  "science & technology": "Science & Laboratory", // seek
  "scientific & qa": "Science & Laboratory", // adzuna
  "emplois scientifiques et aq": "Science & Laboratory",
  "farming, animals & conservation": "Science & Laboratory", // seek

  // ── health and community ─────────────────────────────────────────────────
  "healthcare & medical": "Healthcare & Medical", // seek
  "healthcare & nursing": "Healthcare & Medical", // adzuna
  "emplois soins de santé et infirmiers": "Healthcare & Medical",
  "community services & development": "Community & Social Services", // seek
  "social work": "Community & Social Services", // adzuna
  "charity & voluntary": "Community & Social Services", // adzuna
  "emplois travail social": "Community & Social Services",

  // ── corporate ────────────────────────────────────────────────────────────
  accounting: "Accounting & Finance", // seek
  "banking & financial services": "Accounting & Finance", // seek
  "insurance & superannuation": "Accounting & Finance", // seek
  "accounting & finance": "Accounting & Finance", // adzuna
  "emplois comptabilité et finance": "Accounting & Finance",
  "administration & office support": "Administration", // seek
  admin: "Administration", // adzuna
  "emplois administration": "Administration",
  "human resources & recruitment": "Human Resources", // seek
  "hr & recruitment": "Human Resources", // adzuna
  "emplois rh et recrutement": "Human Resources",
  "consulting & strategy": "Consulting & Management", // seek
  "ceo & general management": "Consulting & Management", // seek
  consultancy: "Consulting & Management", // adzuna
  "emplois consultants": "Consulting & Management",
  legal: "Legal", // both
  "emplois droit": "Legal",
  "government & defence": "Government & Defence", // seek

  // ── commercial ───────────────────────────────────────────────────────────
  sales: "Sales", // both
  "emplois vente": "Sales",
  "retail & consumer products": "Retail & Consumer", // seek
  retail: "Retail & Consumer", // adzuna
  "emplois commerce détail": "Retail & Consumer",
  "call centre & customer service": "Customer Service", // seek
  "customer services": "Customer Service", // adzuna
  "emplois services client": "Customer Service",
  "marketing & communications": "Marketing & Media", // seek
  "advertising, arts & media": "Marketing & Media", // seek
  "pr, advertising & marketing": "Marketing & Media", // adzuna
  "emplois rp, publicité et marketing": "Marketing & Media",
  "design & architecture": "Design & Creative", // seek
  "creative & design": "Design & Creative", // adzuna
  "emplois création et design": "Design & Creative",
  "real estate & property": "Property", // seek
  property: "Property", // adzuna
  "emplois immobilier": "Property",

  // ── services ─────────────────────────────────────────────────────────────
  "hospitality & tourism": "Hospitality & Tourism", // seek
  "hospitality & catering": "Hospitality & Tourism", // adzuna
  travel: "Hospitality & Tourism", // adzuna
  "emplois hospitalité et restauration": "Hospitality & Tourism",
  "education & training": "Education & Training", // seek
  teaching: "Education & Training", // adzuna
  "emplois enseignement": "Education & Training",
  "domestic help & cleaning": "Cleaning & Facilities", // adzuna
  "emploi aide ménagère et nettoyage": "Cleaning & Facilities",
  "sport & recreation": "Sport & Recreation", // seek

  // ── recognised, and NOT areas ────────────────────────────────────────────
  // A working pattern or a seniority band, not a part of a business. Bucketing
  // these would put "Part time" on a chart of where an employer is hiring.
  unknown: null,
  "other/general": null,
  "part time": null,
  graduate: null,
  "emplois autres/général": null,
  "emplois diplômés": null,
};

/**
 * The canonical hiring area for a board category, or null when the ad should be
 * left out of the breakdown.
 *
 * Callers must check the source is in AREA_SOURCES first — this only knows how
 * to read the two taxonomies, not which feeds publish one.
 */
export function canonicalArea(category: string | null | undefined): string | null {
  const key = String(category || "")
    .replace(/\s*jobs?$/i, "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  return AREA_MAP[key] ?? null;
}
