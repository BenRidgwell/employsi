// Queensland Government jobs feed.
//
// Scrapes the official QLD "Smart jobs" board (smartjobs.qld.gov.au, a jobtools
// ATS) and maps every advertised role to one of the QLD gov agencies plotted in
// Brisbane (see data/brisbaneGov.ts). Live-vacancies source for those agencies —
// real, ToS-clean public data from the government's own board.
//
// The results come from a POST to jncustomsearch.searchResults (20 jobs a page,
// paged by the `in_pg` start-offset). Each result <li> carries an org marker
// comment, a result-title of "<strong>Title</strong>, Agency", a work-type span,
// a location and a close date. There's no grand total on the page, so the walk
// advances the offset window until a page returns no results; per-agency counts
// accumulate across runs like the WA/VIC feeds.

import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';
import { qldGovAgencyId, BRISBANE_GOV_NAMES } from '../../src/employsi/data/brisbaneGov';

const ENDPOINT = 'https://smartjobs.qld.gov.au/jobtools/jncustomsearch.searchResults';
const REFERER = 'https://smartjobs.qld.gov.au/jobtools/jncustomsearch.jobsearch?in_organid=14904';
const SITE = 'https://smartjobs.qld.gov.au';
const ORGANID = '14904';
const PER_PAGE = 20;
const MAX_OFFSET = 4000; // safety cap (~108 pages today)

export interface StoredQldJob {
  t: string;
  loc: string;
  cat: string;
  url: string;
  created: string;
  city: string | null; // Brisbane-market (QLD) roles
  skills: string[];
  emp?: string; // work type
  seen?: string;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function unescapeHtml(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&ndash;/g, '-')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normName(s: string): string {
  return unescapeHtml(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const AGENCY_BY_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const name of BRISBANE_GOV_NAMES) m[normName(name)] = qldGovAgencyId(name);
  return m;
})();

export function matchAgencyId(orgText: string): string | null {
  return AGENCY_BY_KEY[normName(orgText)] ?? null;
}

// Parse one results page into { agencyId → jobs }.
export function parseQldGovPage(html: string): { byAgency: Record<string, StoredQldJob[]>; parsed: number; items: number } {
  const byAgency: Record<string, StoredQldJob[]> = {};
  let parsed = 0;
  // Each result is delimited by the org-marker comment.
  const blocks = html.split(/<!--Summary Body org \d+-->/).slice(1);
  for (const body of blocks) {
    const titleM = body.match(/result-title"><strong>([\s\S]*?)<\/strong>\s*,?\s*([\s\S]*?)<\/span>/);
    if (!titleM) continue;
    const title = unescapeHtml(titleM[1]);
    const org = unescapeHtml(titleM[2]);
    if (!title || !org) continue;
    const agencyId = matchAgencyId(org);
    if (!agencyId) continue;
    // The result-title anchor carries the canonical job URL (e.g. "/jobs/QLD-…").
    const hrefM = body.match(/href="([^"]+)"[^>]*>\s*<span class="result-title"/i)
      || body.match(/href="(\/jobs\/[^"]+)"/i);
    let url = '';
    if (hrefM) {
      const h = unescapeHtml(hrefM[1]);
      url = h.startsWith('http') ? h : SITE + (h.startsWith('/') ? h : '/' + h);
    }
    const typeM = body.match(/<span class="type">([\s\S]*?)<\/span>/i);
    const locM = body.match(/class="locality">([\s\S]*?)<\/strong>/i) || body.match(/<li>\s*<strong[^>]*>([\s\S]*?)<\/strong>/i);
    const closeM = body.match(/datetime="([^"]+)"/);
    const job: StoredQldJob = {
      t: title,
      loc: locM ? unescapeHtml(locM[1]) : 'Queensland',
      cat: 'Government',
      url,
      created: closeM ? '' : '',
      city: 'brisbane',
      skills: skillsForText(title),
      emp: typeM ? unescapeHtml(typeM[1]) : undefined,
    };
    (byAgency[agencyId] ||= []).push(job);
    parsed++;
  }
  return { byAgency, parsed, items: blocks.length };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPageOnce(offset: number, signalMs = 15000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  try {
    const body = `in_organid=${ORGANID}&in_skills=&in_orderby=DATEINPUT&in_pg=${offset}`;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': 'employsi-jobs/1.0 (+https://employsi.com; QLD gov vacancies feed)',
        Accept: 'text/html',
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: REFERER,
      },
      body,
    });
    if (!res.ok) return null;
    const html = await res.text();
    // A valid results page always contains the org-marker comment; a challenge /
    // error page won't — treat that as a miss so the caller retries.
    return html.includes('Summary Body org') ? html : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(offset: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * attempt);
    const html = await fetchPageOnce(offset);
    if (html) return html;
  }
  return null;
}

export interface QldGovResult {
  updated: string;
  startOffset: number;
  pagesOk: number;
  parsed: number;
  reachedEnd: boolean; // a page returned no results → board fully walked this window
  byAgency: Record<string, StoredQldJob[]>;
}

// Fetch a contiguous window of `windowPages` result pages starting at
// `startOffset` (a multiple of 20). Stops early when a page returns no results.
export async function fetchQldGovPages(today: string, startOffset: number, windowPages: number): Promise<QldGovResult | null> {
  const byAgency: Record<string, StoredQldJob[]> = {};
  let parsed = 0;
  let pagesOk = 0;
  let reachedEnd = false;
  const start = Math.max(0, startOffset);
  let gotAny = false;
  for (let k = 0; k < windowPages; k++) {
    const offset = start + k * PER_PAGE;
    if (offset > MAX_OFFSET) {
      reachedEnd = true;
      break;
    }
    if (k > 0) await sleep(300);
    const html = await fetchPage(offset);
    if (!html) continue;
    gotAny = true;
    const res = parseQldGovPage(html);
    if (res.items === 0) {
      reachedEnd = true;
      break;
    }
    for (const [id, jobs] of Object.entries(res.byAgency)) {
      for (const j of jobs) j.seen = today;
      (byAgency[id] ||= []).push(...jobs);
    }
    parsed += res.parsed;
    pagesOk++;
  }
  if (!gotAny) return null; // whole window failed to fetch → let caller keep cursor
  return { updated: today, startOffset: start, pagesOk, parsed, reachedEnd, byAgency };
}
