/**
 * Employer career-portal feeds.
 *
 * Companies advertise on their own portals as well as on the job boards we
 * already pull, and the portal is the authoritative list — it carries roles
 * that never reach an aggregator. This module fetches those portals directly
 * and hands the rows to the same archive/dedup/skills path everything else
 * uses, so a role advertised on both a portal and Adzuna is counted once.
 *
 * Two platforms are covered, because they are what these employers actually
 * run and each is one contract serving several of them:
 *
 *   - **SAP SuccessFactors** (BHP, Woodside). A server-rendered search page,
 *     `/search/?q=&startrow=N`, 25 rows a page. It ships in TWO themes and
 *     these two employers use one each: BHP renders a table of
 *     `<tr class="data-row">` with `jobLocation` / `jobDate` cells, Woodside
 *     renders tiles (`<div class="job-tile-cell">`) whose fields are
 *     `id="job-<id>-desktop-section-<field>-value"` divs. Both carry the same
 *     `jobTitle-link` anchor, so the parser splits on whichever wrapper the
 *     page actually uses and reads the fields per theme.
 *   - **Workday** (CBA). A JSON API — POST `/wday/cxs/<tenant>/<site>/jobs`
 *     with `{appliedFacets,limit,offset,searchText}` — returning `jobPostings`
 *     with title, `locationsText`, `externalPath` and a relative `postedOn`.
 *
 * Both were verified against the live sites before this was written; the
 * per-site contracts are recorded in SITES below so a future breakage is
 * traceable to a named assumption rather than a silent zero.
 *
 * NOT covered yet, and why — each needs its own reverse-engineering pass:
 *   - Rio Tinto (jobs.riotinto.com): not SuccessFactors; /search/ 404s.
 *   - Fortescue (careers.fortescue.com): a ~1MB client-rendered app, so the
 *     listings are not in the HTML and its API has to be found first.
 *   - Westpac, NAB, ANZ, Macquarie, Wesfarmers, Goodman: no portal URL was
 *     given and they are not on the obvious Workday tenant subdomains, so the
 *     right entry point has to be established before anything is written.
 *   - Jora: 403s a plain request; it needs the Oxylabs path the Indeed and
 *     Zhaopin scrapers already use, which runs as a GitHub Action rather than
 *     in the Worker (datacentre IPs are blocked).
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

type Platform = "successfactors" | "workday";

interface SiteDef {
  /** App company id — what the archive rows are attributed to. */
  id: string;
  name: string;
  platform: Platform;
  /** SuccessFactors: the portal origin. Workday: the full CXS jobs endpoint. */
  endpoint: string;
  /** Origin used to absolutise a job's relative path. */
  origin: string;
  /** Default hub when a role's location text matches no known city. */
  homeHub: string | null;
}

export const SITES: SiteDef[] = [
  {
    id: "bhp",
    name: "BHP",
    platform: "successfactors",
    endpoint: "https://careers.bhp.com",
    origin: "https://careers.bhp.com",
    homeHub: "perth",
  },
  {
    id: "wds",
    name: "Woodside Energy",
    platform: "successfactors",
    endpoint: "https://careers.woodside.com.au",
    origin: "https://careers.woodside.com.au",
    homeHub: "perth",
  },
  {
    id: "cba",
    name: "Commonwealth Bank",
    platform: "workday",
    endpoint: "https://cba.wd3.myworkdayjobs.com/wday/cxs/cba/CommBank_Careers/jobs",
    origin: "https://cba.wd3.myworkdayjobs.com/en-US/CommBank_Careers",
    homeHub: "sydney",
  },
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SF_PAGE = 25;
const SF_MAX_PAGES = 20; // 500 roles — comfortably above either portal's total
const WD_PAGE = 20;
const WD_MAX_PAGES = 25; // 500 roles

function clean(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** City names we plot, longest first so "Port Hedland" beats "Perth". */
const HUB_MATCH: [string, string][] = [
  ["port hedland", "perth"],
  ["newman", "perth"],
  ["karratha", "perth"],
  ["kalgoorlie", "perth"],
  ["western australia", "perth"],
  ["perth", "perth"],
  ["brisbane", "brisbane"],
  ["queensland", "brisbane"],
  ["melbourne", "melbourne"],
  ["victoria", "melbourne"],
  ["adelaide", "adelaide"],
  ["canberra", "canberra"],
  ["sydney", "sydney"],
  ["new south wales", "sydney"],
  ["singapore", "singapore"],
  ["houston", "houston"],
  ["london", "london"],
  ["santiago", null as unknown as string],
];

/** Map a portal's free-text location onto a hub we plot, else the home hub. */
function hubFor(loc: string, home: string | null): string | null {
  const l = (loc || "").toLowerCase();
  for (const [needle, hub] of HUB_MATCH) if (l.includes(needle)) return hub;
  // "Australia" with no city is genuinely unplaceable to a single hub, so it
  // falls to the employer's home rather than being dropped.
  return home;
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

/** "28 Jul 2026" → "2026-07-28". */
function sfPosted(s: string): string {
  const t = Date.parse(s);
  return Number.isNaN(t) ? today() : new Date(t).toISOString().slice(0, 10);
}

async function fetchSuccessFactors(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < SF_MAX_PAGES; page++) {
    const url = `${site.endpoint}/search/?q=&startrow=${page * SF_PAGE}`;
    let html = "";
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      });
      if (!res.ok) break;
      html = await res.text();
    } catch {
      break;
    }
    // Table theme first; tile theme when the page carries no table rows.
    const table = html.split(/<tr class="data-row">/i).slice(1);
    const tiles = table.length ? [] : html.split(/<div class="job-tile-cell">/i).slice(1);
    const rows = table.length ? table : tiles;
    if (!rows.length) break;
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
      out.push({
        t: title,
        loc,
        cat: "Career portal",
        url: href.startsWith("http") ? href : site.origin + href,
        created: dateM ? sfPosted(clean(dateM[1])) : today(),
        city: hubFor(loc, site.homeHub),
        skills: skillsForText(title),
      });
      added++;
    }
    // A short page is the last page.
    if (added === 0 || rows.length < SF_PAGE) break;
  }
  return out;
}

interface WorkdayPosting {
  title?: string;
  locationsText?: string;
  externalPath?: string;
  postedOn?: string;
}

async function fetchWorkday(site: SiteDef): Promise<PortalJob[]> {
  const out: PortalJob[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < WD_MAX_PAGES; page++) {
    let postings: WorkdayPosting[] = [];
    try {
      const res = await fetch(site.endpoint, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: WD_PAGE,
          offset: page * WD_PAGE,
          searchText: "",
        }),
      });
      if (!res.ok) break;
      const json = (await res.json()) as { jobPostings?: WorkdayPosting[] };
      postings = json.jobPostings ?? [];
    } catch {
      break;
    }
    if (!postings.length) break;
    for (const p of postings) {
      const title = (p.title || "").trim();
      const path = (p.externalPath || "").trim();
      if (!title || !path || seen.has(path)) continue;
      seen.add(path);
      const loc = (p.locationsText || "").trim();
      out.push({
        t: title,
        loc,
        cat: "Career portal",
        url: site.origin + path,
        created: workdayPosted(p.postedOn || ""),
        city: hubFor(loc, site.homeHub),
        skills: skillsForText(title),
      });
    }
    if (postings.length < WD_PAGE) break;
  }
  return out;
}

export async function fetchPortal(site: SiteDef): Promise<PortalJob[]> {
  return site.platform === "successfactors" ? fetchSuccessFactors(site) : fetchWorkday(site);
}

/** Portal rows → archive rows, attributed to the employer they came from. */
export function portalToArchive(jobs: PortalJob[], site: SiteDef): ArchiveRow[] {
  return jobs.map((j) => ({
    source: `portal-${site.platform === "workday" ? "wd" : "sf"}`,
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
 * One pass over every configured portal. Each employer's roles are stored under
 * `portal:<id>` for the card to read, and appended to the shared archive, which
 * is what dedups them against the same role pulled from a job board.
 */
export async function processPortals(
  env: PortalEnv,
  archive: (rows: ArchiveRow[], day: string) => Promise<void>,
): Promise<{ site: string; count: number }[]> {
  const day = today();
  const out: { site: string; count: number }[] = [];
  for (const site of SITES) {
    const jobs = await fetchPortal(site);
    // An empty pull is never written: a portal that rate-limited or changed its
    // markup should leave yesterday's roles in place, not blank the card.
    if (!jobs.length) {
      out.push({ site: site.id, count: 0 });
      continue;
    }
    await env.OPEN_ROLES_HISTORY.put(
      `portal:${site.id}`,
      JSON.stringify({ updated: day, count: jobs.length, jobs }),
    );
    await archive(portalToArchive(jobs, site), day);
    out.push({ site: site.id, count: jobs.length });
  }
  return out;
}
