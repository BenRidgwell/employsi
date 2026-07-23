// Victorian Government jobs feed.
//
// Scrapes the official VIC public-sector jobs board
// (https://www.careers.vic.gov.au/jobs) and maps every advertised role to one of
// the VIC gov agencies plotted in Melbourne (see data/melbourneGov.ts). Live-
// vacancies source for those agencies — real, ToS-clean public data from the
// government's own board.
//
// The board is server-rendered HTML (Drupal / Ripple), paginated 15 jobs a page
// (~2,050 jobs / ~137 pages), each card carrying: title + canonical URL,
// organisation (agency), Work Type, Salary, Grade, Occupation, Location and the
// application close date. There's no per-agency facet on the landing page, so
// per-agency counts accumulate as the paged window walks the board across runs
// (mirrors how the WA feed accumulates attribute coverage).

import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';
import { vicGovAgencyId, MELBOURNE_GOV_NAMES } from '../../src/employsi/data/melbourneGov';

const BASE = 'https://www.careers.vic.gov.au/jobs?keywords=';
const ORIGIN = 'https://www.careers.vic.gov.au';
const PER_PAGE = 15;
const MAX_PAGES = 160; // safety cap (~137 pages today)

// A stored VIC job — mirrors the app's AdvertisedJob shape so the company card
// renders it like any Adzuna/Muse role, plus a few gov extras.
export interface StoredVicJob {
  t: string;
  loc: string;
  cat: string; // occupation
  url: string;
  created: string; // board doesn't publish a post date on the card → ''
  city: string | null; // Melbourne-market (VIC) roles
  skills: string[];
  salN?: number;
  emp?: string; // work type
  level?: string; // grade
  seen?: string; // YYYY-MM-DD last seen on the board (for age-out)
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function unescapeHtml(s: string): string {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
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

// name-key → gov agency id, built from our VIC roster (which is derived from the
// board's own organisation labels, so matches are exact).
const AGENCY_BY_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const name of MELBOURNE_GOV_NAMES) m[normName(name)] = vicGovAgencyId(name);
  return m;
})();

export function matchAgencyId(orgText: string): string | null {
  return AGENCY_BY_KEY[normName(orgText)] ?? null;
}

function parseSalary(text: string): number | undefined {
  const nums = (unescapeHtml(text).match(/\$\s*([\d,]+)/g) || [])
    .map((x) => Number(x.replace(/[^\d]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return undefined;
  const mid = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(mid);
}

// One labelled field inside a card ("Salary:", "Location:", …) → its value.
function cardField(card: string, label: string): string {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*<\\/[^>]+>[\\s\\S]*?<[^>]*>([^<]+)<\\/', 'i');
  const m = card.match(re);
  return m ? unescapeHtml(m[1]) : '';
}

// Parse one page of search results into { agencyId → jobs }.
export function parseVicGovPage(html: string): { byAgency: Record<string, StoredVicJob[]>; parsed: number } {
  const byAgency: Record<string, StoredVicJob[]> = {};
  let parsed = 0;
  const cards = html.match(/<rpl-content class="job-searchResult">[\s\S]*?<\/rpl-content>/g) || [];
  for (const card of cards) {
    const head = card.match(/href="(\/job\/[^"]+)"><h3>([\s\S]*?)<\/h3><\/a>\s*<p[^>]*>([\s\S]*?)<\/p>/);
    if (!head) continue;
    const url = ORIGIN + head[1].trim();
    const title = unescapeHtml(head[2]);
    const org = unescapeHtml(head[3]);
    if (!title || !org) continue;
    const agencyId = matchAgencyId(org);
    if (!agencyId) continue;
    const occupation = cardField(card, 'Occupation');
    const job: StoredVicJob = {
      t: title,
      loc: cardField(card, 'Location') || 'Victoria',
      cat: occupation || 'Government',
      url,
      created: '',
      city: 'melbourne',
      skills: skillsForText(`${title} ${occupation}`),
      salN: parseSalary(cardField(card, 'Salary')),
      emp: cardField(card, 'Work Type') || undefined,
      level: cardField(card, 'Grade') || undefined,
    };
    (byAgency[agencyId] ||= []).push(job);
    parsed++;
  }
  return { byAgency, parsed };
}

// Total advertised jobs, from "Displaying 1 to 15 of 2050 results".
export function parseTotal(html: string): number {
  const m = html.match(/of\s*([\d,]+)\s*results/i);
  return m ? Number(m[1].replace(/[^\d]/g, '')) : 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPageOnce(page: number, signalMs = 15000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  try {
    const url = page <= 1 ? BASE : `${BASE}&page=${page}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'employsi-jobs/1.0 (+https://employsi.com; VIC gov vacancies feed)',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.includes('job-searchResult') ? html : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(page: number): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(600 * attempt);
    const html = await fetchPageOnce(page);
    if (html) return html;
  }
  return null;
}

export interface VicGovResult {
  updated: string;
  total: number;
  lastPage: number;
  startPage: number;
  pagesOk: number;
  parsed: number;
  byAgency: Record<string, StoredVicJob[]>;
}

// Fetch page 1 (for the grand total + its own jobs) plus a contiguous window of
// `windowPages` further pages starting at `startPage`. The caller advances the
// window each run so full per-agency coverage accumulates across the day.
export async function fetchVicGovPages(today: string, startPage: number, windowPages: number): Promise<VicGovResult | null> {
  const first = await fetchPage(1);
  if (!first) return null;

  const total = parseTotal(first);
  const lastPage = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PER_PAGE)));
  const byAgency: Record<string, StoredVicJob[]> = {};
  let parsed = 0;
  let pagesOk = 0;
  const merge = (res: { byAgency: Record<string, StoredVicJob[]>; parsed: number }) => {
    for (const [id, jobs] of Object.entries(res.byAgency)) {
      for (const j of jobs) j.seen = today;
      (byAgency[id] ||= []).push(...jobs);
    }
    parsed += res.parsed;
    pagesOk++;
  };
  merge(parseVicGovPage(first));

  const start = Math.max(2, startPage);
  for (let k = 0; k < windowPages; k++) {
    const p = start + k;
    if (p < 2 || p > lastPage) continue;
    await sleep(300);
    const html = await fetchPage(p);
    if (!html) continue;
    merge(parseVicGovPage(html));
  }
  return { updated: today, total, lastPage, startPage: start, pagesOk, parsed, byAgency };
}
