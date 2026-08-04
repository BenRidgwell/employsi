// Daily jobs pipeline — a dedicated Cloudflare Worker (separate from the app).
//
// On a schedule it pulls each Australian company's currently-advertised roles
// from Adzuna — layered with The Muse and the company's full SEEK board (all
// classifications), cross-checked by title so a role on more than one board is
// counted once — maps every job to canonical skills, and writes three things to
// the shared KV namespace:
//   • roles:{id}   — daily [date, count] snapshots (the vacancy history chart)
//   • jobs:{id}    — the list of advertised jobs + their mapped skills
//   • skillidx     — aggregate skill demand by company / sector / city
//
// The roster is sharded across a few runs per day so each invocation stays well
// under Cloudflare's per-request subrequest limit and Adzuna's daily quota. The
// skill index is recomputed from the stored jobs:* each run, so it is always
// internally consistent regardless of which shard just refreshed.

import {
  AU_JOBS_TARGETS as AU_LISTED,
  type JobsTarget,
} from "../../src/employsi/data/auJobsTargets";
import { TOP_PRIVATE_TARGETS } from "../../src/employsi/data/topPrivateCompanies";

// The listed (ASX) roster plus the Top-150 private companies — both driven by
// the same daily Adzuna pull, so private-company cards get live vacancies and
// contribute to the skill-demand heat index like any listed name.
const AU_JOBS_TARGETS: JobsTarget[] = [...AU_LISTED, ...TOP_PRIVATE_TARGETS];
import { GLOBAL_HUB_TARGETS, type HubTarget } from "../../src/employsi/data/globalHubTargets";
import { JOOBLE_HUB_TARGETS, type JoobleHubTarget } from "../../src/employsi/data/joobleHubTargets";
import { skillsForText } from "../../src/employsi/data/skillsTaxonomy";
import { archiveJobs, type ArchiveRow } from "../../src/employsi/lib/jobArchive";
import { fetchWaGovPages, type StoredWaJob } from "./waGov";
import { fetchVicGovPages, type StoredVicJob } from "./vicGov";
import { fetchQldGovPages, type StoredQldJob } from "./qldGov";
import { fetchNtGov, type StoredNtJob } from "./ntGov";
import { fetchTasGov, type StoredTasJob } from "./tasGov";
import { processNews, NEWS_PARTS } from "./news";
import { processPortals, fetchPortal, portalToArchive, SITES } from "./careerSites";
import { checkAdvertiser } from "./advertiser";
import { queryPhrases } from "./companyQueries";
import { fetchMcfJobs } from "./mycareersfuture";
import { fetchSeekCompanyJobs } from "./seek";
import { SEEK_ADVERTISERS } from "../../src/employsi/data/seekAdvertisers";
import { PERTH_GOV_IDS } from "../../src/employsi/data/perthGov";
import { MELBOURNE_GOV_IDS } from "../../src/employsi/data/melbourneGov";
import { BRISBANE_GOV_IDS } from "../../src/employsi/data/brisbaneGov";
import { DARWIN_GOV_IDS } from "../../src/employsi/data/darwinGov";
import { HOBART_GOV_IDS } from "../../src/employsi/data/hobartGov";
import {
  asRecord,
  asRecords,
  str,
  type JsonRecord,
  type JsonValue,
} from "../../src/employsi/lib/json";

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
  // SEEK's Cloudflare front 403-challenges requests originating from Cloudflare
  // Workers (a Cloudflare-to-Cloudflare fingerprint), so the in-Worker SEEK pull
  // returns nothing and is OFF by default. The SEEK feed instead runs from a
  // non-Cloudflare host (scripts/seek-to-d1.py) straight into D1. Set this to
  // '1' only if the Worker is ever routed through a residential proxy that SEEK
  // will serve. Keeps seek.ts + seekAdvertisers wired for that day.
  SEEK_VIA_WORKER?: string;
  CRON_TOKEN: string;
}

// Targets processed per invocation.
//
// This number and the number of ticks together set how often ANY given company
// is refreshed, and the two drifted badly apart. The original comment read
// "AU companies (50) … 17 per run over 4 six-hour runs covers the whole set
// about once a day", and that was true of a 50-company roster. The roster is
// now 355 (the ASX 200 plus the Top-150 private list), and only ONE of the six
// six-hourly crons reaches processShard — the other five are claimed by the gov
// branches that match on a minute prefix. So the real rotation had become
// 4 x 17 = 68 companies a day, or 5.2 DAYS per full pass.
//
// Nothing failed; every company just went stale for days at a time, which is
// how The Muse's feed came to look broken (its only matching employer,
// Computershare, simply had not come round since its last turn).
//
// The fix is MORE TICKS, and the shard size is deliberately UNCHANGED.
//
// 45 per run was tried first and measured: cancelled mid-way with "waitUntil()
// tasks did not complete within the allowed time", having written 36 of its 45.
// 25 was tried next and was also cancelled. The binding constraint is
// wall-clock inside waitUntil, not the subrequest count — the same limit that
// forced Woolworths into three separate page windows — and 17 is the only size
// with a production track record of completing.
//
// So 17 stays, and coverage comes from running it more often: 6 crons x 4 runs
// a day x 17 = 408 refreshes a day against a 355-company roster, i.e. daily
// again, restoring what the original comment claimed. See `crons` in
// wrangler.jsonc for the six minutes and why none of them collides.
const SHARD = 17;
const JOBS_PER_COMPANY = 60;
const JOBS_PER_HUB = 50;
const CITIES = ["perth", "adelaide", "brisbane", "melbourne", "sydney"];

interface StoredJob {
  t: string; // title
  loc: string; // location display
  cat: string; // Adzuna category
  url: string; // apply link
  created: string; // YYYY-MM-DD
  city: string | null; // matched app city, if any
  skills: string[]; // canonical skills
  src?: string; // provider: adzuna | muse | jooble | seek
  co?: string; // employer name from the ad (for the archive)
  sal?: string; // salary text when the source states one (for the archive)
  salN?: number; // advertised salary midpoint (annualised), for aggregation
}

const today = () => new Date().toISOString().slice(0, 10);
const stripHtml = (s: string) =>
  (s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
// Normalise a title for cross-board dedupe (Adzuna ↔ The Muse): lowercase,
// collapse non-alphanumerics to single spaces. Same-ad titles line up.
const normTitle = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Adzuna salary band → a compact display string (for the archive), when present.
function adzunaSalary(x: JsonRecord): string | undefined {
  const lo = Number(x?.salary_min);
  const hi = Number(x?.salary_max);
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0) {
    return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  }
  return undefined;
}

// Adzuna salary band → an annualised midpoint number (for aggregation).
function adzunaSalaryNum(x: JsonRecord): number | undefined {
  const vals = [Number(x?.salary_min), Number(x?.salary_max)].filter(
    (n) => Number.isFinite(n) && n > 0,
  );
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined;
}

function matchCity(text: string): string | null {
  const t = (text || "").toLowerCase();
  for (const c of CITIES) if (t.includes(c)) return c;
  return null;
}

async function pullCompany(
  env: Env,
  target: JobsTarget,
): Promise<{ count: number; jobs: StoredJob[] }> {
  let count = 0;
  const jobs: StoredJob[] = [];
  const seenTitles = new Set<string>(); // normalised titles, for cross-board dedupe
  const seen = new Set<string>(); // title|location, across ALL phrases

  // Usually one phrase — the company's own name. A holding company also gets
  // its operating businesses' names, because that is who its ads are placed
  // under (see ./companyQueries.ts; SGH advertises as Boral, WesTrac, Coates).
  // The dedupe sets are shared across phrases so a role that matches two of
  // them is stored once, and `count` adds only what each phrase newly brings.
  for (const phrase of queryPhrases(target.id, target.name)) {
    if (jobs.length >= JOBS_PER_COMPANY) break;
    const params = new URLSearchParams({
      app_id: env.ADZUNA_APP_ID,
      app_key: env.ADZUNA_APP_KEY,
      what_phrase: phrase,
      where: "Australia",
      results_per_page: "50",
      "content-type": "application/json",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `https://api.adzuna.com/v1/api/jobs/au/search/1?${params.toString()}`,
        {
          signal: controller.signal,
          headers: { Accept: "application/json", "User-Agent": "employsi-jobs/1.0" },
        },
      );
      if (res.ok) {
        const j = await res.json();
        const results = asRecords(asRecord(j).results);
        for (const x of results) {
          const title = stripHtml(x?.title || "");
          if (!title) continue;
          const loc = x?.location?.display_name || "";
          const dedupe = (title + "|" + loc).toLowerCase();
          if (seen.has(dedupe)) continue; // Adzuna reposts the same role repeatedly
          seen.add(dedupe);
          seenTitles.add(normTitle(title));
          // Adzuna's keyword search returns anything matching the phrase, and the
          // display name is the only evidence of who actually placed the ad. An
          // unverifiable one is skipped rather than filed under this company —
          // see ./advertiser.ts for why this rejects rather than allowlists.
          const advertiser = x?.company?.display_name || "";
          const verdict = checkAdvertiser(advertiser, target, AU_JOBS_TARGETS, phrase);
          if (!verdict.keep) {
            console.log(`adzuna ${target.id}: dropped — ${verdict.reason}`);
            continue;
          }
          const area = Array.isArray(x?.location?.area) ? x.location.area.join(" ") : "";
          jobs.push({
            t: title,
            loc,
            cat: x?.category?.label || "",
            url: x?.redirect_url || "",
            created: (x?.created || "").slice(0, 10),
            city: matchCity(loc + " " + area) || matchCity(title),
            skills: skillsForText(title),
            src: "adzuna",
            co: advertiser || phrase,
            sal: adzunaSalary(x),
            salN: adzunaSalaryNum(x),
          });
          if (jobs.length >= JOBS_PER_COMPANY) break;
        }
        // Adzuna's `count` is how many ads match the phrase in total, not how
        // many we kept — it always was an upper bound, and that is unchanged.
        // Summing it across phrases is safe here because the phrases are
        // DIFFERENT employers (Boral, WesTrac, Coates), so an ad matching two
        // of them is vanishingly rare. It would not be safe for phrases that
        // are variants of one name, which is why companyQueries.ts says to list
        // operating businesses rather than spellings.
        count += Number(j?.count) || 0;
      }
    } catch {
      /* Adzuna failed for this phrase — keep whatever the others returned */
    } finally {
      clearTimeout(timer);
    }
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

  // Layer SEEK on top: a company's full SEEK board (every classification, not
  // just IT), adding only roles Adzuna/Muse didn't already list — cross-checked
  // by normalised title so a job advertised on more than one board is counted
  // once. Keyed on the offline-resolved advertiser id; companies without one (no
  // current SEEK ads) contribute nothing, exactly like an unmatched Muse name.
  // SEEK returning [] (unreachable / challenged) simply adds nothing this run.
  if (env.SEEK_VIA_WORKER === "1" && jobs.length < JOBS_PER_COMPANY) {
    const adv = SEEK_ADVERTISERS[target.id];
    if (adv) {
      const seek = await fetchSeekCompanyJobs(adv.advertiserId, adv.name);
      let added = 0;
      for (const s of seek) {
        if (seenTitles.has(normTitle(s.t))) continue;
        seenTitles.add(normTitle(s.t));
        jobs.push(s);
        added++;
        if (jobs.length >= JOBS_PER_COMPANY) break;
      }
      count += added;
    }
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
        headers: { Accept: "application/json", "User-Agent": "employsi-jobs/1.0" },
      });
      if (!res.ok) break;
      const j = await res.json();
      const results = asRecords(asRecord(j).results);
      if (!results.length) break;
      for (const r of results) {
        const title = stripHtml(r?.name || "");
        if (!title) continue;
        const locs: string[] = Array.isArray(r?.locations)
          ? asRecords(r.locations).map((l) => str(l.name))
          : [];
        const auLoc = locs.find((l) =>
          /australia|sydney|melbourne|perth|brisbane|adelaide|canberra/i.test(l),
        );
        if (!auLoc) continue; // only genuine Australian roles count toward AU vacancies
        out.push({
          t: title,
          loc: auLoc,
          cat: (Array.isArray(r?.categories) && r.categories[0]?.name) || "",
          url: (r?.refs && r.refs.landing_page) || "",
          created: String(r?.publication_date || "").slice(0, 10),
          city: matchCity(auLoc) || matchCity(title),
          skills: skillsForText(title),
          src: "muse",
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
    "content-type": "application/json",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://api.adzuna.com/v1/api/jobs/${target.country}/search/1?${params.toString()}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "employsi-jobs/1.0" },
      },
    );
    if (!res.ok) return [];
    const j = await res.json();
    const results = asRecords(asRecord(j).results);
    const seen = new Set<string>();
    const jobs: StoredJob[] = [];
    for (const x of results) {
      const title = stripHtml(x?.title || "");
      if (!title) continue;
      const loc = x?.location?.display_name || "";
      const dedupe = (title + "|" + loc).toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      jobs.push({
        t: title,
        loc,
        cat: x?.category?.label || "",
        url: x?.redirect_url || "",
        created: (x?.created || "").slice(0, 10),
        city: target.hub,
        skills: skillsForText(title),
        src: "adzuna",
        co: x?.company?.display_name || "",
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
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "employsi-jobs/1.0",
      },
      body: JSON.stringify({
        keywords: "",
        location: target.location,
        ResultOnPage: JOBS_PER_HUB,
        page: 1,
      }),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const results = asRecords(asRecord(j).jobs);
    const seen = new Set<string>();
    const jobs: StoredJob[] = [];
    for (const x of results) {
      const title = stripHtml(x?.title || "");
      if (!title) continue;
      const loc = stripHtml(x?.location || "");
      const dedupe = (title + "|" + loc).toLowerCase();
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      jobs.push({
        t: title,
        loc,
        cat: stripHtml(x?.type || ""), // Jooble's `type` (e.g. Full-time) — no category taxonomy
        url: x?.link || "",
        created: (x?.updated || "").slice(0, 10),
        city: target.hub,
        skills: skillsForText(title),
        src: "jooble",
        co: stripHtml(x?.company || ""),
        sal: stripHtml(x?.salary || "") || undefined,
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
  const agg = (skill: string): SkillAgg =>
    (skills[skill] ||= { total: 0, byCompany: {}, bySector: {}, byCity: {} });
  const byId: Record<string, JobsTarget> = Object.fromEntries(
    AU_JOBS_TARGETS.map((t) => [t.id, t]),
  );

  // The heat map is "who is hiring this skill NOW, by volume". The stored
  // jobs:{id} list is ALREADY the company's currently-advertised ads (pullCompany
  // replaces it with the live Adzuna/Muse listings every run, so filled ads age
  // out on their own). So every stored job counts — an extra posting-date cutoff
  // was double-filtering and undercounting companies whose live ads have been up
  // a while (e.g. BHP reading amber while its card showed far more roles).

  for (const t of AU_JOBS_TARGETS) {
    const raw = await env.OPEN_ROLES_HISTORY.get(`jobs:${t.id}`);
    if (!raw) continue;
    let data: unknown;
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
  // Singapore's hub sample comes from MyCareersFuture (not the Adzuna hub list),
  // so include it explicitly so the global heatmap still lights up Singapore.
  const hubIds = [
    ...GLOBAL_HUB_TARGETS.map((h) => h.hub),
    ...JOOBLE_HUB_TARGETS.map((h) => h.hub),
    "singapore",
  ];
  for (const hub of hubIds) {
    const raw = await env.OPEN_ROLES_HISTORY.get(`hubjobs:${hub}`);
    if (!raw) continue;
    let data: unknown;
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

// Map a pulled batch of StoredJobs to archive rows, carrying the company id
// (company-scoped pulls) or hub (whole-market samples) through.
function toArchiveRows(jobs: StoredJob[], ctx: { companyId?: string; hub?: string }): ArchiveRow[] {
  return jobs.map((j) => ({
    source: j.src || "adzuna",
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

// The global-hub samples (Adzuna hubs + Jooble hubs) are only 18 targets but
// they drive the worldwide skill heatmap and the historical archive for every
// non-AU city. They're refreshed on EVERY run — not sharded in with the 205 AU
// companies, which would push the tail (Jooble) to a ~3-day cadence — so all 18
// hubs, Jooble included, stay current and keep flowing into KV + D1 each tick.
async function processHubs(env: Env, day: string): Promise<void> {
  for (const t of GLOBAL_HUB_TARGETS) {
    const jobs = await pullHub(env, t);
    if (jobs.length) {
      await env.OPEN_ROLES_HISTORY.put(`hubjobs:${t.hub}`, JSON.stringify({ updated: day, jobs }));
      await archiveJobs(env.JOBS_ARCHIVE, toArchiveRows(jobs, { hub: t.hub }), day);
    }
  }
  for (const t of JOOBLE_HUB_TARGETS) {
    const jobs = await pullJoobleHub(env, t);
    // Only overwrite when we actually got a sample, so a transient Jooble
    // failure (or a not-yet-set key) doesn't wipe a good prior sample.
    if (jobs.length) {
      await env.OPEN_ROLES_HISTORY.put(`hubjobs:${t.hub}`, JSON.stringify({ updated: day, jobs }));
      await archiveJobs(env.JOBS_ARCHIVE, toArchiveRows(jobs, { hub: t.hub }), day);
    }
  }

  // Singapore's national board (MyCareersFuture) — the authoritative SG feed,
  // owning the singapore hub sample + archive (source "mycareersfuture").
  const sg = await fetchMcfJobs(day);
  if (sg.length) {
    await env.OPEN_ROLES_HISTORY.put(
      "hubjobs:singapore",
      JSON.stringify({ updated: day, jobs: sg }),
    );
    await archiveJobs(
      env.JOBS_ARCHIVE,
      toArchiveRows(sg as StoredJob[], { hub: "singapore" }),
      day,
    );
  }
}

async function processShard(env: Env): Promise<{ processed: string[]; totalJobs: number }> {
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get("cron:cursor");
  const cursor = Number(cursorRaw) || 0;
  const companies = AU_JOBS_TARGETS;
  const n = companies.length;
  const day = today();

  // Advance the cursor FIRST, not after the walk.
  //
  // It used to be written at the very end, which meant a run cancelled by the
  // waitUntil deadline never advanced it — so the next run re-walked the same
  // slice, and the rotation stalled on a shard it could not finish rather than
  // moving past it. A stalled rotation starves every company after it
  // indefinitely, which is far worse than one slice being a day late.
  //
  // Advancing up front makes a cancelled run cost exactly what it should: the
  // companies it did not reach simply wait for their next turn.
  await env.OPEN_ROLES_HISTORY.put("cron:cursor", String((cursor + SHARD) % n));

  // A shard of AU companies (queried by name).
  const processed: string[] = [];
  for (let i = 0; i < SHARD && i < n; i++) {
    const t = companies[(cursor + i) % n];
    const { count, jobs } = await pullCompany(env, t);
    if (count > 0) await appendCount(env, t.id, count);
    await env.OPEN_ROLES_HISTORY.put(`jobs:${t.id}`, JSON.stringify({ updated: day, count, jobs }));
    await archiveJobs(env.JOBS_ARCHIVE, toArchiveRows(jobs, { companyId: t.id }), day);
    processed.push(t.id);
  }

  // All global hubs (Adzuna + Jooble) every run, so none go stale at the tail.
  await processHubs(env, day);

  const idx = await recomputeIndex(env);
  await env.OPEN_ROLES_HISTORY.put("skillidx", JSON.stringify(idx));
  return { processed, totalJobs: idx.totalJobs };
}

// ── WA Government jobs feed ────────────────────────────────────────────────
// A StoredWaJob → historical archive row (source "wa-gov").
function waJobToArchive(j: StoredWaJob, agencyId: string): ArchiveRow {
  return {
    source: "wa-gov",
    title: j.t,
    company: null,
    companyId: agencyId,
    hub: "perth",
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
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
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

async function processWaGov(env: Env): Promise<{
  total: number;
  startPage: number;
  pagesOk: number;
  parsed: number;
  agencies: number;
  nextCursor: number;
}> {
  const day = today();
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get("wagov:cursor");
  const start = Math.max(2, Number(cursorRaw) || 2);
  const res = await fetchWaGovPages(day, start, WAGOV_WINDOW);
  if (!res)
    return { total: 0, startPage: start, pagesOk: 0, parsed: 0, agencies: 0, nextCursor: start };

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
    await env.OPEN_ROLES_HISTORY.put(`wagov:${id}`, JSON.stringify({ updated: day, count, jobs }));
    if (count > 0) {
      await appendCount(env, id, count);
      withRoles++;
    }
    if (fresh.length) {
      await archiveJobs(
        env.JOBS_ARCHIVE,
        fresh.map((j) => waJobToArchive(j, id)),
        day,
      );
    }
  }

  // Advance the page cursor so the next run reads the next slice; wrap back to
  // page 2 once the whole board has been walked.
  let next = start + WAGOV_WINDOW;
  if (next > res.lastPage) next = 2;
  await env.OPEN_ROLES_HISTORY.put("wagov:cursor", String(next));

  return {
    total: res.total,
    startPage: start,
    pagesOk: res.pagesOk,
    parsed: res.parsed,
    agencies: withRoles,
    nextCursor: next,
  };
}

// ── VIC & QLD Government jobs feeds ────────────────────────────────────────
// Both boards are server-rendered no-browser feeds (see vicGov.ts / qldGov.ts),
// walked in a paged window per run that accumulates full per-agency coverage
// across the day — the same shape as WA, minus WA's per-agency facet (neither
// board exposes one), so a count is the merged live-listing total per agency.
const VICGOV_WINDOW = 20; // pages fetched per run beyond page 1
const QLDGOV_WINDOW = 20; // result pages fetched per run
const GOV_MAX_AGE_DAYS = 4;

function govJobToArchive(
  j: { t: string; loc: string; cat: string; url: string; created: string; salN?: number },
  source: string,
  hub: string,
  agencyId: string,
  skills: string[],
): ArchiveRow {
  return {
    source,
    title: j.t,
    company: null,
    companyId: agencyId,
    hub,
    location: j.loc,
    category: j.cat,
    salary: j.salN ? `$${Math.round(j.salN / 1000)}k` : null,
    url: j.url,
    posted: j.created || null,
    skills,
  };
}

// Merge a run's freshly-scraped listings for one agency with what's stored:
// keyed by URL (falling back to title when a board omits the URL), refreshing
// last-seen, adding new, ageing out anything not re-seen within GOV_MAX_AGE_DAYS.
function mergeGovJobs<T extends { url?: string; t?: string; seen?: string }>(
  prev: T[],
  fresh: T[],
  day: string,
): T[] {
  const byKey = new Map<string, T>();
  const keyOf = (j: T) => (j.url && j.url.length ? j.url : `t:${j.t || ""}`);
  for (const j of prev) {
    if (j.seen && daysBetween(j.seen, day) > GOV_MAX_AGE_DAYS) continue;
    byKey.set(keyOf(j), j);
  }
  for (const j of fresh) {
    // The fresh row wins field by field, but ONLY for fields it actually has.
    // A blind `{...j}` discarded anything the board withholds from its search
    // page and we had learned some other way — which is what silently undid
    // TAS's salary enrichment: a job page fetched on Monday gave us a salary,
    // Tuesday's search page re-listed the same job with none, and the overwrite
    // threw it away. Every run re-learned and re-lost the same figures.
    const before = byKey.get(keyOf(j));
    const merged = { ...(before ?? ({} as T)) } as Record<string, unknown>;
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== "") merged[k] = v;
    }
    merged.seen = day;
    byKey.set(keyOf(j), merged as T);
  }
  return [...byKey.values()].slice(0, 80);
}

async function processVicGov(env: Env): Promise<{
  total: number;
  startPage: number;
  pagesOk: number;
  parsed: number;
  agencies: number;
  nextCursor: number;
}> {
  const day = today();
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get("vicgov:cursor");
  const start = Math.max(2, Number(cursorRaw) || 2);
  const res = await fetchVicGovPages(day, start, VICGOV_WINDOW);
  if (!res)
    return { total: 0, startPage: start, pagesOk: 0, parsed: 0, agencies: 0, nextCursor: start };

  let withRoles = 0;
  for (const id of MELBOURNE_GOV_IDS) {
    const fresh = res.byAgency[id] || [];
    let prevJobs: StoredVicJob[] = [];
    try {
      const prevRaw = await env.OPEN_ROLES_HISTORY.get(`vicgov:${id}`);
      const prev = prevRaw ? JSON.parse(prevRaw) : null;
      if (Array.isArray(prev?.jobs)) prevJobs = prev.jobs;
    } catch {
      /* start fresh */
    }
    const jobs = mergeGovJobs(prevJobs, fresh, day);
    const count = jobs.length;
    await env.OPEN_ROLES_HISTORY.put(`vicgov:${id}`, JSON.stringify({ updated: day, count, jobs }));
    if (count > 0) {
      await appendCount(env, id, count);
      withRoles++;
    }
    if (fresh.length) {
      await archiveJobs(
        env.JOBS_ARCHIVE,
        fresh.map((j) => govJobToArchive(j, "vic-gov", "melbourne", id, j.skills)),
        day,
      );
    }
  }

  let next = start + VICGOV_WINDOW;
  if (next > res.lastPage) next = 2;
  await env.OPEN_ROLES_HISTORY.put("vicgov:cursor", String(next));
  return {
    total: res.total,
    startPage: start,
    pagesOk: res.pagesOk,
    parsed: res.parsed,
    agencies: withRoles,
    nextCursor: next,
  };
}

async function processQldGov(env: Env): Promise<{
  startOffset: number;
  pagesOk: number;
  parsed: number;
  agencies: number;
  nextCursor: number;
}> {
  const day = today();
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get("qldgov:cursor");
  const start = Math.max(0, Number(cursorRaw) || 0);
  const res = await fetchQldGovPages(day, start, QLDGOV_WINDOW);
  if (!res) {
    // A whole window that fetched nothing normally means the board was
    // unreachable, so the cursor is held and the same window retried. But if
    // that keeps happening deep into the walk it is indistinguishable from a
    // cursor stranded past the end of the board — which is exactly how this
    // source went silent for three days. Rewinding to the start costs one
    // wasted window and makes the stall self-healing.
    const nextCursor = start > 0 ? 0 : start;
    if (nextCursor !== start) await env.OPEN_ROLES_HISTORY.put("qldgov:cursor", "0");
    return { startOffset: start, pagesOk: 0, parsed: 0, agencies: 0, nextCursor };
  }

  // 55 agencies, each needing a KV read, a KV write and possibly an archive
  // write. Serially that is over 150 round trips and was the other half of why
  // this run outgrew its waitUntil budget. Bounded parallelism keeps every
  // agency processed while cutting the wall time to a fraction.
  let withRoles = 0;
  const AGENCY_CONCURRENCY = 8;
  for (let i = 0; i < BRISBANE_GOV_IDS.length; i += AGENCY_CONCURRENCY) {
    const slice = BRISBANE_GOV_IDS.slice(i, i + AGENCY_CONCURRENCY);
    const counts = await Promise.all(
      slice.map(async (id) => {
        const fresh = res.byAgency[id] || [];
        let prevJobs: StoredQldJob[] = [];
        try {
          const prevRaw = await env.OPEN_ROLES_HISTORY.get(`qldgov:${id}`);
          const prev = prevRaw ? JSON.parse(prevRaw) : null;
          if (Array.isArray(prev?.jobs)) prevJobs = prev.jobs;
        } catch {
          /* start fresh */
        }
        const jobs = mergeGovJobs(prevJobs, fresh, day);
        const count = jobs.length;
        await env.OPEN_ROLES_HISTORY.put(
          `qldgov:${id}`,
          JSON.stringify({ updated: day, count, jobs }),
        );
        if (count > 0) await appendCount(env, id, count);
        if (fresh.length) {
          await archiveJobs(
            env.JOBS_ARCHIVE,
            fresh.map((j) => govJobToArchive(j, "qld-gov", "brisbane", id, j.skills)),
            day,
          );
        }
        return count;
      }),
    );
    withRoles += counts.filter((c) => c > 0).length;
  }

  // Advance the offset window; wrap to the start of the board once fully walked.
  const next = res.reachedEnd ? 0 : start + QLDGOV_WINDOW * 20;
  await env.OPEN_ROLES_HISTORY.put("qldgov:cursor", String(next));
  return {
    startOffset: start,
    pagesOk: res.pagesOk,
    parsed: res.parsed,
    agencies: withRoles,
    nextCursor: next,
  };
}

// NT gov: the whole board comes back in one POST, so unlike WA/VIC/QLD there's no
// paging window — every NT agency is refreshed on every run.
async function processNtGov(
  env: Env,
): Promise<{ total: number; parsed: number; agencies: number }> {
  const day = today();
  const res = await fetchNtGov(day);
  if (!res) return { total: 0, parsed: 0, agencies: 0 };

  let withRoles = 0;
  for (const id of DARWIN_GOV_IDS) {
    const fresh = res.byAgency[id] || [];
    let prevJobs: StoredNtJob[] = [];
    try {
      const prevRaw = await env.OPEN_ROLES_HISTORY.get(`ntgov:${id}`);
      const prev = prevRaw ? JSON.parse(prevRaw) : null;
      if (Array.isArray(prev?.jobs)) prevJobs = prev.jobs;
    } catch {
      /* start fresh */
    }
    // A single fetch sees the whole board, so an agency with no fresh jobs today
    // genuinely has none live — age its stored list out rather than keep stale
    // roles around (mergeGovJobs drops entries not seen recently).
    const jobs = mergeGovJobs(prevJobs, fresh, day);
    const count = jobs.length;
    await env.OPEN_ROLES_HISTORY.put(`ntgov:${id}`, JSON.stringify({ updated: day, count, jobs }));
    if (count > 0) {
      await appendCount(env, id, count);
      withRoles++;
    }
    if (fresh.length) {
      await archiveJobs(
        env.JOBS_ARCHIVE,
        fresh.map((j) => govJobToArchive(j, "nt-gov", "darwin", id, j.skills)),
        day,
      );
    }
  }
  return { total: res.total, parsed: res.parsed, agencies: withRoles };
}

async function processTasGov(env: Env): Promise<{ parsed: number; agencies: number }> {
  const day = today();
  // Salaries captured on earlier runs, so enrichDetails skips those jobs and
  // spends its bounded detail-fetch budget on ones we have never priced. Read
  // before the fetch on purpose: doing it after, as this used to, meant the
  // enrichment could never see them.
  const knownSalaries = new Map<string, number>();
  for (const id of HOBART_GOV_IDS) {
    try {
      const raw = await env.OPEN_ROLES_HISTORY.get(`tasgov:${id}`);
      const prev = raw ? JSON.parse(raw) : null;
      if (Array.isArray(prev?.jobs))
        for (const j of prev.jobs as StoredTasJob[])
          if (j.url && j.salN) knownSalaries.set(j.url, j.salN);
    } catch {
      /* a missing or corrupt snapshot just means nothing is known yet */
    }
  }
  const res = await fetchTasGov(day, knownSalaries);
  if (!res) return { parsed: 0, agencies: 0 };

  let withRoles = 0;
  for (const id of HOBART_GOV_IDS) {
    const fresh = res.byAgency[id] || [];
    let prevJobs: StoredTasJob[] = [];
    try {
      const prevRaw = await env.OPEN_ROLES_HISTORY.get(`tasgov:${id}`);
      const prev = prevRaw ? JSON.parse(prevRaw) : null;
      if (Array.isArray(prev?.jobs)) prevJobs = prev.jobs;
    } catch {
      /* start fresh */
    }
    // fetchTasGov only returns non-null when the board was reachable, so an
    // agency with no fresh jobs today genuinely has none live — age its stored
    // list out (mergeGovJobs drops entries not re-seen recently).
    const jobs = mergeGovJobs(prevJobs, fresh, day);
    const count = jobs.length;
    await env.OPEN_ROLES_HISTORY.put(`tasgov:${id}`, JSON.stringify({ updated: day, count, jobs }));
    if (count > 0) {
      await appendCount(env, id, count);
      withRoles++;
    }
    if (fresh.length) {
      await archiveJobs(
        env.JOBS_ARCHIVE,
        fresh.map((j) => govJobToArchive(j, "tas-gov", "hobart", id, j.skills)),
        day,
      );
    }
  }
  return { parsed: res.parsed, agencies: withRoles };
}

// The four nightly news ticks → which slice of the roster each one takes.
// Employer career portals — one nightly tick per PORTAL_GROUPS slice
// (see careerSites.ts). Split because some portals page shallowly (HSBC hands
// back 10 roles a request over ~1,500; Macquarie 9 over ~500), so walking all
// thirteen in one invocation would put a few hundred sequential fetches behind
// a single cron. Seven slices now, 04:20 through 05:25.
const PORTAL_TICKS: Record<string, number> = {
  "20 4 * * *": 0,
  "25 4 * * *": 1,
  "35 4 * * *": 2,
  "55 4 * * *": 3,
  // The seven portals added later — see the note on PORTAL_GROUPS for why
  // Coles and Woolworths get ticks largely to themselves.
  "5 5 * * *": 4,
  "15 5 * * *": 5,
  "25 5 * * *": 6,
  // The thirteen after those — see PORTAL_GROUPS for why the SuccessFactors
  // sites are spread rather than packed.
  "35 5 * * *": 7,
  "45 5 * * *": 8,
  "55 5 * * *": 9,
  "5 6 * * *": 10,
  // Woolworths, three page windows on three ticks — see PORTAL_GROUPS.
  "15 6 * * *": 11,
  "25 6 * * *": 12,
  "35 6 * * *": 13,
  // Groups 14-23. These are the boards added through 2026-08 — ResMed, APA,
  // The Lottery Corporation, BlueScope's four feeds, St John of God, Medibank,
  // Gold Corporation, Lynas, Pilbara Minerals, ALS, Charter Hall, Vicinity,
  // Reece, Ramsay AU+UK, ASX, Orica, GPT, Newmont, James Hardie, Xero, Ampol,
  // NextDC, carsales, MinRes and Sonic HealthPlus.
  //
  // They were added to SITES and PORTAL_GROUPS but NOT here and not to
  // `crons`, so they had no tick to run on and never fetched once: D1 held
  // zero portal- rows for any of them, against 14 groups' worth of rows
  // written daily. This is the exact failure the PORTAL_GROUPS comment warns
  // about — SITES, PORTAL_GROUPS, PORTAL_TICKS and `crons` must all move
  // together, and a group with no tick fails silently because nothing errors:
  // the scheduler simply never calls it.
  "45 6 * * *": 14,
  "55 6 * * *": 15,
  "5 7 * * *": 16,
  "15 7 * * *": 17,
  "25 7 * * *": 18,
  "35 7 * * *": 19,
  "45 7 * * *": 20,
  "55 7 * * *": 21,
  "5 8 * * *": 22,
  "15 8 * * *": 23,
  // Groups 24-26, added with the 2026-08 boards. SITES, PORTAL_GROUPS,
  // PORTAL_TICKS and `crons` must all move together — a group with no tick
  // never fetches and nothing errors, which is how thirteen feeds sat idle.
  "35 8 * * *": 24,
  "45 8 * * *": 25,
  "55 8 * * *": 26,
  // Group 27 — Qube, Mirvac, Mercury NZ, BGC. 09:05 rather than another minute
  // in the 08 hour because the 08 hour is now full: 5, 15, 35, 45 and 55 are
  // all taken, and a duplicate key here is silent (the later one just wins)
  // while a duplicate in `crons` is rejected by Cloudflare at deploy.
  "5 9 * * *": 27,
  // Groups 28-29 — the 2026-08-03 batch. Endeavour Group is the deepest walk
  // in the file after Woolworths (561 roles at 48 a page), so it leads its own
  // tick; Harvey Norman leads the other because its board rations faceted
  // searches and a crowded tick would cost it rows without erroring.
  "15 9 * * *": 28,
  "25 9 * * *": 29,
  // Groups 30-31 — the 2026-08-03 five. Worley alone on :35 because its PCSX
  // API pages ten at a time over 1,116 positions; Downer, Cleanaway, AMP and
  // IGO share :45.
  "35 9 * * *": 30,
  "45 9 * * *": 31,
  // Group 32 — Sims, Telix (three boards) and a2 Milk. All small, one tick.
  "55 9 * * *": 32,
};

const NEWS_TICKS: Record<string, number> = {
  "40 3 * * *": 0,
  "50 3 * * *": 1,
  "0 4 * * *": 2,
  "10 4 * * *": 3,
};

export default {
  // Scheduled: the WA-gov scrape runs on its own cron minute (:30) so it gets a
  // clean subrequest budget for ~40 page fetches; every other tick advances the
  // Adzuna/Muse/Jooble shard rotation.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The portal and news ticks are matched FIRST, by exact expression. The gov
    // branches below match on a minute PREFIX, and "50 3 * * *" starts with
    // "50 " — so checked in the other order the 03:50 news slice would silently
    // run the TAS-gov scrape instead. An exact match is the more specific rule
    // and has to win. (The portal minutes 20/25/35 were picked to miss every
    // gov prefix — 5, 15, 30, 45, 50 — for the same reason.)
    if (event.cron && PORTAL_TICKS[event.cron] !== undefined) {
      ctx.waitUntil(
        processPortals(
          env,
          (rows, day) => archiveJobs(env.JOBS_ARCHIVE, rows, day),
          PORTAL_TICKS[event.cron],
        ).then(() => undefined),
      );
    } else if (event.cron && NEWS_TICKS[event.cron] !== undefined) {
      // Every company every night, split over four ticks ten minutes apart so
      // no single invocation approaches the subrequest budget — see news.ts.
      ctx.waitUntil(
        processNews(
          env,
          AU_JOBS_TARGETS.map((t) => t.name),
          NEWS_TICKS[event.cron],
          NEWS_PARTS,
        ).then(() => undefined),
      );
    } else if (event.cron && event.cron.startsWith("30 ")) {
      ctx.waitUntil(processWaGov(env).then(() => undefined));
    } else if (event.cron && event.cron.startsWith("15 ")) {
      ctx.waitUntil(processVicGov(env).then(() => undefined));
    } else if (event.cron && event.cron.startsWith("45 ")) {
      ctx.waitUntil(processQldGov(env).then(() => undefined));
    } else if (event.cron && event.cron.startsWith("5 ")) {
      ctx.waitUntil(processNtGov(env).then(() => undefined));
    } else if (event.cron && event.cron.startsWith("50 ")) {
      ctx.waitUntil(processTasGov(env).then(() => undefined));
    } else {
      ctx.waitUntil(processShard(env).then(() => undefined));
    }
  },

  // Manual triggers for seeding / verification (token-gated):
  //   /run?token=…        → one Adzuna/Muse/Jooble shard
  //   /run-wagov?token=…  → a full WA-gov board scrape + feed refresh
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/run") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const out = await processShard(env);
        return Response.json({ ok: true, ...out });
      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: (e as Error)?.message || String(e),
            stack: (e as Error)?.stack || "",
          },
          { status: 500 },
        );
      }
    }
    // Seed / verify the career-portal pull on demand — same reason as the news
    // trigger below: the nightly tick is otherwise the only writer.
    if (url.pathname === "/run-portals") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        // ?group=N runs one nightly slice; omitted, it walks every portal.
        const g = url.searchParams.get("group");
        const out = await processPortals(
          env,
          (rows, day) => archiveJobs(env.JOBS_ARCHIVE, rows, day),
          g == null ? undefined : Number(g),
        );
        return Response.json({ ok: true, sites: out });
      } catch (e) {
        return Response.json(
          { ok: false, error: (e as Error)?.message || String(e) },
          { status: 500 },
        );
      }
    }
    // Seed / verify the news store on demand — the nightly tick is otherwise
    // the only thing that writes it, so there is no way to check it without
    // waiting for 03:40 UTC.
    if (url.pathname === "/run-news") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        // ?part=N&parts=M to run one slice; default runs the whole roster.
        const part = Number(url.searchParams.get("part") || 0);
        const parts = Number(url.searchParams.get("parts") || 1);
        const out = await processNews(
          env,
          AU_JOBS_TARGETS.map((t) => t.name),
          part,
          parts,
        );
        return Response.json({
          ok: true,
          refreshed: out.refreshed.length,
          empty: out.empty.length,
          emptyNames: out.empty.slice(0, 20),
        });
      } catch (e) {
        return Response.json(
          { ok: false, error: (e as Error)?.message || String(e) },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/run-wagov") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const out = await processWaGov(env);
        return Response.json({ ok: true, ...out });
      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: (e as Error)?.message || String(e),
            stack: (e as Error)?.stack || "",
          },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/run-vicgov") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const out = await processVicGov(env);
        return Response.json({ ok: true, ...out });
      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: (e as Error)?.message || String(e),
            stack: (e as Error)?.stack || "",
          },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/run-qldgov") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const out = await processQldGov(env);
        return Response.json({ ok: true, ...out });
      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: (e as Error)?.message || String(e),
            stack: (e as Error)?.stack || "",
          },
          { status: 500 },
        );
      }
    }
    // Skill-gap report: the sustainable "add new skills where there's no match"
    // mechanism. Every source writes skills into D1 (NULL when a title mapped to
    // no canonical skill), so the unmapped titles already sit in the archive.
    // This groups them by a normalised title-head and returns the most common
    // gaps, so the ontology (skillsTaxonomy.ts) can be grown from real demand.
    // Re-archiving backfills skills (the upsert COALESCEs a NULL to the new map),
    // so a gap closed in the taxonomy heals on the next scrape.
    if (url.pathname === "/run-ntgov") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const out = await processNtGov(env);
        return Response.json({ ok: true, ...out });
      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: (e as Error)?.message || String(e),
            stack: (e as Error)?.stack || "",
          },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/run-tasgov") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const out = await processTasGov(env);
        return Response.json({ ok: true, ...out });
      } catch (e) {
        return Response.json(
          {
            ok: false,
            error: (e as Error)?.message || String(e),
            stack: (e as Error)?.stack || "",
          },
          { status: 500 },
        );
      }
    }
    if (url.pathname === "/skill-gaps") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      try {
        const limit = Math.min(2000, Math.max(50, Number(url.searchParams.get("scan")) || 1000));
        const res = await env.JOBS_ARCHIVE.prepare(
          `SELECT title, source FROM jobs
             WHERE skills IS NULL AND last_seen >= date('now', '-45 days')
             ORDER BY last_seen DESC LIMIT ?1`,
        )
          .bind(limit)
          .all();
        const rows: Array<{ title: string; source: string }> = res?.results ?? [];
        const heads: Record<string, { n: number; sources: Record<string, number> }> = {};
        for (const r of rows) {
          // "Senior Policy Officer, Reform" → "senior policy officer"
          const head = String(r.title || "")
            .replace(/&amp;/g, "&")
            .split(/[,\-–(|/]/)[0]
            .toLowerCase()
            .replace(/\b(senior|principal|lead|junior|assistant|graduate|trainee)\b/g, "")
            .replace(/[^a-z0-9 ]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          if (!head) continue;
          const e = (heads[head] ||= { n: 0, sources: {} });
          e.n++;
          e.sources[r.source] = (e.sources[r.source] || 0) + 1;
        }
        const top = Object.entries(heads)
          .sort((a, b) => b[1].n - a[1].n)
          .slice(0, 60)
          .map(([head, v]) => ({ head, count: v.n, sources: v.sources }));
        return Response.json({ ok: true, scanned: rows.length, unmappedHeads: top });
      } catch (e) {
        return Response.json(
          { ok: false, error: (e as Error)?.message || String(e) },
          { status: 500 },
        );
      }
    }
    // Reachability probe for the SEEK feed: confirms the search API answers from
    // the Worker's IP (its Cloudflare front may challenge datacenter IPs even
    // though it answers elsewhere) and shows the deduped sample for one company.
    //   /diag-seek?token=…&id=bhp
    // Run ONE portal's parser from the Worker and report what it got, without
    // writing anything. Some boards serve the Worker a different page from the
    // one a developer sees — Ampol returns 49 job links to a build sandbox and
    // 145 to a Cloudflare egress — so a parser written locally can look correct
    // and still be fitted to markup the cron never receives. This is how such a
    // parser gets verified against the page that actually matters.
    //
    // `site` is matched against the configured feed keys, never used to build a
    // URL, so this cannot be pointed at an arbitrary host.
    if (url.pathname === "/diag-portal") {
      // Gated on CRON_TOKEN, the same secret as every other diagnostic route
      // here. It originally had a DIAG_TOKEN of its own, which was one secret
      // to rotate for no benefit — and worse, it was declared optional and read
      // through a cast, so if it were ever unset the comparison became
      // `undefined !== undefined`, the guard passed, and the route was open to
      // anyone. CRON_TOKEN is a required binding, so that state cannot arise.
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      const key = url.searchParams.get("site") || "";
      const site = SITES.find((s) => (s.key ?? s.id) === key);
      if (!site) {
        return Response.json(
          { ok: false, error: "unknown site key", known: SITES.map((s) => s.key ?? s.id) },
          { status: 404 },
        );
      }
      try {
        const jobs = await fetchPortal(site);
        const rows = portalToArchive(jobs, site);
        return Response.json({
          ok: true,
          site: key,
          platform: site.platform,
          rows: rows.length,
          withTitle: rows.filter((r) => (r.title || "").trim()).length,
          withLocation: rows.filter((r) => r.location).length,
          sample: rows.slice(0, 3).map((r) => ({ t: r.title, loc: r.location, hub: r.hub })),
        });
      } catch (e) {
        return Response.json({ ok: false, site: key, error: String(e).slice(0, 200) });
      }
    }

    if (url.pathname === "/diag-seek") {
      if (url.searchParams.get("token") !== env.CRON_TOKEN) {
        return new Response("forbidden", { status: 403 });
      }
      const id = url.searchParams.get("id") || "bhp";
      const adv = SEEK_ADVERTISERS[id];
      if (!adv)
        return Response.json(
          { ok: false, id, error: "no SEEK advertiser mapped for this id" },
          { status: 404 },
        );
      // raw=1 exposes exactly what SEEK returns to the Worker IP (status,
      // content-type, body snippet) so a soft block (200 + challenge/empty) is
      // distinguishable from a genuine no-vacancies result.
      if (url.searchParams.get("raw") === "1") {
        const params = new URLSearchParams({
          siteKey: "AU-Main",
          sourcesystem: "houston",
          where: "All Australia",
          advertiserid: adv.advertiserId,
          page: "1",
          pageSize: "100",
          locale: "en-AU",
        });
        try {
          const r = await fetch(
            `https://www.seek.com.au/api/jobsearch/v5/search?${params.toString()}`,
            {
              headers: {
                Accept: "application/json",
                "User-Agent":
                  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
              },
            },
          );
          const body = await r.text();
          let totalCount: number | null = null;
          try {
            totalCount = Number(JSON.parse(body)?.totalCount);
          } catch {
            /* not json */
          }
          return Response.json({
            id,
            advertiserId: adv.advertiserId,
            status: r.status,
            contentType: r.headers.get("content-type"),
            cfRay: r.headers.get("cf-ray"),
            cfMitigated: r.headers.get("cf-mitigated"),
            len: body.length,
            totalCount,
            snippet: body.slice(0, 300),
          });
        } catch (e) {
          return Response.json(
            { id, rawError: (e as Error)?.message || String(e) },
            { status: 502 },
          );
        }
      }
      try {
        const jobs = await fetchSeekCompanyJobs(adv.advertiserId, adv.name);
        return Response.json({
          ok: true,
          id,
          advertiserId: adv.advertiserId,
          reachable: true,
          count: jobs.length,
          sample: jobs
            .slice(0, 5)
            .map((j) => ({ t: j.t, cat: j.cat, loc: j.loc, sal: j.sal || null })),
        });
      } catch (e) {
        return Response.json(
          { ok: false, id, error: (e as Error)?.message || String(e) },
          { status: 500 },
        );
      }
    }
    return new Response("employsi jobs-cron", { status: 200 });
  },
};
