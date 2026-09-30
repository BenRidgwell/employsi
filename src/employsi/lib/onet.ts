/**
 * O*NET occupations behind the career card's roles: what a job typically
 * involves and the software it asks for.
 *
 * NOT MEASURED FROM OUR ADS. Everything here is O*NET's description of a US
 * occupation, which a rung was mapped to by hand (scripts/gen-onet-roles.py,
 * the reviewed TABLE). The card shows it as that — named, credited, and apart
 * from the counts, which do come from rows.
 *
 * O*NET is (c) the U.S. Department of Labor, Employment and Training
 * Administration, used under CC BY 4.0. The credit line is a licence
 * condition, not decoration: it must travel with the content.
 */

export interface OnetOccupation {
  title: string;
  /** O*NET job zone, 1-5: how much preparation the occupation needs. */
  zone: number | null;
  /** Core tasks, most important first: [task, importance 1-5]. Importance is
   *  null for the few occupations whose tasks O*NET has not yet rated. */
  tasks: [string, number | null][];
  /** Software O*NET marks "In Demand" for this occupation — frequent in US
   *  job postings for it. Empty for most hands-on and clinical work. */
  software: string[];
}

export interface OnetForRole {
  soc: string;
  occupation: OnetOccupation;
  version: string;
}

/**
 * Job-zone labels, 1-5.
 *
 * NOTHING RENDERS THESE TODAY. The career card's "Job zone 4: Considerable
 * preparation." sentence was removed on 2026-09-30 as clutter. Kept because
 * `zone` is still carried on every occupation by the generator, so the labels
 * are what any future surface for it would need — and because deriving them
 * again from O*NET's documentation is the kind of thing that gets guessed.
 */
export const ONET_ZONE: Record<number, string> = {
  1: "Little or no preparation",
  2: "Some preparation",
  3: "Medium preparation",
  4: "Considerable preparation",
  5: "Extensive preparation",
};

export const onetUrl = (soc: string) => `https://www.onetonline.org/link/summary/${soc}`;

/**
 * The O*NET occupation for a "family|track|rung" id, or null where the rung
 * has none (mixed occupations, or no honest US counterpart). The data file
 * is ~160 KB, so it loads on first use rather than with the card.
 */
export async function onetForRole(id: string): Promise<OnetForRole | null> {
  const { ONET_ROLES, ONET_OCCUPATIONS, ONET_VERSION } = await import("../data/onetRoles");
  const soc = ONET_ROLES[id];
  const occupation = soc ? ONET_OCCUPATIONS[soc] : undefined;
  return soc && occupation ? { soc, occupation, version: ONET_VERSION } : null;
}
