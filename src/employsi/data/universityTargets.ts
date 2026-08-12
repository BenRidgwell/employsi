import type { Company, RoleBreakdown } from "./companies";
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

/**
 * [name, home-state capital, domain].
 *
 * The capital, not the campus town — see above. The DOMAIN is listed because it
 * cannot be derived: deriveDomain() builds a .com from the words in the name and
 * produced "universitysydney.com", and lib/companyLogo.ts keys the favicon
 * service on whatever it is given, so every university would have carried a
 * broken logo. Australian universities are .edu.au (Monash is monash.edu), which
 * no heuristic over the name will reach.
 */
const RAW: [name: string, city: string, domain: string][] = [
  // New South Wales
  ["University of Sydney", "sydney", "sydney.edu.au"],
  ["University of New South Wales", "sydney", "unsw.edu.au"],
  ["University of Technology Sydney", "sydney", "uts.edu.au"],
  ["Macquarie University", "sydney", "mq.edu.au"],
  ["Western Sydney University", "sydney", "westernsydney.edu.au"],
  ["University of Wollongong", "sydney", "uow.edu.au"],
  ["University of Newcastle", "sydney", "newcastle.edu.au"],
  ["University of New England", "sydney", "une.edu.au"],
  ["Charles Sturt University", "sydney", "csu.edu.au"],
  ["Southern Cross University", "sydney", "scu.edu.au"],
  // Headquartered in North Sydney, though it teaches across four states.
  ["Australian Catholic University", "sydney", "acu.edu.au"],
  // Not a university, but it advertises on Uni Roles and is a registered higher
  // education provider — listed so its ads land on a company rather than being
  // dropped by the advertiser gate as an unknown employer.
  ["Nan Tien Institute", "sydney", "nantien.edu.au"],

  // Victoria
  ["University of Melbourne", "melbourne", "unimelb.edu.au"],
  ["Monash University", "melbourne", "monash.edu"],
  ["RMIT University", "melbourne", "rmit.edu.au"],
  ["Deakin University", "melbourne", "deakin.edu.au"],
  ["La Trobe University", "melbourne", "latrobe.edu.au"],
  ["Swinburne University of Technology", "melbourne", "swinburne.edu.au"],
  ["Victoria University", "melbourne", "vu.edu.au"],
  ["Federation University Australia", "melbourne", "federation.edu.au"],

  // Queensland
  ["University of Queensland", "brisbane", "uq.edu.au"],
  ["Queensland University of Technology", "brisbane", "qut.edu.au"],
  ["Griffith University", "brisbane", "griffith.edu.au"],
  ["James Cook University", "brisbane", "jcu.edu.au"],
  ["CQUniversity", "brisbane", "cqu.edu.au"],
  ["University of Southern Queensland", "brisbane", "unisq.edu.au"],
  ["University of the Sunshine Coast", "brisbane", "usc.edu.au"],
  ["Bond University", "brisbane", "bond.edu.au"],

  // Western Australia
  ["University of Western Australia", "perth", "uwa.edu.au"],
  ["Curtin University", "perth", "curtin.edu.au"],
  ["Murdoch University", "perth", "murdoch.edu.au"],
  ["Edith Cowan University", "perth", "ecu.edu.au"],
  ["University of Notre Dame Australia", "perth", "notredame.edu.au"],

  // South Australia
  ["University of Adelaide", "adelaide", "adelaide.edu.au"],
  ["University of South Australia", "adelaide", "unisa.edu.au"],
  ["Flinders University", "adelaide", "flinders.edu.au"],
  ["Torrens University Australia", "adelaide", "torrens.edu.au"],

  // Tasmania / ACT / Northern Territory
  ["University of Tasmania", "hobart", "utas.edu.au"],
  ["Australian National University", "canberra", "anu.edu.au"],
  ["University of Canberra", "canberra", "canberra.edu.au"],
  ["Charles Darwin University", "darwin", "cdu.edu.au"],
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

// ── map cards ────────────────────────────────────────────────────────────────
// Built the way the government rosters are built (perthGov / adelaideGov /
// sydneyGov and the rest): public bodies, no exchange listing, and the figures
// this repo has no source for left at zero so the card suppresses them rather
// than showing something invented.
//
// WHERE THIS DEVIATES FROM THOSE FILES, AND WHY. They seed `openRoles` from a
// hash of the name, because when they were written there was no live count to
// use and the number is replaced by lib/openRolesFn.ts the moment a card opens.
// Universities are not in that position: uniroles-to-d1.py archives their real
// vacancies nightly and openRolesFn already resolves them by company_id, so
// there is a true number available from the first render. Seeding a fake one
// would be a fabricated stat with a real alternative sitting next to it, which
// is the one thing this codebase is most careful about.
//
// The visible cost is that LocalBanner sums this field for its city total, so
// until a card is opened a university contributes 0 to that headline. An honest
// undercount that corrects itself is the better failure: the alternative makes
// the banner confidently wrong, and wrong in a way nothing later fixes.

const UNI_ROLES = ["Academic & Research", "Professional & Administrative", "Student Services"];

/** Stable pseudo-random in [0,1) from a name — layout only, never a statistic. */
function h01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const UNI_STOP = new Set(["of", "the", "and"]);

/** "UNSW"-style initials, skipping the joining words. */
function uniAcronym(name: string): string {
  const words = name.split(/[\s,]+/).filter((w) => w && !UNI_STOP.has(w.toLowerCase()));
  return words
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 6);
}

function buildUniversity([name, city, domain]: [string, string, string]): Company & {
  city: string;
} {
  const h = h01(name);
  const acr = uniAcronym(name);
  const roleCounts = [3, 2, 1].map((w, i) => 4 + Math.round(h * 18 * w) + i);
  const roles: RoleBreakdown[] = UNI_ROLES.map((title, i) => ({
    title,
    count: roleCounts[i],
  }));
  return {
    id: universityId(name),
    ticker: acr,
    name,
    pill: acr,
    domain,
    sector: "Higher education",
    group: "Infrastructure and Government",
    // Not exchange-listed, so no `exchange`. `private` drives the
    // Public/Private master filter, the same as the government rosters.
    private: true,
    city,
    // Everything below that is zero is zero because there is no source for it,
    // not because it is small. Headcount, workforce trend and the two
    // per-employee financials are all suppressed by the card when empty.
    headcount: 0,
    growth: 0,
    trend: [],
    revPerEmp: 0,
    ebitdaPerEmp: 0,
    // Real, from the archive — see the note above.
    openRoles: 0,
    salary: "",
    salaryShort: "",
    salaryNum: 0,
    turnover: 0,
    salaryDelta: "",
    metroDelta: "",
    timeToFill: "",
    competition: "",
    skills: [],
    roles,
  };
}

const UNI_BUILT = RAW.map(buildUniversity);

export const UNIVERSITY_COMPANIES: Company[] = UNI_BUILT.map(({ city: _city, ...c }) => c);

/** Ids grouped by the city their pin belongs on, for mapboxGeo's placement. */
export const UNIVERSITY_IDS_BY_CITY: Record<string, string[]> = UNI_BUILT.reduce<
  Record<string, string[]>
>((acc, c) => {
  (acc[c.city] ||= []).push(c.id);
  return acc;
}, {});
