/**
 * Employer career-portal feeds.
 *
 * Companies advertise on their own portals as well as on the job boards we
 * already pull, and the portal is the authoritative list — it carries roles
 * that never reach an aggregator. This module fetches those portals directly
 * and hands the rows to the same archive/dedup/skills path everything else
 * uses, so a role advertised on both a portal and Adzuna is counted once.
 *
 * Ten platforms are covered. Each was reverse-engineered against the live
 * site before being written here, and the contract is recorded next to its
 * fetcher so a future breakage is traceable to a named assumption rather than
 * showing up as a silent zero:
 *
 *   - **SAP SuccessFactors** (BHP, Woodside, ANZ). Server-rendered
 *     `/search/?q=&startrow=N`. Ships in TWO themes and we see both: BHP and
 *     ANZ render `<tr class="data-row">`, Woodside renders tiles
 *     (`<div class="job-tile-cell">`) whose fields are
 *     `id="job-<id>-desktop-section-<field>-value"` divs. Both carry the same
 *     `jobTitle-link` anchor, so the parser splits on whichever wrapper the
 *     page uses. Page size differs per tenant (BHP/Woodside 25, ANZ 100), so
 *     it is read off the first page rather than assumed.
 *   - **Workday** (CBA). POST `/wday/cxs/<tenant>/<site>/jobs` with
 *     `{appliedFacets,limit,offset,searchText}` → `jobPostings`.
 *   - **Eightfold AI** (HSBC). GET `/api/apply/v2/jobs?domain=<d>&start=N&num=`
 *     → `{positions,count}`. `num` is accepted and ignored — the API hands back
 *     10 a page whatever you ask for — so the page size is pinned at 10.
 *   - **Symphony Talent / SmashFly** (Rio Tinto). jobs.riotinto.com is a
 *     WordPress shell; the jobs come from `jobsapi-google.m-cloud.io/api/
 *     job/search?companyName=companies/<uuid>`, the org id and host both read
 *     out of the page's `cws_opts`. Returns `{totalHits,searchResults[].job}`.
 *   - **Oracle Recruiting Cloud** (Westpac). GET
 *     `/hcmRestApi/resources/latest/recruitingCEJobRequisitions` with the
 *     `finder=findReqs;siteNumber=CX_1,limit=,offset=` finder syntax →
 *     `items[0].requisitionList` plus a `TotalJobsCount`.
 *   - **LiveHire** (Wesfarmers). Two steps: GET an anonymous bearer from
 *     `/api/jobsapi/careers/auth/token/<segment>`, then POST
 *     `/careers-api/search/<segment>/<page>/<size>`.
 *   - **Greenhouse** (Goodman). The public board API,
 *     `boards-api.greenhouse.io/v1/boards/<token>/jobs` — one call, no paging.
 *   - **Avature** (Macquarie). Server-rendered
 *     `/en_US/careers/SearchJobs/?jobOffset=N`. Page size is fixed at 9 by the
 *     tenant — `jobRecordsPerPage` is accepted and ignored — so the offset
 *     steps by 9.
 *   - **Next.js data island** (Fortescue). careers.fortescue.com is a client
 *     app, but its `__NEXT_DATA__` already carries the whole list under
 *     `componentProps.<uuid>.fetchedJobs`, so no API hunt is needed.
 *   - **CSL's own board** (CSL). jobs.csl.com is bespoke Tailwind markup, one
 *     `<a class="block hover:bg-gray-50 group">` a role, 25 to a `?page=N`.
 *
 * NOT covered here, and why:
 *   - NAB (careers.nab.com.au, Clinch). Its AWS WAF returns an empty shell to a
 *     Cloudflare Worker — measured: zero roles while every other site in the
 *     same tick returned hundreds. It needs a rendered fetch with a wait for
 *     the challenge to settle, so it runs as a GitHub Action through Oxylabs
 *     instead: scripts/nab-to-d1.py, writing the same `portal-cl` rows into the
 *     same archive.
 *   - Jora: 403s a plain request; it needs the Oxylabs path the Indeed and
 *     JobsDB scrapers use, which runs as a GitHub Action rather than in the
 *     Worker (datacentre IPs are blocked).
 */

import { skillsForText } from "../../src/employsi/data/skillsTaxonomy";
import type { ArchiveRow } from "../../src/employsi/lib/jobArchive";

export interface PortalJob {
  t: string;
  loc: string;
  cat: string;
  url: string;
  created: string;
  city: string | null;
  skills: string[];
}

type Platform =
  | "successfactors"
  | "workday"
  | "eightfold"
  | "symphony"
  | "oracle"
  | "livehire"
  | "greenhouse"
  | "avature"
  | "nextdata"
  | "phenom"
  | "csl";

interface SiteDef {
  /** App company id — what the archive rows are attributed to. */
  id: string;
  /**
   * Unique key for this FEED, where one employer runs more than one portal.
   * Defaults to `id`. Transurban runs separate Workday sites for its Australian
   * and North American roads: both belong to the one roster company, so they
   * share an id, but they need distinct keys or the second one's KV snapshot
   * overwrites the first and the card shows only half the group.
   */
  key?: string;
  name: string;
  /** The employer's industry, passed to the skills matcher so seniority words
   *  like "Principal" aren't read as their literal job title. */
  sector: string;
  platform: Platform;
  /** The platform's entry point. See each fetcher for what it expects. */
  endpoint: string;
  /** Origin used to absolutise a job's relative path. */
  origin: string;
  /** Default hub when a role's location text matches no known city. */
  homeHub: string | null;
  /** Hard ceiling on pages, so a paging bug can't run away with the budget. */
  maxPages?: number;
  /** Rows a page, where the tenant fixes it at something other than the
   *  platform default. Avature tenants differ: Macquarie serves 9, Woolworths 6, and
   *  both ignore a larger jobRecordsPerPage — so it has to be per site. */
  pageSize?: number;
}

export const SITES: SiteDef[] = [
  {
    id: "bhp",
    name: "BHP",
    sector: "Iron Ore & Metals",
    platform: "successfactors",
    endpoint: "https://careers.bhp.com",
    origin: "https://careers.bhp.com",
    homeHub: "perth",
  },
  {
    id: "wds",
    name: "Woodside Energy",
    sector: "Oil & Gas",
    platform: "successfactors",
    endpoint: "https://careers.woodside.com.au",
    origin: "https://careers.woodside.com.au",
    homeHub: "perth",
  },
  {
    id: "cba",
    name: "Commonwealth Bank",
    sector: "Banking & Financial Services",
    platform: "workday",
    endpoint: "https://cba.wd3.myworkdayjobs.com/wday/cxs/cba/CommBank_Careers/jobs",
    origin: "https://cba.wd3.myworkdayjobs.com/en-US/CommBank_Careers",
    homeHub: "sydney",
  },
  {
    id: "melbourne-anz",
    name: "ANZ Group Holdings",
    sector: "Financial Services",
    platform: "successfactors",
    endpoint: "https://careers.anz.com",
    origin: "https://careers.anz.com",
    homeHub: "melbourne",
  },
  {
    id: "rio",
    name: "Rio Tinto",
    sector: "Iron Ore & Metals",
    // companyName is the org id out of the site's own cws_opts config.
    endpoint:
      "https://jobsapi-google.m-cloud.io/api/job/search?companyName=companies%2Fde826bcc-d0cf-4689-9fc1-c1d9b100d59c",
    platform: "symphony",
    origin: "https://jobs.riotinto.com",
    homeHub: "perth",
  },
  {
    id: "fmg",
    name: "Fortescue",
    sector: "Iron Ore & Green Energy",
    platform: "nextdata",
    endpoint: "https://careers.fortescue.com/en/jobs",
    origin: "https://careers.fortescue.com",
    homeHub: "perth",
  },
  {
    id: "sydney-wbc",
    name: "Westpac Banking Corporation",
    sector: "Financial Services",
    platform: "oracle",
    endpoint: "https://ebuu.fa.ap1.oraclecloud.com",
    origin: "https://ebuu.fa.ap1.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX",
    homeHub: "sydney",
  },
  {
    id: "wes",
    name: "Wesfarmers",
    sector: "Diversified Retail",
    // The LiveHire segment code; both the token and the search hang off it.
    platform: "livehire",
    endpoint: "wesfarmerscorporate",
    origin: "https://www.livehire.com",
    homeHub: "perth",
  },
  {
    id: "sydney-mqg",
    name: "Macquarie Group",
    sector: "Financial Services",
    platform: "avature",
    endpoint: "https://recruitment.macquarie.com/en_US/careers/SearchJobs",
    origin: "https://recruitment.macquarie.com",
    homeHub: "sydney",
  },
  {
    id: "sydney-gmg",
    name: "Goodman Group",
    sector: "Financial Services",
    platform: "greenhouse",
    endpoint: "https://boards-api.greenhouse.io/v1/boards/goodman/jobs",
    origin: "https://ce.goodman.com/about-goodman/careers/job-vacancies",
    homeHub: "sydney",
  },
  {
    id: "melbourne-csl",
    name: "CSL Limited",
    sector: "Healthcare and Life Sciences",
    platform: "csl",
    endpoint: "https://jobs.csl.com/en/jobs",
    origin: "https://jobs.csl.com",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-tls",
    name: "Telstra Group",
    sector: "Technology, Media & Telecom",
    platform: "workday",
    endpoint: "https://telstra.wd3.myworkdayjobs.com/wday/cxs/telstra/Telstra_Careers/jobs",
    origin: "https://telstra.wd3.myworkdayjobs.com/Telstra_Careers",
    homeHub: "melbourne",
  },
  {
    id: "melbourne-tcl",
    key: "melbourne-tcl-au",
    name: "Transurban Group",
    sector: "Infrastructure & Government",
    platform: "workday",
    endpoint: "https://transurban.wd3.myworkdayjobs.com/wday/cxs/transurban/TU_AU/jobs",
    origin: "https://transurban.wd3.myworkdayjobs.com/TU_AU",
    homeHub: "melbourne",
  },
  {
    // Transurban runs a SECOND Workday site for its North American roads, on
    // the same tenant. Both are archived against the one roster company — it is
    // one employer — but the US site's roles carry US locations, so they land
    // on the US hubs rather than Melbourne and the card shows the whole group.
    id: "melbourne-tcl",
    key: "melbourne-tcl-us",
    name: "Transurban Group",
    sector: "Infrastructure & Government",
    platform: "workday",
    endpoint: "https://transurban.wd3.myworkdayjobs.com/wday/cxs/transurban/TU_US/jobs",
    origin: "https://transurban.wd3.myworkdayjobs.com/TU_US",
    homeHub: "washington",
  },
  {
    id: "sydney-all",
    name: "Aristocrat Leisure",
    sector: "Consumer & Retail",
    platform: "workday",
    endpoint:
      "https://aristocrat.wd3.myworkdayjobs.com/wday/cxs/aristocrat/AristocratExternalCareersSite/jobs",
    origin: "https://aristocrat.wd3.myworkdayjobs.com/AristocratExternalCareersSite",
    homeHub: "sydney",
  },
  {
    // QBE's site is live and correctly identified — every other site id 404s
    // and the page's own shell names this one — but it returned 0 postings when
    // this was wired. It is included so the moment they publish, the roles are
    // collected; until then it legitimately writes nothing.
    id: "sydney-qbe",
    name: "QBE Insurance",
    sector: "Financial Services",
    platform: "workday",
    endpoint: "https://qbe.wd3.myworkdayjobs.com/wday/cxs/qbe/QBE-Careers/jobs",
    origin: "https://qbe.wd3.myworkdayjobs.com/QBE-Careers",
    homeHub: "sydney",
  },
  {
    // Avature, like Macquarie, but this tenant fixes the page at 6 and needs
    // jobRecordsPerPage alongside jobOffset — without it the offset is ignored
    // and every page returns the first six.
    id: "sydney-wow",
    name: "Woolworths Group",
    sector: "Consumer & Retail",
    platform: "avature",
    endpoint: "https://careers.woolworthsgroup.com.au/en_GB/apply/search-jobs",
    origin: "https://careers.woolworthsgroup.com.au",
    homeHub: "sydney",
    pageSize: 6,
  },
  {
    id: "melbourne-col",
    name: "Coles Group",
    sector: "Consumer & Retail",
    platform: "phenom",
    endpoint: "https://colescareers.com.au/au/en/search-results",
    origin: "https://colescareers.com.au",
    homeHub: "melbourne",
  },
  {
    // HSBC's portal is global and the roster carries the issuer twice (LSE and
    // HKEX). It is archived once, against the primary listing; the Hong Kong
    // line reads the same rows through COMPANY_ID_ALIAS in openRolesFn, so the
    // roles are shown on both cards without being counted twice.
    id: "london-hsba",
    name: "HSBC Holdings",
    sector: "Financial Services",
    platform: "eightfold",
    endpoint: "https://portal.careers.hsbc.com/api/apply/v2/jobs?domain=hsbc.com",
    origin: "https://portal.careers.hsbc.com",
    homeHub: "london",
  },
];

/**
 * Which nightly tick fetches which sites.
 *
 * Sized by how deep each portal pages, not by how many there are. The binding
 * constraint is wall time, not subrequests: several of these hand back 9-25
 * roles a request over hundreds of roles (HSBC ~1,500 at 10 a page, Macquarie
 * ~500 at 9, CSL ~1,300 at 25). Walked one page at a time in a single
 * invocation that overruns the waitUntil budget and the remaining sites are
 * cancelled with no error — which is exactly what a first run here did. Pages
 * are now fetched in parallel windows (see pagedParallel) AND the sites split
 * four ways, so no tick depends on the budget being generous.
 */
export const PORTAL_GROUPS: string[][] = [
  ["bhp", "wds", "cba", "melbourne-anz"],
  ["rio", "fmg", "sydney-wbc", "wes"],
  ["sydney-mqg", "sydney-gmg"],
  ["london-hsba", "melbourne-csl"],
  // The seven added later. Grouped by how deep each pages rather than evenly:
  // Coles walks 531 roles at 10 a page and Woolworths at 6, so each of those
  // gets a tick largely to itself, while the Workday sites (which serve 20 a
  // page and total a few hundred between them) share one.
  ["melbourne-tls", "sydney-all", "sydney-qbe"],
  ["melbourne-tcl-au", "melbourne-tcl-us", "sydney-wow"],
  ["melbourne-col"],
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const WD_PAGE = 20;
const DEFAULT_MAX_PAGES = 40;

function clean(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** ISO day from anything Date.parse understands, else today. */
function isoDay(s: string): string {
  const t = Date.parse(s);
  return Number.isNaN(t) ? today() : new Date(t).toISOString().slice(0, 10);
}

/** ISO day from a unix timestamp in seconds (Eightfold's t_update). */
function isoFromEpoch(sec: number): string {
  return sec > 0 ? new Date(sec * 1000).toISOString().slice(0, 10) : today();
}

/**
 * Free-text location → a hub the app actually plots. Specific before general,
 * so "Port Hedland" beats "Perth" and "Western Australia" beats "Australia".
 *
 * This list has to cover the world now, not just Australia. The first three
 * portals were AU-only, so anything unrecognised could safely fall back to the
 * employer's home city. These are global employers — HSBC advertises in New
 * York, CSL in Bremen, Goodman in Madrid — and that fallback would have plotted
 * a German plasma-centre role on Melbourne. See hubFor.
 */
const HUB_MATCH: [string, string | null][] = [
  // Australia — mine sites and states resolve to their capital.
  ["port hedland", "perth"],
  ["newman", "perth"],
  ["karratha", "perth"],
  ["kalgoorlie", "perth"],
  ["tom price", "perth"],
  ["paraburdoo", "perth"],
  ["pilbara", "perth"],
  ["western australia", "perth"],
  [" wa,", "perth"],
  ["perth", "perth"],
  ["brisbane", "brisbane"],
  ["gladstone", "brisbane"],
  ["townsville", "brisbane"],
  ["weipa", "brisbane"],
  ["queensland", "brisbane"],
  [" qld", "brisbane"],
  ["melbourne", "melbourne"],
  ["broadmeadows", "melbourne"],
  ["geelong", "melbourne"],
  ["victoria, austral", "melbourne"],
  [" vic,", "melbourne"],
  ["adelaide", "adelaide"],
  ["south australia", "adelaide"],
  ["canberra", "canberra"],
  ["sydney", "sydney"],
  ["new south wales", "sydney"],
  [" nsw", "sydney"],
  // Asia-Pacific
  ["singapore", "singapore"],
  ["hong kong", "hongkong"],
  ["hongkong", "hongkong"],
  ["tokyo", "tokyo"],
  ["seoul", "seoul"],
  ["beijing", "beijing"],
  ["shanghai", "shanghai"],
  ["shenzhen", "shenzhen"],
  ["ganzhou", "ganzhou"],
  ["dubai", "dubai"],
  // Europe / Africa
  ["london", "london"],
  ["paris", "paris"],
  ["zurich", "zurich"],
  ["zürich", "zurich"],
  ["johannesburg", "johannesburg"],
  // North America
  ["new york", "newyork"],
  ["san francisco", "sanfrancisco"],
  ["san jose", "sanjose"],
  ["san diego", "sandiego"],
  ["los angeles", "losangeles"],
  ["seattle", "seattle"],
  ["denver", "denver"],
  ["houston", "houston"],
  ["chicago", "chicago"],
  ["austin", "austin"],
  ["atlanta", "atlanta"],
  ["bentonville", "bentonville"],
  ["omaha", "omaha"],
  ["indianapolis", "indianapolis"],
  ["charlotte", "charlotte"],
  ["minneapolis", "minneapolis"],
  ["cincinnati", "cincinnati"],
  ["boston", "boston"],
  ["dallas", "dallas"],
  ["washington", "washington"],
  ["philadelphia", "philadelphia"],
  ["portland", "portland"],
  ["toronto", "toronto"],
  ["calgary", "calgary"],
  ["montreal", "montreal"],
  ["vancouver", "vancouver"],
  ["ottawa", "ottawa"],
];

/**
 * Map a role's location onto a hub we plot.
 *
 * The home-hub fallback only applies when the text names the employer's own
 * country without a city ("Australia", "QLD, Australia") or is blank. A role
 * in a country we don't plot returns null — unplaced — because putting a
 * Vilvoorde role on Sydney because Goodman is Sydney-listed would be inventing
 * a fact the source never carried.
 */
function hubFor(loc: string, home: string | null, homeCountry: RegExp): string | null {
  const l = (loc || "").toLowerCase();
  for (const [needle, hub] of HUB_MATCH) if (l.includes(needle)) return hub;
  if (!l.trim() || homeCountry.test(l)) return home;
  return null;
}

/** "Posted Yesterday" / "Posted 5 Days Ago" → an ISO date, best effort. */
function workdayPosted(s: string): string {
  const t = (s || "").toLowerCase();
  const d = new Date();
  if (t.includes("today")) return today();
  if (t.includes("yesterday")) {
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  const m = /(\d+)\+?\s*days?/.exec(t);
  if (m) {
    d.setUTCDate(d.getUTCDate() - Number(m[1]));
    return d.toISOString().slice(0, 10);
  }
  return today();
}

/** Country patterns for the home-hub fallback, keyed by the hub itself. */
const HOME_COUNTRY: Record<string, RegExp> = {
  perth: /australia/,
  adelaide: /australia/,
  melbourne: /australia/,
  sydney: /australia/,
  brisbane: /australia/,
  canberra: /australia/,
  london: /united kingdom|england|\buk\b/,
  hongkong: /hong kong|china/,
};

/** One row built the same way whatever platform it came from. */
function job(site: SiteDef, title: string, loc: string, url: string, created: string, cat: string) {
  return {
    t: title,
    loc,
    cat,
    url,
    created,
    city: hubFor(loc, site.homeHub, HOME_COUNTRY[site.homeHub ?? ""] ?? /$^/),
    skills: skillsForText(title, undefined, { sector: site.sector }),
  };
}

async function getText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", ...init?.headers },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Pages fetched at once from one portal. Enough to keep the walk inside a
 *  cron invocation, small enough to stay a polite trickle to the employer. */
const PAGE_CONCURRENCY = 6;

/**
 * Walk an offset-paged source, fetching pages in parallel windows instead of
 * one at a time.
 *
 * `page(i)` returns the rows of zero-based page `i` (empty when past the end).
 * The walk stops at the first page that comes back empty or short, which for a
 * stable offset pager means every later page is empty too.
 */
async function pagedParallel<T>(
  page: (i: number) => Promise<T[]>,
  pageSize: number,
  maxPages: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < maxPages; start += PAGE_CONCURRENCY) {
    const idx: number[] = [];
    for (let i = start; i < Math.min(start + PAGE_CONCURRENCY, maxPages); i++) idx.push(i);
    const windows = await Promise.all(idx.map(page));
    let done = false;
    for (const rows of windows) {
      out.push(...rows);
      if (rows.length < pageSize) {
        done = true;
        break;
      }
    }
    if (done) break;
  }
  return out;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", ...init?.headers },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// ── SAP SuccessFactors ───────────────────────────────────────────────────────
async function fetchSuccessFactors(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  // Page size is a tenant setting (BHP/Woodside 25, ANZ 100). It is read off
  // the first page rather than assumed, because guessing low silently skips
  // roles and guessing high ends the walk after one page.
  let pageSize = 0;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < max; page++) {
    const startrow = pageSize ? page * pageSize : 0;
    const html = await getText(`${site.endpoint}/search/?q=&startrow=${startrow}`);
    if (!html) break;
    // Table theme first; tile theme when the page carries no table rows.
    const table = html.split(/<tr class="data-row">/i).slice(1);
    const tiles = table.length ? [] : html.split(/<div class="job-tile-cell">/i).slice(1);
    const rows = table.length ? table : tiles;
    if (!rows.length) break;
    if (!pageSize) pageSize = rows.length;
    let added = 0;
    for (const raw of rows) {
      const row = table.length ? raw.split(/<\/tr>/i)[0] : raw;
      const a =
        row.match(/<a href="([^"]+)"[^>]*class="jobTitle-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ??
        row.match(/<a[^>]*class="jobTitle-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!a) continue;
      const href = clean(a[1]);
      const title = clean(a[2]);
      if (!href || !title || seen.has(href)) continue;
      seen.add(href);
      const locM =
        row.match(/<span class="jobLocation">([\s\S]*?)<\/span>/i) ??
        row.match(/id="job-\d+-desktop-section-location-value"[^>]*>([\s\S]*?)<\/div>/i);
      const dateM =
        row.match(/<span class="jobDate[^"]*">([\s\S]*?)<\/span>/i) ??
        row.match(/id="job-\d+-desktop-section-date-value"[^>]*>([\s\S]*?)<\/div>/i);
      const loc = locM ? clean(locM[1]) : "";
      out.push(
        job(
          site,
          title,
          loc,
          href.startsWith("http") ? href : site.origin + href,
          dateM ? isoDay(clean(dateM[1])) : today(),
          "Career portal",
        ),
      );
      added++;
    }
    // A short page is the last page.
    if (added === 0 || rows.length < pageSize) break;
  }
  return out;
}

// ── Workday ──────────────────────────────────────────────────────────────────
interface WorkdayPosting {
  title?: string;
  locationsText?: string;
  externalPath?: string;
  postedOn?: string;
}

async function fetchWorkday(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 0; page < max; page++) {
    const json = await getJson<{ jobPostings?: WorkdayPosting[] }>(site.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appliedFacets: {},
        limit: WD_PAGE,
        offset: page * WD_PAGE,
        searchText: "",
      }),
    });
    const postings = json?.jobPostings ?? [];
    if (!postings.length) break;
    for (const p of postings) {
      const title = (p.title || "").trim();
      const path = (p.externalPath || "").trim();
      if (!title || !path || seen.has(path)) continue;
      seen.add(path);
      const loc = (p.locationsText || "").trim();
      out.push(
        job(site, title, loc, site.origin + path, workdayPosted(p.postedOn || ""), "Career portal"),
      );
    }
    if (postings.length < WD_PAGE) break;
  }
  return out;
}

// ── Eightfold AI ─────────────────────────────────────────────────────────────
interface EightfoldPos {
  name?: string;
  location?: string;
  t_update?: number;
  canonicalPositionUrl?: string;
  department?: string;
  id?: number | string;
}

// `num` is not honoured by this API — it returns 10 whatever you ask for — so
// the page size is fixed here rather than requested.
const EF_PAGE = 10;

async function fetchEightfold(site: SiteDef): Promise<PortalJob[]> {
  const max = site.maxPages ?? 200; // HSBC alone is ~1,500 roles at 10 a page
  const positions = await pagedParallel<EightfoldPos>(
    async (i) => {
      const json = await getJson<{ positions?: EightfoldPos[] }>(
        `${site.endpoint}&start=${i * EF_PAGE}&num=${EF_PAGE}`,
      );
      return json?.positions ?? [];
    },
    EF_PAGE,
    max,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    const title = (p.name || "").trim();
    const key = String(p.id ?? p.canonicalPositionUrl ?? title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(
      job(
        site,
        title,
        (p.location || "").trim(),
        p.canonicalPositionUrl || `${site.origin}/careers/job/${p.id ?? ""}`,
        isoFromEpoch(Number(p.t_update) || 0),
        (p.department || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── Symphony Talent / SmashFly ───────────────────────────────────────────────
interface SymphonyJob {
  title?: string;
  url?: string;
  open_date?: string;
  primary_category?: string;
  google_locations?: { city?: string; state?: string; country?: string; address?: string }[];
  primary_city?: string;
}

// `limit` is accepted and ignored; the tenant returns 10 a page.
const SY_PAGE = 10;

async function fetchSymphony(site: SiteDef): Promise<PortalJob[]> {
  const max = site.maxPages ?? 60;
  const results = await pagedParallel<{ job?: SymphonyJob }>(
    async (i) => {
      const json = await getJson<{ searchResults?: { job?: SymphonyJob }[] }>(
        `${site.endpoint}&limit=${SY_PAGE}&offset=${i * SY_PAGE}`,
        { headers: { Referer: site.origin + "/" } },
      );
      return json?.searchResults ?? [];
    },
    SY_PAGE,
    max,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const j = r.job;
    const title = (j?.title || "").trim();
    const url = (j?.url || "").trim();
    if (!title || seen.has(url || title)) continue;
    seen.add(url || title);
    const g = j?.google_locations?.[0];
    const loc =
      [g?.city, g?.state, g?.country].filter(Boolean).join(", ") || (j?.primary_city ?? "");
    out.push(
      job(
        site,
        title,
        loc,
        url || site.origin,
        isoDay(j?.open_date || ""),
        (j?.primary_category || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── Oracle Recruiting Cloud ──────────────────────────────────────────────────
interface OracleReq {
  Title?: string;
  PrimaryLocation?: string;
  PostedDate?: string;
  Id?: string | number;
  JobFunction?: string;
}

const OR_PAGE = 25;

async function fetchOracle(site: SiteDef): Promise<PortalJob[]> {
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  const list = await pagedParallel<OracleReq>(
    async (i) => {
      const finder = `findReqs;siteNumber=CX_1,limit=${OR_PAGE},offset=${i * OR_PAGE},sortBy=POSTING_DATES_DESC`;
      const url =
        `${site.endpoint}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`;
      const json = await getJson<{ items?: { requisitionList?: OracleReq[] }[] }>(url);
      return json?.items?.[0]?.requisitionList ?? [];
    },
    OR_PAGE,
    max,
  );
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const title = (r.Title || "").trim();
    const id = String(r.Id ?? "");
    if (!title || seen.has(id || title)) continue;
    seen.add(id || title);
    out.push(
      job(
        site,
        title,
        (r.PrimaryLocation || "").trim(),
        `${site.origin}/job/${id}`,
        isoDay(r.PostedDate || ""),
        (r.JobFunction || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── LiveHire ─────────────────────────────────────────────────────────────────
interface LiveHireJob {
  roleName?: string;
  physicalLocation?: string;
  workLocationName?: string;
  countryName?: string;
  postedFrom?: string;
  urlCode?: string;
  seoSlug?: string;
  workType?: string;
}

async function fetchLiveHire(site: SiteDef): Promise<PortalJob[]> {
  const segment = site.endpoint; // the LiveHire segment code
  const tok = await getJson<{ access_token?: string; token_type?: string }>(
    `${site.origin}/api/jobsapi/careers/auth/token/${segment}`,
  );
  if (!tok?.access_token) return [];
  const auth = `${tok.token_type || "Bearer"} ${tok.access_token}`;
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const size = 50;
  const max = site.maxPages ?? DEFAULT_MAX_PAGES;
  for (let page = 1; page <= max; page++) {
    const json = await getJson<{ jobs?: LiveHireJob[]; hasMoreResults?: boolean }>(
      `${site.origin}/careers-api/search/${segment}/${page}/${size}`,
      {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ multiSegment: true }),
      },
    );
    const jobs = json?.jobs ?? [];
    if (!jobs.length) break;
    for (const j of jobs) {
      const title = (j.roleName || "").trim();
      const code = (j.urlCode || j.seoSlug || "").trim();
      if (!title || seen.has(code || title)) continue;
      seen.add(code || title);
      const loc = [j.physicalLocation, j.workLocationName, j.countryName]
        .filter(Boolean)
        .join(", ")
        .trim();
      out.push(
        job(
          site,
          title,
          loc,
          code
            ? `${site.origin}/widgets/job-listings/${segment}/job/${code}`
            : `${site.origin}/widgets/job-listings/${segment}`,
          isoDay(j.postedFrom || ""),
          (j.workType || "").trim() || "Career portal",
        ),
      );
    }
    if (!json?.hasMoreResults) break;
  }
  return out;
}

// ── Greenhouse ───────────────────────────────────────────────────────────────
interface GreenhouseJob {
  title?: string;
  location?: { name?: string };
  absolute_url?: string;
  updated_at?: string;
  first_published?: string;
  id?: number;
}

async function fetchGreenhouse(site: SiteDef): Promise<PortalJob[]> {
  const json = await getJson<{ jobs?: GreenhouseJob[] }>(site.endpoint);
  const jobs = json?.jobs ?? [];
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const j of jobs) {
    const title = (j.title || "").trim();
    const key = String(j.id ?? title);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const loc = (j.location?.name || "").trim();
    out.push(
      job(
        site,
        title,
        loc,
        j.absolute_url || site.origin,
        isoDay(j.first_published || j.updated_at || ""),
        "Career portal",
      ),
    );
  }
  return out;
}

// ── Avature (Macquarie) ──────────────────────────────────────────────────────
// The tenant fixes the page size at 9; jobRecordsPerPage is accepted and
// ignored, so the offset steps by 9.
const AV_PAGE = 9;

async function fetchAvature(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 80;
  // Page size is per TENANT, not per platform: Macquarie serves 9 and
  // Woolworths 6, and both accept-and-ignore a bigger jobRecordsPerPage
  // (asking Woolworths for 50 still returns 6). Sending it anyway matters —
  // without jobRecordsPerPage in the query, Woolworths ignores jobOffset
  // entirely and every page comes back as the first six.
  const size = site.pageSize ?? AV_PAGE;
  const blocks = await pagedParallel<string>(
    async (i) => {
      const html = await getText(
        `${site.endpoint}/?listFilterMode=1&jobRecordsPerPage=${size}&jobOffset=${i * size}`,
      );
      // The result wrapper carries tenant-specific modifiers between the two
      // class names — Woolworths renders `article article--w--full
      // article--result` — so an exact "article article--result" split found
      // nothing there. Match the pair with anything allowed in between.
      return html ? html.split(/class="article[^"]*article--result/i).slice(1) : [];
    },
    size,
    max,
  );
  for (const b of blocks) {
    const a = b.match(/<a[^>]*href="([^"]*JobDetail[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const href = clean(a[1]);
    const title = clean(a[2]);
    if (!title || seen.has(href || title)) continue;
    seen.add(href || title);
    // Text cells in order: req id, location, posted date, category. The date is
    // the only one with a fixed shape, so it anchors the other two. The node is
    // matched before cleaning, so no length bound is applied — Avature indents
    // its markup heavily and a "{2,60}" bound rejected every cell on the
    // grounds of the surrounding whitespace.
    const cells = [...b.matchAll(/>([^<>]+)</g)]
      .map((m) => clean(m[1]))
      .filter((s) => s.length > 1 && !/^(View details|Apply|ID)$/i.test(s));
    const dateAt = cells.findIndex((c) => /^\d{1,2} [A-Za-z]{3} \d{4}$/.test(c));
    out.push(
      job(
        site,
        title,
        dateAt > 0 ? cells[dateAt - 1] : "",
        href.startsWith("http") ? href : site.origin + href,
        dateAt >= 0 ? isoDay(cells[dateAt]) : today(),
        dateAt >= 0 && cells[dateAt + 1] ? cells[dateAt + 1] : "Career portal",
      ),
    );
  }
  return out;
}

// ── Phenom People (Coles) ────────────────────────────────────────────────────
// colescareers.com.au is a Phenom career site: the page is a client app, but
// the FIRST page of results is already embedded in a `phApp.ddo = {…}` island
// under `eagerLoadRefineSearch`, together with the total. Paging is a plain
// `?from=N` on the same URL, stepping by the island's own `hits` (10 here) —
// verified against the live site, where from=0/10/20 each returned a different
// first role.
//
// Read from the island rather than Phenom's /widgets API because the API is
// tenant-configured and 404s on this tenant, while the island is what the page
// itself renders from.
interface PhenomJob {
  title?: string;
  cityState?: string;
  city?: string;
  state?: string;
  country?: string;
  category?: string;
  applyUrl?: string;
  jobId?: string;
  postedDate?: string;
}

/** Pull the `phApp.ddo = {…}` object out of a Phenom page. */
function phenomIsland(html: string): Record<string, unknown> | null {
  const at = html.indexOf("phApp.ddo =");
  if (at < 0) return null;
  const from = html.slice(at + "phApp.ddo =".length);
  // Brace-match rather than regex: the object contains job descriptions with
  // braces in them, so a lazy match to the first "}" truncates it.
  let depth = 0;
  for (let i = 0; i < from.length; i++) {
    const ch = from[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(from.slice(0, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

async function fetchPhenom(site: SiteDef): Promise<PortalJob[]> {
  const first = await getText(`${site.endpoint}?keywords=`);
  const island = first ? phenomIsland(first) : null;
  const eager = (island?.eagerLoadRefineSearch ?? {}) as {
    hits?: number;
    totalHits?: number;
    data?: { jobs?: PhenomJob[] };
  };
  const size = eager.hits && eager.hits > 0 ? eager.hits : 10;
  const total = Number(eager.totalHits) || 0;
  if (!total) return [];
  const pages = Math.min(Math.ceil(total / size), site.maxPages ?? DEFAULT_MAX_PAGES);

  const rows: PhenomJob[] = [...(eager.data?.jobs ?? [])];
  const rest = await pagedParallel<PhenomJob>(
    async (i) => {
      if (i === 0) return []; // page 0 is the island we already have
      const html = await getText(`${site.endpoint}?keywords=&from=${i * size}&s=1`);
      const isl = html ? phenomIsland(html) : null;
      const e = (isl?.eagerLoadRefineSearch ?? {}) as { data?: { jobs?: PhenomJob[] } };
      return e.data?.jobs ?? [];
    },
    size,
    pages,
  );
  rows.push(...rest);

  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const title = clean(String(r.title ?? ""));
    if (!title) continue;
    const key = String(r.jobId ?? "") || title;
    if (seen.has(key)) continue;
    seen.add(key);
    const loc = clean(
      String(r.cityState ?? [r.city, r.state].filter(Boolean).join(", ") ?? r.country ?? ""),
    );
    const url = String(r.applyUrl ?? "");
    out.push(
      job(
        site,
        title,
        loc,
        url.startsWith("http") ? url : site.origin + url,
        isoDay(String(r.postedDate ?? "")) || today(),
        clean(String(r.category ?? "")) || "Career portal",
      ),
    );
  }
  return out;
}

// ── Next.js data island (Fortescue) ──────────────────────────────────────────
interface FortescueJob {
  id?: string;
  title?: string;
  country?: string;
  site?: string;
  category?: string;
  createdDateTime?: string;
}

/** ASP.NET's `/Date(1785118637000+0000)/` → an ISO day. */
function dotNetDate(s: string): string {
  const m = /\/Date\((\d+)/.exec(s || "");
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : today();
}

async function fetchNextData(site: SiteDef): Promise<PortalJob[]> {
  const html = await getText(site.endpoint);
  if (!html) return [];
  const m = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  // The component id is a generated uuid, so the list is found by shape rather
  // than by path — any componentProps entry carrying a fetchedJobs array.
  const props = (data as { props?: { pageProps?: { componentProps?: Record<string, unknown> } } })
    ?.props?.pageProps?.componentProps;
  let jobs: FortescueJob[] = [];
  for (const v of Object.values(props ?? {})) {
    const f = (v as { fetchedJobs?: FortescueJob[] })?.fetchedJobs;
    if (Array.isArray(f) && f.length) {
      jobs = f;
      break;
    }
  }
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (const j of jobs) {
    const title = (j.title || "").trim();
    const id = String(j.id ?? "");
    if (!title || seen.has(id || title)) continue;
    seen.add(id || title);
    // `site` is "Australia - Perth"; `country` is the fallback when it is blank
    // (the exploration roles carry a country only).
    const loc = (j.site || "").trim() || (j.country || "").trim();
    out.push(
      job(
        site,
        title,
        loc,
        id ? `${site.endpoint}/${id}` : site.endpoint,
        dotNetDate(j.createdDateTime || ""),
        (j.category || "").trim() || "Career portal",
      ),
    );
  }
  return out;
}

// ── CSL's own board ──────────────────────────────────────────────────────────
const CSL_PAGE = 25;

async function fetchCsl(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  const max = site.maxPages ?? 60;
  // `?page=` is 1-based here, unlike the offset pagers.
  const rows = await pagedParallel<RegExpMatchArray>(
    async (i) => {
      const html = await getText(`${site.endpoint}?page=${i + 1}`);
      if (!html) return [];
      return [
        ...html.matchAll(
          /<a class="block hover:bg-gray-50 group" href="([^"]+)">([\s\S]*?)<\/a>/gi,
        ),
      ];
    },
    CSL_PAGE,
    max,
  );
  for (const r of rows) {
    const href = clean(r[1]);
    // Text cells run: title, work type, department(s), business unit,
    // location, requisition id, "Posted on", date. The requisition id is the
    // one field with a fixed shape, so the location is read as the cell
    // before it rather than by counting from the start.
    const cells = [...r[2].matchAll(/>([^<>]{2,140})</g)].map((m) => clean(m[1])).filter(Boolean);
    const title = cells[0] || "";
    if (!title || seen.has(href || title)) continue;
    seen.add(href || title);
    const reqAt = cells.findIndex((c) => /^R-\d+$/.test(c));
    const posted = cells[cells.length - 1] || "";
    out.push(
      job(
        site,
        title,
        reqAt > 0 ? cells[reqAt - 1] : "",
        href.startsWith("http") ? href : site.origin + href,
        /\d{4}/.test(posted) ? isoDay(posted) : today(),
        cells[1] || "Career portal",
      ),
    );
  }
  return out;
}

const FETCHERS: Record<Platform, (s: SiteDef) => Promise<PortalJob[]>> = {
  successfactors: fetchSuccessFactors,
  workday: fetchWorkday,
  eightfold: fetchEightfold,
  symphony: fetchSymphony,
  oracle: fetchOracle,
  livehire: fetchLiveHire,
  greenhouse: fetchGreenhouse,
  avature: fetchAvature,
  phenom: fetchPhenom,
  nextdata: fetchNextData,
  csl: fetchCsl,
};

export async function fetchPortal(site: SiteDef): Promise<PortalJob[]> {
  return FETCHERS[site.platform](site);
}

/** Short source tag per platform, so an archive row says where it came from. */
const SOURCE_TAG: Record<Platform, string> = {
  successfactors: "sf",
  workday: "wd",
  eightfold: "ef",
  symphony: "sy",
  oracle: "or",
  livehire: "lh",
  greenhouse: "gh",
  avature: "av",
  nextdata: "nx",
  phenom: "ph",
  csl: "csl",
};

/** Portal rows → archive rows, attributed to the employer they came from. */
export function portalToArchive(jobs: PortalJob[], site: SiteDef): ArchiveRow[] {
  return jobs.map((j) => ({
    source: `portal-${SOURCE_TAG[site.platform]}`,
    title: j.t,
    company: site.name,
    companyId: site.id,
    hub: j.city,
    location: j.loc,
    category: j.cat,
    url: j.url,
    posted: j.created,
    skills: j.skills,
  }));
}

interface PortalEnv {
  OPEN_ROLES_HISTORY: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  JOBS_ARCHIVE?: unknown;
}

/**
 * One pass over the configured portals. Each employer's roles are stored under
 * `portal:<id>` for the card to read, and appended to the shared archive, which
 * is what dedups them against the same role pulled from a job board.
 *
 * `group` selects one slice of PORTAL_GROUPS; omit it to walk every site (what
 * the /run-portals trigger does).
 */
export async function processPortals(
  env: PortalEnv,
  archive: (rows: ArchiveRow[], day: string) => Promise<void>,
  group?: number,
): Promise<{ site: string; count: number }[]> {
  const day = today();
  const out: { site: string; count: number }[] = [];
  const only = group == null ? null : new Set(PORTAL_GROUPS[group] ?? []);
  for (const site of SITES) {
    const siteKey = site.key ?? site.id;
    if (only && !only.has(siteKey)) continue;
    const jobs = await fetchPortal(site);
    // An empty pull is never written: a portal that rate-limited or changed its
    // markup should leave yesterday's roles in place, not blank the card.
    if (!jobs.length) {
      out.push({ site: siteKey, count: 0 });
      continue;
    }
    await env.OPEN_ROLES_HISTORY.put(
      `portal:${siteKey}`,
      JSON.stringify({ updated: day, count: jobs.length, jobs }),
    );
    await archive(portalToArchive(jobs, site), day);
    out.push({ site: siteKey, count: jobs.length });
  }
  return out;
}
