import type { JobsTarget } from "./auJobsTargets";

/**
 * Australian universities, as targets for the jobs pipeline.
 *
 * WHY A THIRD ROSTER FILE. The listed roster (auJobsTargets.ts) is generated
 * from the ASX 200 and universities are not listed; the private roster
 * (topPrivateCompanies.ts) is the AFR Top-150 by revenue and universities are
 * not in it. They are their own category — mostly public statutory bodies — and
 * giving them their own file keeps each source of truth answerable to one thing.
 *
 * PLOTTED ON THE HOME-STATE CAPITAL, which is the convention the private roster
 * already set ("plotted on their home-state capital"). It matters here because
 * many campuses are regional and the map only has anchors for the capitals:
 * James Cook is Townsville, CQUniversity is Rockhampton, Charles Sturt is
 * Bathurst, Federation is Ballarat, Southern Cross is Lismore, UNE is Armidale,
 * Bond and UniSC are on the Gold Coast and Sunshine Coast. Each sits on its
 * state capital rather than nowhere. A university with campuses in several
 * states is placed where it is headquartered, not duplicated.
 *
 * NAMES ARE THE SEARCH TERM, not just a label — every keyword feed searches the
 * roster name, so these are the plain forms ("University of Queensland", not
 * "The University of Queensland"). Where a board advertises under the longer
 * form, advertiser_match.py carries the alias; putting the "The" here instead
 * would make every other feed search for it too.
 *
 * NO HEADLINE FIGURES HERE, deliberately. This file is a jobs TARGET list: it
 * gets these employers searched, so their vacancy counts and skill demand are
 * real and come from rows in the archive. Headcount, salary and turnover for a
 * university are not things this repo has a source for, and the gov rosters
 * already show the right answer to that — adelaideGov.ts zeroes headcount and
 * the financials with "the card shows no fabricated workforce numbers". Adding
 * map cards is a separate step and should follow that, not a hash.
 */

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Stable id for a university. `uni-` keeps them distinct from `priv-`. */
export function universityId(name: string): string {
  return "uni-" + slug(name);
}

/** [name, home-state capital] — the capital, not the campus town; see above. */
const RAW: [name: string, city: string][] = [
  // New South Wales
  ["University of Sydney", "sydney"],
  ["University of New South Wales", "sydney"],
  ["University of Technology Sydney", "sydney"],
  ["Macquarie University", "sydney"],
  ["Western Sydney University", "sydney"],
  ["University of Wollongong", "sydney"],
  ["University of Newcastle", "sydney"],
  ["University of New England", "sydney"],
  ["Charles Sturt University", "sydney"],
  ["Southern Cross University", "sydney"],
  // Headquartered in North Sydney, though it teaches across four states.
  ["Australian Catholic University", "sydney"],
  // Not a university, but it advertises on Uni Roles and is a registered higher
  // education provider — listed so its ads land on a company rather than being
  // dropped by the advertiser gate as an unknown employer.
  ["Nan Tien Institute", "sydney"],

  // Victoria
  ["University of Melbourne", "melbourne"],
  ["Monash University", "melbourne"],
  ["RMIT University", "melbourne"],
  ["Deakin University", "melbourne"],
  ["La Trobe University", "melbourne"],
  ["Swinburne University of Technology", "melbourne"],
  ["Victoria University", "melbourne"],
  ["Federation University Australia", "melbourne"],

  // Queensland
  ["University of Queensland", "brisbane"],
  ["Queensland University of Technology", "brisbane"],
  ["Griffith University", "brisbane"],
  ["James Cook University", "brisbane"],
  ["CQUniversity", "brisbane"],
  ["University of Southern Queensland", "brisbane"],
  ["University of the Sunshine Coast", "brisbane"],
  ["Bond University", "brisbane"],

  // Western Australia
  ["University of Western Australia", "perth"],
  ["Curtin University", "perth"],
  ["Murdoch University", "perth"],
  ["Edith Cowan University", "perth"],
  ["University of Notre Dame Australia", "perth"],

  // South Australia
  ["University of Adelaide", "adelaide"],
  ["University of South Australia", "adelaide"],
  ["Flinders University", "adelaide"],
  ["Torrens University Australia", "adelaide"],

  // Tasmania / ACT / Northern Territory
  ["University of Tasmania", "hobart"],
  ["Australian National University", "canberra"],
  ["University of Canberra", "canberra"],
  ["Charles Darwin University", "darwin"],
];

export const UNIVERSITY_TARGETS: JobsTarget[] = RAW.map(([name, city]) => ({
  id: universityId(name),
  name,
  sector: "Higher education",
  // One of the seven values in SECTOR_GROUPS — universities are public
  // institutions, so they filter with government rather than as their own
  // group. Inventing an eighth group would mean touching the sector filter,
  // the group profiles and every chip label for one category.
  group: "Infrastructure and Government",
  cities: [city],
}));

/** Ids only, for callers that just need membership. */
export const UNIVERSITY_IDS: string[] = UNIVERSITY_TARGETS.map((t) => t.id);
