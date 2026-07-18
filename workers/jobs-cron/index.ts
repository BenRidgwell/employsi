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
import { skillsForText } from '../../src/employsi/data/skillsTaxonomy';

interface Env {
  OPEN_ROLES_HISTORY: KVNamespace;
  ADZUNA_APP_ID: string;
  ADZUNA_APP_KEY: string;
  CRON_TOKEN: string;
}

// Companies processed per invocation. 4 runs/day × 13 ≈ the full 50-company
// roster once daily, with each run issuing only ~13 Adzuna calls.
const SHARD = 13;
const JOBS_PER_COMPANY = 60;
const CITIES = ['perth', 'adelaide', 'brisbane', 'melbourne', 'sydney'];

interface StoredJob {
  t: string; // title
  loc: string; // location display
  cat: string; // Adzuna category
  url: string; // apply link
  created: string; // YYYY-MM-DD
  city: string | null; // matched app city, if any
  skills: string[]; // canonical skills
}

const today = () => new Date().toISOString().slice(0, 10);
const stripHtml = (s: string) => (s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

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
  try {
    const res = await fetch(`https://api.adzuna.com/v1/api/jobs/au/search/1?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'employsi-jobs/1.0' },
    });
    if (!res.ok) return { count: 0, jobs: [] };
    const j: any = await res.json();
    const count = Number(j?.count) || 0;
    const results: any[] = Array.isArray(j?.results) ? j.results : [];
    const seen = new Set<string>();
    const jobs: StoredJob[] = [];
    for (const x of results) {
      const title = stripHtml(x?.title || '');
      if (!title) continue;
      const loc = x?.location?.display_name || '';
      const dedupe = (title + '|' + loc).toLowerCase();
      if (seen.has(dedupe)) continue; // Adzuna reposts the same role repeatedly
      seen.add(dedupe);
      const area = Array.isArray(x?.location?.area) ? x.location.area.join(' ') : '';
      jobs.push({
        t: title,
        loc,
        cat: x?.category?.label || '',
        url: x?.redirect_url || '',
        created: (x?.created || '').slice(0, 10),
        city: matchCity(loc + ' ' + area) || matchCity(title),
        skills: skillsForText(title),
      });
      if (jobs.length >= JOBS_PER_COMPANY) break;
    }
    return { count, jobs };
  } catch {
    return { count: 0, jobs: [] };
  } finally {
    clearTimeout(timer);
  }
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
  return { updated: today(), totalJobs, skills };
}

async function processShard(env: Env): Promise<{ processed: string[]; totalJobs: number }> {
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get('cron:cursor');
  const cursor = Number(cursorRaw) || 0;
  const n = AU_JOBS_TARGETS.length;
  const slice: JobsTarget[] = [];
  for (let i = 0; i < SHARD && i < n; i++) slice.push(AU_JOBS_TARGETS[(cursor + i) % n]);

  for (const t of slice) {
    const { count, jobs } = await pullCompany(env, t);
    if (count > 0) await appendCount(env, t.id, count);
    await env.OPEN_ROLES_HISTORY.put(
      `jobs:${t.id}`,
      JSON.stringify({ updated: today(), count, jobs }),
    );
  }

  const idx = await recomputeIndex(env);
  await env.OPEN_ROLES_HISTORY.put('skillidx', JSON.stringify(idx));
  await env.OPEN_ROLES_HISTORY.put('cron:cursor', String((cursor + SHARD) % n));
  return { processed: slice.map((s) => s.id), totalJobs: idx.totalJobs };
}

export default {
  // Scheduled: process the next shard of companies.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processShard(env).then(() => undefined));
  },

  // Manual trigger for seeding / verification: /run?token=CRON_TOKEN
  // Each call processes one shard, so call it a few times to cover the roster.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/run') {
      if (url.searchParams.get('token') !== env.CRON_TOKEN) {
        return new Response('forbidden', { status: 403 });
      }
      const out = await processShard(env);
      return Response.json({ ok: true, ...out });
    }
    return new Response('employsi jobs-cron', { status: 200 });
  },
};
