// Northern Territory Government jobs feed.
//
// Scrapes the official NT public-sector jobs board (jobs.nt.gov.au) and maps
// every advertised role to one of the NT gov agencies plotted in Darwin (see
// data/darwinGov.ts). Live-vacancies source for those agencies — real, ToS-clean
// public data from the government's own board.
//
// The board is a Knockout.js SPA, but its search is a plain JSON endpoint: a
// POST to /Home/Search with a (minimal) filter model returns the FULL current
// vacancy list in one response — no anti-forgery token, cookie, browser or
// paging needed. Each record carries: jobTitle, agency, section, locations,
// closingDate, remuneration range, vacancy type and an rtfId for the canonical
// job URL. So unlike the WA/VIC/QLD feeds this one fetches everything at once.

import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';
import { ntGovAgencyId, DARWIN_GOV_NAMES } from '../../src/employsi/data/darwinGov';

const ENDPOINT = 'https://jobs.nt.gov.au/Home/Search';
const SITE = 'https://jobs.nt.gov.au';

// A stored NT job — mirrors the app's AdvertisedJob shape so the company card
// renders it like any other role, plus a few gov extras.
export interface StoredNtJob {
  t: string;
  loc: string;
  cat: string;
  url: string;
  created: string; // YYYY-MM-DD the ad was added (from dateAdded)
  city: string | null; // Darwin-market (NT) roles
  skills: string[];
  salN?: number;
  emp?: string; // vacancy type
  seen?: string; // YYYY-MM-DD last seen on the board (for age-out)
}

// ── name matching ────────────────────────────────────────────────────────────
// Tolerant normalise: lowercase, drop the articles/prepositions "of"/"the" (so a
// board label like "Department Mining and Energy" still matches our roster's
// "Department of Mining and Energy"), collapse the rest to single spaces.
function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(of|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AGENCY_BY_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const name of DARWIN_GOV_NAMES) m[normName(name)] = ntGovAgencyId(name);
  return m;
})();

export function matchAgencyId(orgText: string): string | null {
  return AGENCY_BY_KEY[normName(orgText)] ?? null;
}

// "/Date(1782230419181)/" → "YYYY-MM-DD" (empty when unparseable).
function msDate(v: unknown): string {
  const m = typeof v === 'string' ? v.match(/\/Date\((\d+)/) : null;
  if (!m) return '';
  const d = new Date(Number(m[1]));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function midSalary(lo: unknown, hi: unknown): number | undefined {
  const a = Number(lo) || 0;
  const b = Number(hi) || 0;
  const nums = [a, b].filter((n) => n > 0);
  if (!nums.length) return undefined;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

// Parse the /Home/Search JSON payload into { agencyId → jobs }.
export function parseNtGov(payload: any, today: string): { byAgency: Record<string, StoredNtJob[]>; parsed: number; items: number } {
  const data: any[] = Array.isArray(payload?.data) ? payload.data : [];
  const byAgency: Record<string, StoredNtJob[]> = {};
  let parsed = 0;
  for (const r of data) {
    const title = String(r?.jobTitle || '').replace(/\s+/g, ' ').trim();
    const org = String(r?.agency || '').trim();
    if (!title || !org) continue;
    if (r?.isCanceled) continue;
    const agencyId = matchAgencyId(org);
    if (!agencyId) continue;
    const section = String(r?.section || '').trim();
    const job: StoredNtJob = {
      t: title,
      loc: String(r?.locations || '').replace(/\s+/g, ' ').trim() || 'Northern Territory',
      cat: 'Government',
      url: r?.rtfId ? `${SITE}/Home/JobDetails?rtfId=${r.rtfId}` : SITE,
      created: msDate(r?.dateAdded),
      city: 'darwin',
      skills: skillsForText(`${title} ${section}`),
      salN: midSalary(r?.lowestRemuneration, r?.highestRemuneration),
      emp: String(r?.vacancyType || '').trim() || undefined,
      seen: today,
    };
    (byAgency[agencyId] ||= []).push(job);
    parsed++;
  }
  return { byAgency, parsed, items: data.length };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOnce(signalMs = 20000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'User-Agent': 'employsi-jobs/1.0 (+https://employsi.com; NT gov vacancies feed)',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
      },
      body: JSON.stringify({ Keyword: '' }),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json && (json as any).success && Array.isArray((json as any).data) ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface NtGovResult {
  updated: string;
  total: number; // total vacancies on the board
  parsed: number; // jobs matched to one of our agencies
  byAgency: Record<string, StoredNtJob[]>;
}

// Fetch the whole NT board in one POST (retried a few times on transient error).
export async function fetchNtGov(today: string): Promise<NtGovResult | null> {
  let payload: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(700 * attempt);
    payload = await fetchOnce();
    if (payload) break;
  }
  if (!payload) return null;
  const { byAgency, parsed, items } = parseNtGov(payload, today);
  return { updated: today, total: items, parsed, byAgency };
}
