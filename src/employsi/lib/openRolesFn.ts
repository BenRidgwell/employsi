import { createServerFn } from '@tanstack/react-start';

// Live "open roles" count for Australian companies, fetched on the Worker.
//
// SEEK and Indeed can't be used: both hard-block server/datacenter IPs (403)
// and their terms prohibit scraping. Instead we use two ToS-clean sources:
//   1. A per-company ATS feed override (Workday / Greenhouse / Lever /
//      SmartRecruiters JSON) — real numbers straight from the employer, for the
//      companies whose exact ATS slug has been verified (see AU_ATS below).
//   2. Adzuna's official Australian jobs API as the broad fallback for everyone
//      else. Needs ADZUNA_APP_ID + ADZUNA_APP_KEY as Worker secrets; without
//      them this returns null and the card keeps its illustrative figure.

export interface OpenRoles {
  count: number;
  source: string; // e.g. "Adzuna", "Workday"
}

const cache = new Map<string, { at: number; data: OpenRoles | null }>();
const TTL = 60 * 60 * 1000;

function adzunaCreds(): { id: string; key: string } | null {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  return id && key ? { id, key } : null;
}

async function fetchJson(url: string, ms: number): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'employsi/1.0', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Direct ATS feeds ──────────────────────────────────────────────────────
// Verified per-company job feeds. Keyed by the company id used in the app.
// Each entry names an ATS and the exact slug/tenant needed to hit its public
// JSON endpoint. Add entries only after confirming the endpoint returns jobs.
type AtsEntry =
  | { ats: 'greenhouse'; slug: string }
  | { ats: 'lever'; slug: string }
  | { ats: 'smartrecruiters'; slug: string }
  | { ats: 'workday'; host: string; tenant: string; site: string };

const AU_ATS: Record<string, AtsEntry> = {
  // e.g. sydney company on Greenhouse:
  //   'sydney-XYZ': { ats: 'greenhouse', slug: 'xyz' },
  // Populated as feeds are verified; empty entries just fall through to Adzuna.
};

async function fromAts(entry: AtsEntry): Promise<OpenRoles | null> {
  if (entry.ats === 'greenhouse') {
    const j = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs`, 6000);
    const jobs: any[] = Array.isArray(j?.jobs) ? j.jobs : [];
    const au = jobs.filter((x) => /austral|sydney|melbourne|perth|brisbane|adelaide|canberra/i.test(x?.location?.name || ''));
    return jobs.length ? { count: au.length || jobs.length, source: 'Greenhouse' } : null;
  }
  if (entry.ats === 'lever') {
    const j = await fetchJson(`https://api.lever.co/v0/postings/${entry.slug}?mode=json`, 6000);
    const jobs: any[] = Array.isArray(j) ? j : [];
    const au = jobs.filter((x) => /austral|sydney|melbourne|perth|brisbane|adelaide/i.test(x?.categories?.location || ''));
    return jobs.length ? { count: au.length || jobs.length, source: 'Lever' } : null;
  }
  if (entry.ats === 'smartrecruiters') {
    const j = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${entry.slug}/postings?limit=100&country=au`, 6000);
    const total = Number(j?.totalFound);
    return Number.isFinite(total) && total >= 0 ? { count: total, source: 'SmartRecruiters' } : null;
  }
  // workday
  const url = `https://${entry.host}/wday/cxs/${entry.tenant}/${entry.site}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'employsi/1.0' },
      body: JSON.stringify({ limit: 1, offset: 0, searchText: '', appliedFacets: {} }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    const total = Number(j?.total);
    return Number.isFinite(total) ? { count: total, source: 'Workday' } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fromAdzuna(company: string): Promise<OpenRoles | null> {
  const c = adzunaCreds();
  if (!c) return null;
  const params = new URLSearchParams({
    app_id: c.id,
    app_key: c.key,
    what_phrase: company,
    where: 'Australia',
    results_per_page: '1',
    'content-type': 'application/json',
  });
  const j = await fetchJson(`https://api.adzuna.com/v1/api/jobs/au/search/1?${params.toString()}`, 6000);
  const count = Number(j?.count);
  // Only treat a positive count as live data. A 0 (or a missing/errored
  // response) almost always means Adzuna doesn't index this employer under
  // that name rather than a true zero, so we fall through and let the card
  // keep its illustrative figure instead of showing a misleading "0 · live".
  return Number.isFinite(count) && count > 0 ? { count, source: 'Adzuna' } : null;
}

export const getOpenRoles = createServerFn({ method: 'GET' })
  .validator((data: { company: string; id?: string }) => data)
  .handler(async ({ data }): Promise<OpenRoles | null> => {
    const company = (data.company || '').trim();
    if (!company) return null;
    const key = `${data.id || ''}::${company.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.data;

    let out: OpenRoles | null = null;
    // 1. Direct employer ATS feed where we have a verified one.
    const ats = data.id ? AU_ATS[data.id] : undefined;
    if (ats) out = await fromAts(ats);
    // 2. Otherwise the Adzuna aggregator.
    if (!out) out = await fromAdzuna(company);

    cache.set(key, { at: Date.now(), data: out });
    return out;
  });
