// Daily jobs pipeline — a dedicated Cloudflare Worker (separate from the app).
//
// On a schedule it pulls each Australian company's currently-advertised roles
// from Adzuna, maps every job to canonical skills, and writes three things to
// the shared KV namespace:
//   • roles:{id}   — daily [date, count] snapshots (the vacancy history chart)
//   • jobs:{id}    — the list of advertised jobs + their mapped skills
//   • skillidx     — aggregate skill demand by company / sector / city
//
// The roster is sharded across a few runs per day so each invocation stays well
// under Cloudflare's per-request subrequest limit and Adzuna's daily quota. The
// skill index is recomputed from the stored jobs:* each run, so it is always
// internally consistent regardless of which shard just refreshed.

import { AU_JOBS_TARGETS, type JobsTarget } from '../../src/employsi/data/auJobsTargets';
import { GLOBAL_HUB_TARGETS, type HubTarget } from '../../src/employsi/data/globalHubTargets';
import { JOOBLE_HUB_TARGETS, type JoobleHubTarget } from '../../src/employsi/data/joobleHubTargets';
import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';
import { archiveJobs, type ArchiveRow } from '../../src/employsi/lib/jobArchive';
import { fetchWaGovPages, type StoredWaJob } from './waGov';
import { PERTH_GOV_IDS } from '../../src/employsi/data/perthGov';

interface Env {
  OPEN_ROLES_HISTORY: KVNamespace;
  ADZUNA_APP_ID: string;
  ADZUNA_APP_KEY: string;
  // Jooble REST API key — covers the hubs Adzuna can't (Tokyo, Seoul, Hong
  // Kong, Dubai, Zurich, Beijing, Ganzhou). Optional: when unset those hubs are
  // simply skipped and stay dark, exactly as before.
  JOOBLE_KEY?: string;
  // The Muse public jobs API key — layered on top of Adzuna per company and
  // cross-checked so a role advertised on both boards is only counted once.
  // Optional: when unset, companies just get their Adzuna-only feed.
  THEMUSE_KEY?: string;
  // D1 database for the append-only historical job archive. Optional: when the
  // binding isn't present the archive writes are simply skipped (the KV
  // snapshots + skill index are unaffected).
  JOBS_ARCHIVE?: D1Database;
  CRON_TOKEN: string;
}

// Targets processed per invocation. AU companies (50) + Adzuna global hubs (11)
// + Jooble global hubs (7) = 68 targets; 17 per run over 4 six-hour runs covers
// the whole set about once a day, with each run issuing only ~17 API calls —
// well under Cloudflare's subrequest limit and each provider's daily quota.
const SHARD = 17;
const JOBS_PER_COMPANY = 60;
const JOBS_PER_HUB = 50;
const CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney'];

interface StoredJob {
  t: string; // title
  loc: string; // location display
  cat: string; // Adzuna category
  url: string; // apply link
  created: string; // YYYY-MM-DD
  city: string | null; // matched app city, if any
  skills: string[]; // canonical skills
  src?: string; // provider: adzuna | muse | jooble
  co?: string; // employer name from the ad (for the archive)
  sal?: string; // salary text when the source states one (for the archive)
  salN?: number; // advertised salary midpoint (annualised), for aggregation
}

const today = () => new Date().toISOString().slice(0, 10);
const stripHtml = (s: string) => (s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
// Normalise a title for cross-board dedupe (Adzuna ↔ The Muse): lowercase,
// collapse non-alphanumerics to single spaces. Same-ad titles line up.
const normTitle = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Adzuna salary band → a compact display string (for the archive), when present.
function adzunaSalary(x: any): string | undefined {
  const lo = Number(x?.salary_min);
  const hi = Number(x?.salary_max);
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0) {
    return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  }
  return undefined;
}

// Adzuna salary band → an annualised midpoint number (for aggregation).
function adzunaSalaryNum(x: any): number | undefined {
  const vals = [Number(x?.salary_min), Number(x?.salary_max)].filter((n) => Number.isFinite(n) && n > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined;
}

function matchCity(text: string): string | null {
  const t = (text || '').toLowerCase();
  for (const c of CITIES) if (t.includes(c)) return c;
  return null;
}

async function pullCompany(env: Env, target: JobsTarget): Promise<{ count: number; jobs: StoredJob[] }> {
  const params = new URLSearchParams({
    app_id: env.ADZUNA_APP_ID,
    app_key: env.ADZUNA_APP_KEY,
    what_phrase: target.name,
    where: 'Australia',
    results_per_page: '50',
    'content-type': 'application/json',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let count = 0;
  const jobs: StoredJob[] = [];
  const seenTitles = new Set<string>(); // normalised titles, for cross-board dedupe
  try {
    const res = await fetch(`https://api.adzuna.com/v1/api/jobs/au/search/1?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'employsi-jobs/1.0' },
    });
    if (res.ok) {
      const j: any = await res.json();
      count = Number(j?.count) || 0;
      const results: any[] = Array.isArray(j?.results) ? j.results : [];
      const seen = new Set<string>();
      for (const x of results) {
        const title = stripHtml(x?.title || '');
        if (!title) continue;
        const loc = x?.location?.display_name || '';
        const dedupe = (title + '|' + loc).toLowerCase();
        if (seen.has(dedupe)) continue; // Adzuna reposts the same role repeatedly
        seen.add(dedupe);
        seenTitles.add(normTitle(title));
        const area = Array.isArray(x?.location?.area) ? x.location.area.join(' ') : '';
        jobs.push({
          t: title,
          loc,
          cat: x?.category?.label || '',
          url: x?.redirect_url || '',
          created: (x?.created || '').slice(0, 10),
          city: matchCity(loc + ' ' + area) || matchCity(title),
          skills: skillsForText(title),
          src: 'adzuna',
          co: x?.company?.display_name || target.name,
          sal: adzunaSalary(x),
          salN: adzunaSalaryNum(x),
        });
        if (jobs.length >= JOBS_PER_COMPANY) break;
      }
    }
  } catch {
    /* Adzuna failed — fall through with whatever (possibly none) we have */
  } finally {
    clearTimeout(timer);
  }

  // Layer The Muse on top: add any of its Australian roles for this employer
  // that Adzuna didn't already list (cross-checked by normalised title), and
  // grow the count by only those extras so the same ad on both boards is never
  // double counted.
  if (jobs.length < JOBS_PER_COMPANY) {
    const muse = await pullMuse(env, target.name);
    let added = 0;
    for (const m of muse) {
      if (seenTitles.has(normTitle(m.t))) continue;
      seenTitles.add(normTitle(m.t));
      jobs.push(m);
      added++;
      if (jobs.length >= JOBS_PER_COMPANY) break;
    }
    count += added;
  }

  return { count, jobs };
}

// The Muse public jobs API for one employer, restricted to Australian roles.
// The `company` filter is exact-name, so most resources/finance names return
// nothing — but registered employers (typically tech / multinationals) add real
// current openings. Returns StoredJobs tagged from The Muse; skills are mapped
// through the same taxonomy as Adzuna so they aggregate identically.
async function pullMuse(env: Env, company: string): Promise<StoredJob[]> {
  if (!env.THEMUSE_KEY) return [];
  const out: StoredJob[] = [];
  for (let page = 0; page < 2; page++) {
    const params = new URLSearchParams({ api_key: env.THEMUSE_KEY, company, page: String(page) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`https://www.themuse.com/api/public/jobs?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'employsi-jobs/1.0' },
      });
      if (!res.ok) break;
      const j: any = await res.json();
      const results: any[] = Array.isArray(j?.results) ? j.results : [];
      if (!results.length) break;
      for (const r of results) {
        const title = stripHtml(r?.name || '');
        if (!title) continue;
        const locs: string[] = Array.isArray(r?.locations) ? r.locations.map((l: any) => String(l?.name || '')) : [];
        const auLoc = locs.find((l) => /australia|sydney|melbourne|perth|brisbane|adelaide|canberra/i.test(l));
        if (!auLoc) continue; // only genuine Australian roles count toward AU vacancies
        out.push({
          t: title,
          loc: auLoc,
          cat: (Array.isArray(r?.categories) && r.categories[0]?.name) || '',
          url: (r?.refs && r.refs.landing_page) || '',
          created: String(r?.publication_date || '').slice(0, 10),
          city: matchCity(auLoc) || matchCity(title),
          skills: skillsForText(title),
          src: 'muse',
          co: (r?.company && r.company.name) || company,
        });
      }
      if (page + 1 >= Number(j?.page_count || 0)) break;
    } catch {
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

async function appendCount(env: Env, id: string, count: number): Promise<void> {
  const key = `roles:${id}`;
  try {
    const raw = await env.OPEN_ROLES_HISTORY.get(key);
    let arr: [string, number][] = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    }
    const d = today();
    const last = arr[arr.length - 1];
    if (last && last[0] === d) last[1] = count;
    else arr.push([d, count]);
    if (arr.length > 365) arr = arr.slice(arr.length - 365);
    await env.OPEN_ROLES_HISTORY.put(key, JSON.stringify(arr));
  } catch {
    /* best effort */
  }
}

// Whole-market city sample for a global hub: the current advertised roles in
// that city, mapped to skills. Used to show where skills are in demand
// worldwide (the AU cities get their demand from company data instead).
async function pullHub(env: Env, target: HubTarget): Promise<StoredJob[]> {
  const params = new URLSearchParams({
    app_id: env.ADZUNA_APP_ID,
    app_key: env.ADZUNA_APP_KEY,
    where: target.where,
    results_per_page: String(JOBS_PER_HUB),
    'content-type': 'application/json',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://api.adzuna.com/v1/api/jobs/${target.country}/search/1?${params.toString()}`,
      { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'employsi-jobs/1.0' } },
    );
    if (!res.ok) return [];
    const j: any = await res.json();
    const results: any[] = Array.isArray(j?.results) ? j.results : [];
    const seen = new Set<string>();
    const jobs: StoredJob[] = [];
    for (const x of results) {
      const title = stripHtml(x?.title || '');
      if (!title) continue;
      const loc = x?.location?.display_name || '';
      const dedupe = (title + '|' + loc).toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      jobs.push({
        t: title,
        loc,
        cat: x?.category?.label || '',
        url: x?.redirect_url || '',
        created: (x?.created || '').slice(0, 10),
        city: target.hub,
        skills: skillsForText(title),
        src: 'adzuna',
        co: x?.company?.display_name || '',
        sal: adzunaSalary(x),
        salN: adzunaSalaryNum(x),
      });
    }
    return jobs;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Same whole-market city sample as pullHub, but via Jooble's REST API for the
// hubs Adzuna doesn't operate in. Jooble has one endpoint keyed on the API key;
// the market is chosen by the free-text `location`. Empty keywords requests the
// broad market feed for that city. Returns [] (hub stays dark) when the key is
// unset or the call fails, so it degrades exactly like the Adzuna feed.
async function pullJoobleHub(env: Env, target: JoobleHubTarget): Promise<StoredJob[]> {
  if (!env.JOOBLE_KEY) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://jooble.org/api/${env.JOOBLE_KEY}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'employsi-jobs/1.0' },
      body: JSON.stringify({ keywords: '', location: target.location, ResultOnPage: JOBS_PER_HUB, page: 1 }),
    });
    if (!res.ok) return [];
    const j: any = await res.json();
    const results: any[] = Array.isArray(j?.jobs) ? j.jobs : [];
    const seen = new Set<string>();
    const jobs: StoredJob[] = [];
    for (const x of results) {
      const title = stripHtml(x?.title || '');
      if (!title) continue;
      const loc = stripHtml(x?.location || '');
      const dedupe = (title + '|' + loc).toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      jobs.push({
        t: title,
        loc,
        cat: stripHtml(x?.type || ''), // Jooble's `type` (e.g. Full-time) — no category taxonomy
        url: x?.link || '',
        created: (x?.updated || '').slice(0, 10),
        city: target.hub,
        skills: skillsForText(title),
        src: 'jooble',
        co: stripHtml(x?.company || ''),
        sal: stripHtml(x?.salary || '') || undefined,
      });
    }
    return jobs;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

interface SkillAgg {
  total: number;
  byCompany: Record<string, number>;
  bySector: Record<string, number>;
  byCity: Record<string, number>;
}
interface SkillIndex {
  updated: string;
  totalJobs: number;
  skills: Record<string, SkillAgg>;
}

// Rebuild the aggregate index from every stored jobs:{id}. Cheap KV reads keep
// the index consistent no matter which shard was just refreshed.
async function recomputeIndex(env: Env): Promise<SkillIndex> {
  const skills: Record<string, SkillAgg> = {};
  let totalJobs = 0;
  const agg = (skill: string): SkillAgg => (skills[skill] ||= { total: 0, byCompany: {}, bySector: {}, byCity: {} });
  const byId: Record<string, JobsTarget> = Object.fromEntries(AU_JOBS_TARGETS.map((t) => [t.id, t]));

  for (const t of AU_JOBS_TARGETS) {
    const raw = await env.OPEN_ROLES_HISTORY.get(`jobs:${t.id}`);
    if (!raw) continue;
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const jobs: StoredJob[] = Array.isArray(data?.jobs) ? data.jobs : [];
    const meta = byId[t.id];
    for (const job of jobs) {
      totalJobs++;
      const city = job.city || meta.cities[0];
      for (const sk of job.skills || []) {
        const a = agg(sk);
        a.total++;
        a.byCompany[t.id] = (a.byCompany[t.id] || 0) + 1;
        a.bySector[meta.group] = (a.bySector[meta.group] || 0) + 1;
        a.byCity[city] = (a.byCity[city] || 0) + 1;
      }
    }
  }

  // Global hubs: whole-market city samples contribute to byCity only (they are
  // not company- or sector-attributed), so the global heatmap lights up real
  // demand outside Australia. Adzuna hubs and Jooble hubs share the hubjobs:*
  // key namespace, so the two feeds aggregate identically.
  const hubIds = [...GLOBAL_HUB_TARGETS.map((h) => h.hub), ...JOOBLE_HUB_TARGETS.map((h) => h.hub)];
  for (const hub of hubIds) {
    const raw = await env.OPEN_ROLES_HISTORY.get(`hubjobs:${hub}`);
    if (!raw) continue;
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const jobs: StoredJob[] = Array.isArray(data?.jobs) ? data.jobs : [];
    for (const job of jobs) {
      totalJobs++;
      for (const sk of job.skills || []) {
        const a = agg(sk);
        a.total++;
        a.byCity[hub] = (a.byCity[hub] || 0) + 1;
      }
    }
  }
  return { updated: today(), totalJobs, skills };
}

// The full rotation: AU companies (queried by name), Adzuna global hubs and
// Jooble global hubs (both queried as city-market samples). The cursor walks
// this combined list shard by shard.
type AnyTarget =
  | { kind: 'company'; t: JobsTarget }
  | { kind: 'hub'; t: HubTarget }
  | { kind: 'jhub'; t: JoobleHubTarget };
const ALL_TARGETS: AnyTarget[] = [
  ...AU_JOBS_TARGETS.map((t) => ({ kind: 'company' as const, t })),
  ...GLOBAL_HUB_TARGETS.map((t) => ({ kind: 'hub' as const, t })),
  ...JOOBLE_HUB_TARGETS.map((t) => ({ kind: 'jhub' as const, t })),
];

// Map a pulled batch of StoredJobs to archive rows, carrying the company id
// (company-scoped pulls) or hub (whole-market samples) through.
function toArchiveRows(jobs: StoredJob[], ctx: { companyId?: string; hub?: string }): ArchiveRow[] {
  return jobs.map((j) => ({
    source: j.src || 'adzuna',
    title: j.t,
    company: j.co || null,
    companyId: ctx.companyId ?? null,
    hub: ctx.hub ?? j.city ?? null,
    location: j.loc,
    category: j.cat,
    salary: j.sal ?? null,
    url: j.url,
    posted: j.created,
    skills: j.skills,
  }));
}

async function processShard(env: Env): Promise<{ processed: string[]; totalJobs: number }> {
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get('cron:cursor');
  const cursor = Number(cursorRaw) || 0;
  const n = ALL_TARGETS.length;
  const slice: AnyTarget[] = [];
  for (let i = 0; i < SHARD && i < n; i++) slice.push(ALL_TARGETS[(cursor + i) % n]);

  const day = today();
  for (const item of slice) {
    if (item.kind === 'company') {
      const { count, jobs } = await pullCompany(env, item.t);
      if (count > 0) await appendCount(env, item.t.id, count);
      await env.OPEN_ROLES_HISTORY.put(
        `jobs:${item.t.id}`,
        JSON.stringify({ updated: day, count, jobs }),
      );
      await archiveJobs(env.JOBS_ARCHIVE, toArchiveRows(jobs, { companyId: item.t.id }), day);
    } else if (item.kind === 'hub') {
      const jobs = await pullHub(env, item.t);
      await env.OPEN_ROLES_HISTORY.put(
        `hubjobs:${item.t.hub}`,
        JSON.stringify({ updated: day, jobs }),
      );
      await archiveJobs(env.JOBS_ARCHIVE, toArchiveRows(jobs, { hub: item.t.hub }), day);
    } else {
      const jobs = await pullJoobleHub(env, item.t);
      // Only overwrite when we actually got a sample, so a transient Jooble
      // failure (or a not-yet-set key) doesn't wipe a good prior sample.
      if (jobs.length) {
        await env.OPEN_ROLES_HISTORY.put(
          `hubjobs:${item.t.hub}`,
          JSON.stringify({ updated: day, jobs }),
        );
        await archiveJobs(env.JOBS_ARCHIVE, toArchiveRows(jobs, { hub: item.t.hub }), day);
      }
    }
  }

  const idx = await recomputeIndex(env);
  await env.OPEN_ROLES_HISTORY.put('skillidx', JSON.stringify(idx));
  await env.OPEN_ROLES_HISTORY.put('cron:cursor', String((cursor + SHARD) % n));
  return { processed: slice.map((s) => (s.kind === 'company' ? s.t.id : s.t.hub)), totalJobs: idx.totalJobs };
}

// ── WA Government jobs feed ────────────────────────────────────────────────
// A StoredWaJob → historical archive row (source "wa-gov").
function waJobToArchive(j: StoredWaJob, agencyId: string): ArchiveRow {
  return {
    source: 'wa-gov',
    title: j.t,
    company: null,
    companyId: agencyId,
    hub: 'perth',
    location: j.loc,
    category: j.cat,
    salary: j.salN ? `$${Math.round(j.salN / 1000)}k` : null,
    url: j.url,
    posted: j.created || null,
    skills: j.skills,
  };
}

// Scrape the WA public-sector jobs board and refresh the live-vacancies feed for
// every one of the 62 gov agencies. For each agency we write:
//   • wagov:{id}  — { updated, count, jobs } consumed by the company card
//   • roles:{id}  — the daily [date, count] history (vacancy chart)
//   • the D1 archive rows (source "wa-gov")
// Agencies with no current vacancies get an explicit count 0 + empty list, so
// the card shows a real "no live vacancies" rather than a stale figure.
const WAGOV_WINDOW = 10; // pages fetched per run beyond page 1 (WAF-safe slice)
const WAGOV_MAX_AGE_DAYS = 4; // drop a stored listing not re-seen on the board within this

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

// Merge this run's freshly-scraped listings for one agency with what's already
// stored: keyed by URL so a listing seen again just refreshes its `seen` date,
// new listings are added, and any stored listing not seen on the board within
// WAGOV_MAX_AGE_DAYS is aged out (it's been taken down). This is what lets a
// WAF-limited slice per run accumulate into full attribute coverage over the day
// without ever accumulating stale, removed ads.
function mergeAgencyJobs(prev: StoredWaJob[], fresh: StoredWaJob[], day: string): StoredWaJob[] {
  const byUrl = new Map<string, StoredWaJob>();
  for (const j of prev) {
    if (!j?.url) continue;
    if (j.seen && daysBetween(j.seen, day) > WAGOV_MAX_AGE_DAYS) continue; // aged out
    byUrl.set(j.url, j);
  }
  for (const j of fresh) {
    if (!j?.url) continue;
    byUrl.set(j.url, { ...j, seen: day }); // fresh wins, marks last-seen = today
  }
  return [...byUrl.values()].slice(0, 80);
}

async function processWaGov(env: Env): Promise<{ total: number; startPage: number; pagesOk: number; parsed: number; agencies: number; nextCursor: number }> {
  const day = today();
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get('wagov:cursor');
  const start = Math.max(2, Number(cursorRaw) || 2);
  const res = await fetchWaGovPages(day, start, WAGOV_WINDOW);
  if (!res) return { total: 0, startPage: start, pagesOk: 0, parsed: 0, agencies: 0, nextCursor: start };

  let withRoles = 0;
  for (const id of PERTH_GOV_IDS) {
    const fresh = res.byAgency[id] || [];
    // Authoritative live count from the board's own facet (always exact).
    const count = res.counts[id] ?? fresh.length;
    // Accumulate attributes across runs, ageing out taken-down listings.
    let prevJobs: StoredWaJob[] = [];
    try {
      const prevRaw = await env.OPEN_ROLES_HISTORY.get(`wagov:${id}`);
      const prev = prevRaw ? JSON.parse(prevRaw) : null;
      if (Array.isArray(prev?.jobs)) prevJobs = prev.jobs;
    } catch {
      /* start fresh */
    }
    const jobs = mergeAgencyJobs(prevJobs, fresh, day);
    await env.OPEN_ROLES_HISTORY.put(
      `wagov:${id}`,
      JSON.stringify({ updated: day, count, jobs }),
    );
    if (count > 0) {
      await appendCount(env, id, count);
      withRoles++;
    }
    if (fresh.length) {
      await archiveJobs(env.JOBS_ARCHIVE, fresh.map((j) => waJobToArchive(j, id)), day);
    }
  }

  // Advance the page cursor so the next run reads the next slice; wrap back to
  // page 2 once the whole board has been walked.
  let next = start + WAGOV_WINDOW;
  if (next > res.lastPage) next = 2;
  await env.OPEN_ROLES_HISTORY.put('wagov:cursor', String(next));

  return { total: res.total, startPage: start, pagesOk: res.pagesOk, parsed: res.parsed, agencies: withRoles, nextCursor: next };
}

export default {
  // Scheduled: the WA-gov scrape runs on its own cron minute (:30) so it gets a
  // clean subrequest budget for ~40 page fetches; every other tick advances the
  // Adzuna/Muse/Jooble shard rotation.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron && event.cron.startsWith('30 ')) {
      ctx.waitUntil(processWaGov(env).then(() => undefined));
    } else {
      ctx.waitUntil(processShard(env).then(() => undefined));
    }
  },

  // Manual triggers for seeding / verification (token-gated):
  //   /run?token=…        → one Adzuna/Muse/Jooble shard
  //   /run-wagov?token=…  → a full WA-gov board scrape + feed refresh
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/run') {
      if (url.searchParams.get('token') !== env.CRON_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      const out = await processShard(env);
      return Response.json({ ok: true, ...out });
    }
    if (url.pathname === '/run-wagov') {
      if (url.searchParams.get('token') !== env.CRON_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      try {
        const out = await processWaGov(env);
        return Response.json({ ok: true, ...out });
      } catch (e) {
        return Response.json(
          { ok: false, error: (e as Error)?.message || String(e), stack: (e as Error)?.stack || '' },
          { status: 500 },
        );
      }
    }
    return new Response('employsi jobs-cron', { status: 200 });
  },
};
