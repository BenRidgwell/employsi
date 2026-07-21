// Western Australian Government jobs feed.
//
// Scrapes the official WA public-sector jobs board
// (https://search.jobs.wa.gov.au/jobs/search) and maps every advertised role to
// one of the 62 gov agencies plotted in Perth (see data/perthGov.ts). This is
// the live-vacancies source for those agencies — real, ToS-clean public data
// straight from the government's own board, not an estimate.
//
// The board is server-rendered HTML (Rails/Clinch), paginated 20 jobs a page,
// with each job card carrying: title + canonical URL, Agency (department),
// Employment type, Salary range, Level, Occupation, Location and Branch. The
// search landing page also exposes a "department" filter facet listing every
// agency with its exact live vacancy count — used as the authoritative per-agency
// total.

import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';
import { govAgencyId, PERTH_GOV_NAMES } from '../../src/employsi/data/perthGov';

const BASE = 'https://search.jobs.wa.gov.au/jobs/search';
const PER_PAGE = 20;
const MAX_PAGES = 45; // safety cap (board is ~39 pages / ~760 jobs)

// A stored WA job — mirrors the app's AdvertisedJob shape so the company card
// renders it exactly like an Adzuna/Muse role, plus a few WA-specific extras.
export interface StoredWaJob {
  t: string;
  loc: string;
  cat: string; // occupation
  url: string;
  created: string; // board doesn't publish a post date on the card → ''
  city: string | null; // always Perth-market (WA) roles
  skills: string[];
  salN?: number; // advertised salary (annual, from "From $X")
  emp?: string; // employment type (e.g. "Permanent - Full Time")
  level?: string; // classification level (e.g. "Level 3")
  branch?: string; // sub-agency / branch
  seen?: string; // YYYY-MM-DD this listing was last seen on the board (for age-out)
}

// ── HTML helpers ───────────────────────────────────────────────────────────
function unescapeHtml(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalise an agency name for matching: unescape, lowercase, non-alphanumerics
// to single spaces. Both our names and the board's department text collapse to
// the same key.
function normName(s: string): string {
  return unescapeHtml(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// name-key → gov agency id. Built from our 62 agencies, plus aliases for the few
// the board labels differently ("Zoo" → "Perth Zoo"). "&amp;" is handled by the
// unescape in normName, so DFES matches without a special case.
const AGENCY_BY_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const name of PERTH_GOV_NAMES) m[normName(name)] = govAgencyId(name);
  m[normName('Zoo')] = govAgencyId('Perth Zoo');
  return m;
})();

export function matchAgencyId(deptText: string): string | null {
  return AGENCY_BY_KEY[normName(deptText)] ?? null;
}

// "From $80,000" / "$80,000 - $90,000" / "$105,000 pa" → an annual midpoint.
function parseSalary(text: string): number | undefined {
  const nums = (unescapeHtml(text).match(/\$\s*([\d,]+)/g) || [])
    .map((x) => Number(x.replace(/[^\d]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return undefined;
  const mid = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(mid);
}

// The labelled icon+text components inside a job card, keyed by aria-label.
function cardComponents(card: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /aria-label="([^"]+)"[^>]*title="[^"]*"><\/i>\s*<span[^>]*>([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(card))) {
    const label = m[1].trim();
    const value = unescapeHtml(m[2]);
    if (value && !(label in out)) out[label] = value;
  }
  return out;
}

// Parse one page of search results into { agencyId → jobs }. Jobs whose Agency
// isn't one of our 62 (rare) are skipped.
export function parseWaGovPage(html: string): { byAgency: Record<string, StoredWaJob[]>; parsed: number } {
  const byAgency: Record<string, StoredWaJob[]> = {};
  let parsed = 0;
  const cards = html.match(/<article class="col-12 job-search-results-card-col"[\s\S]*?<\/article>/g) || [];
  for (const card of cards) {
    const link = card.match(/<a id="link_job_title[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!link) continue;
    const url = link[1].trim();
    const title = unescapeHtml(link[2]);
    if (!title) continue;
    const comp = cardComponents(card);
    const agencyId = matchAgencyId(comp['Department'] || '');
    if (!agencyId) continue;
    const occupation = comp['Occupation'] || '';
    const job: StoredWaJob = {
      t: title,
      loc: comp['Location Description'] || 'Western Australia',
      cat: occupation || 'Government',
      url,
      created: '',
      city: 'perth',
      skills: skillsForText(`${title} ${occupation}`),
      salN: parseSalary(comp['Salary range'] || ''),
      emp: comp['Employment type'] || undefined,
      level: comp['Levels'] || undefined,
      branch: comp['Branch'] || undefined,
    };
    (byAgency[agencyId] ||= []).push(job);
    parsed++;
  }
  return { byAgency, parsed };
}

// The authoritative per-agency live vacancy counts, read from the search
// landing page's "department" filter facet (agency → count). One request covers
// every agency's total, independent of pagination.
export function parseDeptCounts(html: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /data-filter="department" data-value="([^"]+)" data-count="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = matchAgencyId(m[1]);
    if (id) out[id] = (out[id] || 0) + Number(m[2]);
  }
  return out;
}

// Total advertised jobs, from "Displaying 1 - 20 of <b>761</b> in total".
export function parseTotal(html: string): number {
  const m = html.match(/of\s*<b>\s*([\d,]+)\s*<\/b>\s*in total/i);
  return m ? Number(m[1].replace(/[^\d]/g, '')) : 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPageOnce(page: number, signalMs = 15000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  try {
    const url = page <= 1 ? BASE : `${BASE}?page=${page}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // A descriptive UA so the board's operators can identify the crawler.
        'User-Agent': 'employsi-jobs/1.0 (+https://employsi.com; WA gov vacancies feed)',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // A response with no result cards is a failed/challenged page, not an empty
    // result set (the board always renders cards for an in-range page) — treat it
    // as a miss so the caller retries rather than storing nothing.
    return html.includes('job-search-results-card-col') ? html : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch a page with a couple of retries + backoff. The board sits behind an AWS
// WAF that can throttle a rapid burst of requests from one datacenter IP, so a
// transient miss is expected; retrying with a pause recovers it.
async function fetchPage(page: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * attempt);
    const html = await fetchPageOnce(page);
    if (html) return html;
  }
  return null;
}

export interface WaGovResult {
  updated: string;
  total: number; // board's own total advertised count
  lastPage: number; // ceil(total / 20), capped
  startPage: number; // first paged fetched in this run's window (beyond page 1)
  pagesOk: number; // pages that actually returned cards
  parsed: number; // job listings successfully parsed + mapped this run
  counts: Record<string, number>; // agencyId → authoritative live count (facet)
  byAgency: Record<string, StoredWaJob[]>; // agencyId → jobs parsed this run
}

// Fetch page 1 (always — for the authoritative counts, grand total and its own
// jobs) plus a contiguous window of `windowPages` further pages starting at
// `startPage`. The board sits behind an AWS WAF that starts issuing a JS
// challenge after a burst of requests from one datacenter IP, so a single run
// can only reliably read a slice of the ~39 pages. The caller advances the
// window each run so full attribute coverage accumulates across the day, while
// the per-agency counts (page 1) are always exact on every run.
export async function fetchWaGovPages(today: string, startPage: number, windowPages: number): Promise<WaGovResult | null> {
  const first = await fetchPage(1);
  if (!first) return null;

  const total = parseTotal(first);
  const counts = parseDeptCounts(first);
  const lastPage = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PER_PAGE)));
  const byAgency: Record<string, StoredWaJob[]> = {};
  let parsed = 0;
  let pagesOk = 0;
  const merge = (res: { byAgency: Record<string, StoredWaJob[]>; parsed: number }) => {
    for (const [id, jobs] of Object.entries(res.byAgency)) {
      for (const j of jobs) j.seen = today;
      (byAgency[id] ||= []).push(...jobs);
    }
    parsed += res.parsed;
    pagesOk++;
  };
  merge(parseWaGovPage(first));

  const start = Math.max(2, startPage);
  for (let k = 0; k < windowPages; k++) {
    const p = start + k;
    if (p < 2 || p > lastPage) continue;
    await sleep(400); // polite spacing between requests
    const html = await fetchPage(p);
    if (!html) continue;
    merge(parseWaGovPage(html));
  }

  return { updated: today, total, lastPage, startPage: start, pagesOk, parsed, counts, byAgency };
}
