// Singapore vacancies feed — MyCareersFuture.
//
// MyCareersFuture (mycareersfuture.gov.sg) is Singapore's official national
// jobs board, run by Workforce Singapore. It exposes a clean public JSON search
// API (no anti-bot), so this is the Singapore market feed — real, ToS-clean
// government data — replacing the Adzuna 'sg' sample for the Singapore hub.
//
// Each result carries title, employer, monthly salary band, job category,
// employment type, real skills, a canonical listing URL and the posting date.

import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';

const API = 'https://api.mycareersfuture.gov.sg/v2/search';

// The cron's StoredJob shape (kept in sync with index.ts) so these flow through
// the same KV write + D1 archive path as the Adzuna / Jooble hub samples.
export interface McfJob {
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
  salN?: number;
}

const stripHtml = (s: string) => (s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

// Monthly SGD band → an annualised midpoint (×12), for salary aggregation.
function annualSalary(sal: any): number | undefined {
  const lo = Number(sal?.minimum);
  const hi = Number(sal?.maximum);
  const vals = [lo, hi].filter((n) => Number.isFinite(n) && n > 0);
  if (!vals.length) return undefined;
  const monthly = vals.reduce((a, b) => a + b, 0) / vals.length;
  // Board salaries are monthly unless stated Annual/Hourly; treat monthly as ×12.
  const type = String(sal?.type?.salaryType || 'Monthly').toLowerCase();
  const factor = type.includes('annual') ? 1 : type.includes('hour') ? 2080 : 12;
  return Math.round(monthly * factor);
}

function salaryText(sal: any): string | undefined {
  const lo = Number(sal?.minimum);
  const hi = Number(sal?.maximum);
  if (!Number.isFinite(lo) || lo <= 0) return undefined;
  const per = String(sal?.type?.salaryType || 'Monthly').toLowerCase().includes('annual') ? '/yr' : '/mo';
  const fmt = (n: number) => 'S$' + Math.round(n).toLocaleString('en-US');
  return (Number.isFinite(hi) && hi > lo ? `${fmt(lo)}–${fmt(hi)}` : fmt(lo)) + per;
}

function locationOf(address: any): string {
  if (!address) return 'Singapore';
  const d = Array.isArray(address.districts) && address.districts[0];
  if (address.building) return stripHtml(String(address.building));
  if (d && d.location) return stripHtml(String(d.location));
  if (d && d.region) return `${d.region}, Singapore`;
  return 'Singapore';
}

async function fetchPage(page: number, perPage: number): Promise<any[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${API}?limit=${perPage}&page=${page}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'employsi-jobs/1.0' },
      body: JSON.stringify({ search: '', sortBy: ['new_posting_date'] }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return Array.isArray(j?.results) ? j.results : [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch the most-recently-posted Singapore vacancies as the hub sample. Returns
// [] on failure so a transient error never wipes a good prior sample.
export async function fetchMcfJobs(today: string, pages = 3, perPage = 100): Promise<McfJob[]> {
  const jobs: McfJob[] = [];
  const seen = new Set<string>();
  for (let p = 0; p < pages; p++) {
    const results = await fetchPage(p, perPage);
    if (!results) break;
    if (!results.length) break;
    for (const r of results) {
      const title = stripHtml(String(r?.title || ''));
      if (!title) continue;
      const uuid = String(r?.uuid || '');
      if (uuid && seen.has(uuid)) continue;
      if (uuid) seen.add(uuid);
      const meta = r?.metadata || {};
      const co = meta.isHideHiringEmployerName
        ? stripHtml(String(r?.postedCompany?.name || ''))
        : stripHtml(String(r?.hiringCompany?.name || r?.postedCompany?.name || ''));
      const skillNames = Array.isArray(r?.skills) ? r.skills.map((s: any) => String(s?.skill || '')).join(' ') : '';
      const cat = (Array.isArray(r?.categories) && r.categories[0]?.category) || '';
      jobs.push({
        t: title,
        loc: locationOf(r?.address),
        cat: stripHtml(String(cat)),
        url: String(meta.jobDetailsUrl || ''),
        created: String(meta.newPostingDate || '').slice(0, 10),
        city: 'singapore',
        skills: skillsForText(`${title} ${skillNames}`),
        src: 'mycareersfuture',
        co,
        sal: salaryText(r?.salary),
        salN: annualSalary(r?.salary),
      });
    }
  }
  return jobs;
}
