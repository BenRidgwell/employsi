// SEEK company boards — one Australian employer's full live vacancy list.
//
// SEEK (seek.com.au) is Australia's dominant jobs board. Its search API filters
// by `advertiserid` — a single employer, ALL job classifications — so one query
// returns a company's entire live board (mining, HR, finance, trades, ICT…),
// not just IT. Advertiser ids are resolved offline (scripts/gen-seek-advertisers
// .py → data/seekAdvertisers.ts), so the Worker pulls by id in a single request
// with no live name resolution.
//
// SEEK contributes on TOP of Adzuna + The Muse for each company and is
// cross-checked by normalised title in pullCompany, so a role advertised on more
// than one board is only counted once (no double counting) — exactly how The
// Muse is layered in. When SEEK is unreachable (its Cloudflare front may
// challenge the Worker's datacenter IP) the fetch simply returns [], so the
// company just keeps its Adzuna/Muse feed — SEEK degrades like the Jooble hub
// feed, never breaking the pull.
//
// This is a public read of a public search endpoint for labour-market analysis;
// it is deliberately low-volume (one page per company per run, polite UA) and
// degrades silently rather than retrying aggressively.

import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';

const API = 'https://www.seek.com.au/api/jobsearch/v5/search';
const JOB_URL = 'https://www.seek.com.au/job/';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15';
const PAGE_SIZE = 100; // SEEK caps the API page at 100
const MAX_PAGES = 3; // ≤300 ads/company — more than any single employer advertises

// The cron's StoredJob shape (kept in sync with index.ts) so SEEK jobs flow
// through the same dedupe + KV + D1 archive path as Adzuna / Muse.
export interface SeekJob {
  t: string;
  loc: string;
  cat: string;
  url: string;
  created: string;
  city: string | null;
  skills: string[];
  src: string;
  co: string;
  sal?: string;
}

const stripHtml = (s: string) =>
  (s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

const CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney'];
function matchCity(text: string): string | null {
  const t = (text || '').toLowerCase();
  for (const c of CITIES) if (t.includes(c)) return c;
  return null;
}

function parseJob(j: any, employerName: string): SeekJob | null {
  const title = stripHtml(String(j?.title || ''));
  if (!title) return null;
  const id = String(j?.id || '');
  const cls = (Array.isArray(j?.classifications) && j.classifications[0]) || {};
  const cat = stripHtml(String(cls?.classification?.description || ''));
  const locs = (Array.isArray(j?.locations) && j.locations[0]) || {};
  const loc = stripHtml(String(locs?.label || ''));
  const co = stripHtml(String(j?.companyName || j?.advertiser?.description || employerName));
  return {
    t: title,
    loc,
    cat,
    url: id ? JOB_URL + id : '',
    created: String(j?.listingDate || '').slice(0, 10),
    city: matchCity(loc) || matchCity(title),
    skills: skillsForText(title),
    src: 'seek',
    co,
    sal: stripHtml(String(j?.salaryLabel || '')) || undefined,
  };
}

async function fetchPage(advertiserId: string, page: number): Promise<{ jobs: any[]; total: number } | null> {
  const params = new URLSearchParams({
    siteKey: 'AU-Main',
    sourcesystem: 'houston',
    where: 'All Australia',
    advertiserid: advertiserId,
    page: String(page),
    pageSize: String(PAGE_SIZE),
    locale: 'en-AU',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${API}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!res.ok) return null; // 403/429 = Cloudflare challenge → SEEK stays dark this run
    const j: any = await res.json();
    return { jobs: Array.isArray(j?.data) ? j.data : [], total: Number(j?.totalCount) || 0 };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Every live SEEK listing for one advertiser id, across all classifications.
// Returns [] on any failure (unreachable / challenged), so SEEK never breaks or
// wipes a company's existing Adzuna/Muse feed — it only ever adds.
export async function fetchSeekCompanyJobs(advertiserId: string, employerName = ''): Promise<SeekJob[]> {
  if (!advertiserId) return [];
  const out: SeekJob[] = [];
  const seen = new Set<string>(); // SEEK job id, in case a listing repeats across pages
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page++) {
    const res = await fetchPage(advertiserId, page);
    if (!res) break;
    if (page === 1) {
      totalPages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));
    }
    if (!res.jobs.length) break;
    for (const raw of res.jobs) {
      const id = String(raw?.id || '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const job = parseJob(raw, employerName);
      if (job) out.push(job);
    }
  }
  return out;
}
