import { createServerFn } from "@tanstack/react-start";
import { skillsForText, parseStoredSkills } from "../data/skillsTaxonomy";
import { NZ_GOV_IDS } from "../data/nzGov";
import type { AdvertisedJob } from "./skillsFn";
import { archiveJobs, type ArchiveRow, type D1Like } from "./jobArchive";
import { asRecord, asRecords, str, type JsonRecord, type JsonValue } from "./json";
import { kvBinding, type KVLike } from "./kv";

// Live "open roles" for any company in the app, fetched on the Worker, scoped
// to the company's own job market (see data/cityMarket.ts) so it works whether
// the company sits in Perth, London, Houston, Singapore or Tokyo.
//
// SEEK and Indeed can't be used: both hard-block server/datacenter IPs (403)
// and their terms prohibit scraping. Instead we use ToS-clean sources:
//   1. A per-company ATS feed override (Workday / Greenhouse / Lever /
//      SmartRecruiters JSON) — real numbers straight from the employer, for the
//      companies whose exact ATS slug has been verified (see AU_ATS below).
//   2. Adzuna's official jobs API for the company's country (au, gb, us, ca,
//      sg, fr, za, …). Needs ADZUNA_APP_ID + ADZUNA_APP_KEY as Worker secrets.
//   3. The Muse's public jobs API on top of Adzuna, narrowed to the company's
//      country and cross-checked so a role advertised on both boards is only
//      counted once. Needs THEMUSE_KEY. For the few markets Adzuna doesn't
//      cover (Japan, Korea, China, Switzerland, the UAE, Hong Kong) The Muse is
//      the sole source.
//
// The count is directly the live vacancy total: when the sources respond with
// no matches the card shows 0 (real "no live vacancies"), not an illustrative
// figure. The returned `jobs` sample drives "where they're hiring" and "skills
// in demand" on the card. Only a network/credentials failure returns null.

export interface OpenRoles {
  count: number;
  source: string; // e.g. "Adzuna", "Adzuna + The Muse", "The Muse", "Workday"
  jobs: AdvertisedJob[]; // sample of the advertised roles (skills mapped)
}

const stripHtml = (s: string) =>
  (s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// A single stored data point: [YYYY-MM-DD, open-role count].
export type RolePoint = { d: string; c: number };

const cache = new Map<string, { at: number; data: OpenRoles | null }>();
const TTL = 60 * 60 * 1000;

// ── Persistent history (Cloudflare KV) ────────────────────────────────────
// Each fetch records that day's count so we can chart vacancies over time.
// Adzuna only exposes the *current* count, so history builds forward from the
// first time each company is queried — it can't be backfilled. Stored compactly
// as [date, count] tuples under `roles:{id}`, capped to one year.
async function getKV(): Promise<KVLike | null> {
  try {
    const m = await import("cloudflare:workers");
    return kvBinding(m?.env, "OPEN_ROLES_HISTORY");
  } catch {
    return null; // not running on the Worker (e.g. local SSR) → no history
  }
}

// The D1 historical-archive binding, when present. Returns null off-Worker or
// before the database is provisioned, so archiving is a no-op until it's wired.
async function getArchiveDb(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function recordSnapshot(id: string, count: number): Promise<void> {
  const kv = await getKV();
  if (!kv || !id) return;
  const key = `roles:${id}`;
  try {
    const raw = await kv.get(key);
    let arr: [string, number][] = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    }
    const d = today();
    const last = arr[arr.length - 1];
    if (last && last[0] === d)
      last[1] = count; // refresh today's point
    else arr.push([d, count]);
    if (arr.length > 365) arr = arr.slice(arr.length - 365);
    await kv.put(key, JSON.stringify(arr));
  } catch {
    // history is best-effort; never let a KV hiccup break the live count
  }
}

// ── WA Government agencies ─────────────────────────────────────────────────
// The 62 Perth gov agencies (ids `perth-gov-*`) don't come from Adzuna/Muse:
// their live vacancies are scraped from the official WA public-sector board
// (search.jobs.wa.gov.au) by the jobs-cron and stored per agency under
// `wagov:{id}`. Reading that here means the whole company card — open-roles
// count, "where they're hiring", "skills in demand", vacancy history — runs off
// the real WA feed with no other changes. Returns 0 (a genuine "no live
// vacancies") when the agency currently has none, and null only if the feed
// hasn't been populated yet (KV miss), so the card can fall through gracefully.
async function fromWaGov(id: string): Promise<OpenRoles | null> {
  return fromGovKv("wagov", id, "WA Government");
}

// VIC and QLD government boards are also server-rendered no-browser feeds
// scraped by the jobs-cron (see workers/jobs-cron/vicGov.ts / qldGov.ts) and
// stored per agency under `vicgov:{id}` / `qldgov:{id}`, exactly like WA under
// `wagov:{id}`. Same read path → same card treatment (open-roles, vacancy
// graph, "where they're hiring") off the real government board.
async function fromGovKv(prefix: string, id: string, label: string): Promise<OpenRoles | null> {
  const kv = await getKV();
  if (!kv) return null;
  try {
    const raw = await kv.get(`${prefix}:${id}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const jobs: AdvertisedJob[] = Array.isArray(data?.jobs) ? data.jobs : [];
    const count = Number.isFinite(Number(data?.count)) ? Number(data.count) : jobs.length;
    return { count, source: label, jobs: jobs.slice(0, 60) };
  } catch {
    return null;
  }
}

function adzunaCreds(): { id: string; key: string } | null {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  return id && key ? { id, key } : null;
}

async function fetchJson(url: string, ms: number): Promise<JsonRecord | JsonValue[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "employsi/1.0", Accept: "application/json" },
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
  | { ats: "greenhouse"; slug: string }
  | { ats: "lever"; slug: string }
  | { ats: "smartrecruiters"; slug: string }
  | { ats: "workday"; host: string; tenant: string; site: string };

const AU_ATS: Record<string, AtsEntry> = {
  // e.g. sydney company on Greenhouse:
  //   'sydney-XYZ': { ats: 'greenhouse', slug: 'xyz' },
  // Populated as feeds are verified; empty entries just fall through to Adzuna.
};

async function fromAts(entry: AtsEntry): Promise<OpenRoles | null> {
  if (entry.ats === "greenhouse") {
    const j = await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs`,
      6000,
    );
    const jobs = asRecords(asRecord(j).jobs);
    const au = jobs.filter((x) =>
      /austral|sydney|melbourne|perth|brisbane|adelaide|canberra/i.test(
        str(asRecord(x.location).name),
      ),
    );
    return jobs.length ? { count: au.length || jobs.length, source: "Greenhouse", jobs: [] } : null;
  }
  if (entry.ats === "lever") {
    const j = await fetchJson(`https://api.lever.co/v0/postings/${entry.slug}?mode=json`, 6000);
    const jobs = asRecords(j);
    const au = jobs.filter((x) =>
      /austral|sydney|melbourne|perth|brisbane|adelaide/i.test(
        str(asRecord(x.categories).location),
      ),
    );
    return jobs.length ? { count: au.length || jobs.length, source: "Lever", jobs: [] } : null;
  }
  if (entry.ats === "smartrecruiters") {
    const j = await fetchJson(
      `https://api.smartrecruiters.com/v1/companies/${entry.slug}/postings?limit=100&country=au`,
      6000,
    );
    const total = Number(asRecord(j).totalFound);
    return Number.isFinite(total) && total >= 0
      ? { count: total, source: "SmartRecruiters", jobs: [] }
      : null;
  }
  // workday
  const url = `https://${entry.host}/wday/cxs/${entry.tenant}/${entry.site}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "employsi/1.0",
      },
      body: JSON.stringify({ limit: 1, offset: 0, searchText: "", appliedFacets: {} }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as JsonRecord;
    const total = Number(j?.total);
    return Number.isFinite(total) ? { count: total, source: "Workday", jobs: [] } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Normalise a title for cross-board dedupe: lowercase, collapse anything
// non-alphanumeric to single spaces. Same-ad titles line up across providers.
function normTitle(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toJob(
  t: string,
  loc: string,
  cat: string,
  url: string,
  created: string,
  salN?: number,
): AdvertisedJob {
  return {
    t,
    loc,
    cat,
    url,
    created: (created || "").slice(0, 10),
    city: null,
    skills: skillsForText(t),
    salN,
  };
}

// Adzuna's advertised salary band → an annualised midpoint number, when stated.
function adzunaSalaryNum(x: JsonValue | undefined): number | undefined {
  const lo = Number(asRecord(x).salary_min);
  const hi = Number(asRecord(x).salary_max);
  const vals = [lo, hi].filter((n) => Number.isFinite(n) && n > 0);
  if (!vals.length) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// A salary midpoint → a compact display string, e.g. 152000 → "$152k".
export function fmtSalary(n: number | undefined | null): string | null {
  if (!n || !Number.isFinite(n) || n <= 0) return null;
  return n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
}

// An advertised job → a historical archive row, tagged with its source and the
// company it was fetched for.
function jobToArchive(
  j: AdvertisedJob,
  source: string,
  company: string,
  id: string | undefined,
  where: string,
): ArchiveRow {
  return {
    source,
    title: j.t,
    company,
    companyId: id ?? null,
    hub: where || null,
    location: j.loc,
    category: j.cat,
    salary: fmtSalary(j.salN),
    url: j.url,
    posted: j.created,
    skills: j.skills,
  };
}

// How many 50-result pages of a company's Adzuna listings one lookup may walk.
//
// Page 1 only used to be enough because the headline was Adzuna's OWN reported
// total and the listings were just a sample. Now the headline is counted from
// the listings themselves (see getOpenRoles), so an employer with 300 ads would
// have been cut to 50. Four pages covers the roster's employers while keeping a
// card open to at most four upstream calls, and the walk stops as soon as
// Adzuna's reported total is accounted for.
const ADZUNA_MAX_PAGES = 4;
const ADZUNA_PER_PAGE = 50;

// Adzuna's count + advertised roles for a company in a given country market.
// `count` is ADZUNA'S OWN reported total for the phrase — kept because it says
// whether we saw everything, but not used as the card's figure: it counts every
// listing matching the employer's name, including the same role reposted across
// a dozen locations. `jobs` are the listings themselves, deduped on title +
// location. Returns 0 when Adzuna genuinely reports no matches, and null only
// when the request/credentials fail, so the caller can tell "no vacancies" from
// "couldn't check".
async function fromAdzuna(
  company: string,
  country: string,
  where: string,
): Promise<{ count: number; jobs: AdvertisedJob[] } | null> {
  const c = adzunaCreds();
  if (!c) return null;
  let count: number | null = null;
  const jobs: AdvertisedJob[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= ADZUNA_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      app_id: c.id,
      app_key: c.key,
      what_phrase: company,
      where,
      results_per_page: String(ADZUNA_PER_PAGE),
      "content-type": "application/json",
    });
    const j = await fetchJson(
      `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params.toString()}`,
      6000,
    );
    if (!j) return count === null ? null : { count, jobs }; // page 1 failed ⇒ couldn't check
    if (count === null) {
      const n = Number(asRecord(j).count);
      if (!Number.isFinite(n)) return null;
      count = n;
    }
    const results = asRecords(asRecord(j).results);
    for (const x of results) {
      const t = stripHtml(String(x?.title || ""));
      if (!t) continue;
      const loc = str(asRecord(x.location).display_name);
      const dk = (t + "|" + loc).toLowerCase();
      if (seen.has(dk)) continue; // Adzuna reposts the same role repeatedly
      seen.add(dk);
      jobs.push(
        toJob(
          t,
          loc,
          str(asRecord(x.category).label),
          String(x?.redirect_url || ""),
          String(x?.created || ""),
          adzunaSalaryNum(x),
        ),
      );
    }
    // Short page, or we've now requested as many as Adzuna says exist.
    if (results.length < ADZUNA_PER_PAGE || page * ADZUNA_PER_PAGE >= count) break;
  }
  return { count: count ?? 0, jobs };
}

// The Muse's public jobs API for a company, restricted to roles in the given
// market via the `region` matcher against each job's location text. The Muse's
// `company` filter is exact-name, so most resources/finance names return
// nothing — but where a company is registered (typically tech and
// multinationals) it adds real, current openings.
async function fromMuse(company: string, region: RegExp): Promise<AdvertisedJob[]> {
  const key = process.env.THEMUSE_KEY;
  if (!key) return [];
  const out: AdvertisedJob[] = [];
  // Two pages is plenty for a single employer's footprint in one country.
  for (let page = 0; page < 2; page++) {
    const params = new URLSearchParams({ api_key: key, company, page: String(page) });
    const j = await fetchJson(`https://www.themuse.com/api/public/jobs?${params.toString()}`, 6000);
    const results = asRecords(asRecord(j).results);
    if (!results.length) break;
    for (const r of results) {
      const locs: string[] = asRecords(r.locations).map((l) => str(l.name));
      const loc = locs.find((l) => region.test(l));
      if (!loc) continue; // only roles genuinely in this company's country count
      const t = stripHtml(String(r?.name || ""));
      if (!t) continue;
      out.push(
        toJob(
          t,
          loc,
          str(asRecords(r.categories)[0]?.name),
          str(asRecord(r.refs).landing_page),
          String(r?.publication_date || ""),
        ),
      );
    }
    if (page + 1 >= Number(asRecord(j).page_count || 0)) break;
  }
  return out;
}

// Sources other than the live Adzuna/Muse fetch that flow into the D1 archive
// company-scoped (i.e. can be attributed to one company card). SEEK is the live
// one today; the map turns a stored source key into a display label.
const ARCHIVE_SOURCE_LABEL: Record<string, string> = {
  seek: "SEEK",
  jobstreet: "JobStreet",
  jooble: "Jooble",
  mycareersfuture: "MyCareersFuture",
  indeed: "Indeed",
  zhaopin: "Zhaopin",
  linkedin: "LinkedIn",
  "aps-gov": "Australian Public Service",
  "nt-gov": "NT Government",
  "tas-gov": "TAS Government",
  "nsw-gov": "NSW Government",
  "nz-gov": "NZ Government",
};

// One issuer, two roster lines. HSBC Holdings plc is listed on both the LSE and
// the HKEX, so the roster carries it twice, but it runs a single global careers
// portal. The portal is archived once, against the primary (LSE) line; the Hong
// Kong line reads those same rows rather than the scrape running twice and the
// roles being counted twice in market-wide totals.
export const COMPANY_ID_ALIAS: Record<string, string> = {
  "hongkong-00005": "london-hsba",
};

// NZ public-sector agency ids. These need an explicit set rather than an
// `nz-` prefix test, because the NZ *private* roster (data/nzCompanies.ts) uses
// the same prefix — Fisher & Paykel Healthcare is `nz-…` too, and it must not
// be routed to the government board.
const NZ_GOV_ID_SET = new Set(NZ_GOV_IDS);

// The current (still-advertised) listings for a company held in the D1 archive
// from sources OTHER than the live Adzuna/Muse fetch — chiefly SEEK, which is
// scraped daily off-Worker (it 403-challenges Cloudflare Workers) and archived.
// "Current" = re-seen on the board within the last few days (last_seen recent),
// so taken-down ads age out. Each is cross-checked by normalised title against
// what the live fetch already returned, so the same role advertised on more than
// one board is only counted once — letting the card's open-roles figure be a
// deduped union of every source's current vacancies as at today.
async function currentFromArchive(
  id: string,
  liveJobs: AdvertisedJob[],
): Promise<{ added: number; jobs: AdvertisedJob[]; sources: string[] }> {
  const db = await getArchiveDb();
  if (!db) return { added: 0, jobs: [], sources: [] };
  try {
    const res = await db
      .prepare(
        // "Current" = seen on the board no earlier than yesterday. This is the
        // SAME cut the vacancy chart's last point uses (it plots roles live on
        // a day, and its last day is yesterday), so the headline and the chart
        // read the same rows. The previous three-day grace period was there to
        // absorb a missed nightly run, but it also meant the headline counted
        // roles the chart had already dropped — which is most of why the two
        // numbers disagreed. A feed that genuinely misses a night now shows the
        // same dip in both places rather than only in one.
        `SELECT title, source, location, salary, url, posted, skills
           FROM jobs
          WHERE company_id = ?1
            AND source NOT IN ('adzuna', 'muse')
            AND last_seen >= date('now', '-1 day')`,
      )
      .bind(COMPANY_ID_ALIAS[id] ?? id)
      .all();
    const rows = res?.results ?? [];
    if (!rows.length) return { added: 0, jobs: [], sources: [] };
    const seen = new Set(liveJobs.map((j) => normTitle(j.t)));
    const jobs: AdvertisedJob[] = [];
    const sources = new Set<string>();
    for (const r of rows) {
      const t = stripHtml(String(r.title || ""));
      if (!t) continue;
      const n = normTitle(t);
      if (seen.has(n)) continue; // already counted via a live board
      seen.add(n);
      sources.add(String(r.source || ""));
      // Stored skills first, mapped through SKILL_ALIAS so a renamed skill on
      // an old row still resolves; falling back to matching the title when the
      // row has none (or none that survive).
      const stored = parseStoredSkills(r.skills);
      const skills = stored.length ? stored : skillsForText(t);
      jobs.push({
        t,
        loc: String(r.location || ""),
        cat: "",
        url: String(r.url || ""),
        created: String(r.posted || "").slice(0, 10),
        city: null,
        skills,
        salN: undefined,
      });
    }
    return { added: jobs.length, jobs, sources: [...sources] };
  } catch {
    return { added: 0, jobs: [], sources: [] };
  }
}

// Reconstruct the Muse location matcher from the regex source the client sends
// (from data/cityMarket.ts). Guarded: capped length + try/catch so a bad
// pattern can never throw or hang the handler; falls back to matching nothing.
function regionMatcher(src: string | undefined): RegExp {
  if (!src || src.length > 200) return /$^/;
  try {
    return new RegExp(src, "i");
  } catch {
    return /$^/;
  }
}

export const getOpenRoles = createServerFn({ method: "GET" })
  .validator(
    (data: { company: string; id?: string; country?: string; where?: string; region?: string }) =>
      data,
  )
  .handler(async ({ data }): Promise<OpenRoles | null> => {
    const company = (data.company || "").trim();
    if (!company) return null;
    // Market: defaults to Australia for backwards compatibility, but the card
    // passes the company's own country/where/region (see data/cityMarket.ts).
    // An empty country means Adzuna doesn't cover this market → The Muse only.
    const country = data.country === undefined ? "au" : data.country;
    const where = data.where || "Australia";
    const region = regionMatcher(
      data.region || "australia|sydney|melbourne|perth|brisbane|adelaide|canberra",
    );
    const key = `${data.id || ""}::${country}::${company.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.data;

    let out: OpenRoles | null = null;
    // 0. WA Government agencies serve from the scraped WA jobs board feed (KV),
    //    not Adzuna/Muse — real public-sector vacancies mapped to each agency.
    if (data.id && data.id.startsWith("perth-gov-")) {
      out = await fromWaGov(data.id);
      if (out && out.count > 0 && data.id) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 0a. VIC / QLD Government agencies serve from their own scraped board feeds
    //     (careers.vic.gov.au / smartjobs.qld.gov.au), stored in KV like WA.
    if (data.id && (data.id.startsWith("vic-gov-") || data.id.startsWith("qld-gov-"))) {
      const vic = data.id.startsWith("vic-gov-");
      out = await fromGovKv(
        vic ? "vicgov" : "qldgov",
        data.id,
        vic ? "VIC Government" : "QLD Government",
      );
      if (out && out.count > 0) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 0b. SA Government agencies (ids `sa-gov-*`) serve from the scraped SA
    //     public-sector board (iworkfor.sa.gov.au), archived in D1 under source
    //     'sa-gov' — not Adzuna/Muse. currentFromArchive already returns that
    //     company's current (recently re-seen) non-Adzuna/Muse listings deduped
    //     by title, which for these ids is exactly the sa-gov rows.
    if (data.id && data.id.startsWith("sa-gov-")) {
      const extra = await currentFromArchive(data.id, []);
      out = { count: extra.added, source: "SA Government", jobs: extra.jobs };
      if (out.count > 0) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 0c. APS federal agencies (ids `aps-*`) serve from the scraped APS board
    //     (apsjobs.gov.au), archived in D1 under source 'aps-gov'. Same archive
    //     path as SA; the aps-* prefix keeps them disjoint from state gov ids so
    //     a federal agency is never double-counted with a state one.
    if (data.id && data.id.startsWith("aps-")) {
      const extra = await currentFromArchive(data.id, []);
      out = { count: extra.added, source: "Australian Public Service", jobs: extra.jobs };
      if (out.count > 0) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 0d. NT government agencies (ids `nt-gov-*`) serve from the scraped NT jobs
    //     board (jobs.nt.gov.au), archived in D1 under source 'nt-gov'. Same
    //     archive path as SA/APS; the nt-gov- prefix keeps them disjoint from the
    //     other jurisdictions' gov ids.
    if (data.id && data.id.startsWith("nt-gov-")) {
      const extra = await currentFromArchive(data.id, []);
      out = { count: extra.added, source: "NT Government", jobs: extra.jobs };
      if (out.count > 0) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 0e. TAS government agencies (ids `tas-gov-*`) serve from the scraped TAS
    //     jobs board (careers.jobs.tas.gov.au), archived in D1 under source
    //     'tas-gov'. Same archive path as SA/APS/NT; the tas-gov- prefix keeps
    //     them disjoint from the other jurisdictions' gov ids.
    if (data.id && data.id.startsWith("tas-gov-")) {
      const extra = await currentFromArchive(data.id, []);
      out = { count: extra.added, source: "TAS Government", jobs: extra.jobs };
      if (out.count > 0) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 0f. NSW government agencies (ids `nsw-gov-*`) serve from the scraped NSW
    //     jobs board (iworkfor.nsw.gov.au), archived in D1 under source
    //     'nsw-gov'. Same archive path as SA/APS/NT/TAS; the nsw-gov- prefix
    //     keeps them disjoint from the other jurisdictions' gov ids.
    if (data.id && data.id.startsWith("nsw-gov-")) {
      const extra = await currentFromArchive(data.id, []);
      out = { count: extra.added, source: "NSW Government", jobs: extra.jobs };
      if (out.count > 0) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 0g. NZ public-sector agencies (ids `nz-*`) serve from the scraped NZ
    //     government board (jobs.govt.nz), archived in D1 under source 'nz-gov'.
    //     Same archive path as the Australian jurisdictions. Only agencies
    //     advertising in Auckland or Wellington are roster cards (see
    //     data/nzGov.ts), and their ids are generated by the same rule the
    //     scraper uses, so a card resolves its own agency's rows.
    if (data.id && NZ_GOV_ID_SET.has(data.id)) {
      const extra = await currentFromArchive(data.id, []);
      out = { count: extra.added, source: "NZ Government", jobs: extra.jobs };
      if (out.count > 0) await recordSnapshot(data.id, out.count);
      cache.set(key, { at: Date.now(), data: out });
      return out;
    }
    // 1. Direct employer ATS feed where we have a verified one.
    const ats = data.id ? AU_ATS[data.id] : undefined;
    if (ats) out = await fromAts(ats);
    // 2. Otherwise Adzuna (for the company's country) augmented with The Muse.
    //    Adzuna's count is the live vacancy total (0 shown as a real "no
    //    vacancies"); The Muse adds any of its roles for this employer in the
    //    same country that Adzuna didn't already list, cross-checked by
    //    normalised title so the same ad on both boards is only counted once.
    //    For markets Adzuna doesn't cover (country ''), The Muse is the sole
    //    source.
    if (!out) {
      const az = country ? await fromAdzuna(company, country, where) : null;
      const museJobs = await fromMuse(company, region);
      if (az || museJobs.length) {
        // DISTINCT ROLES, counted from the listings we actually hold — not
        // Adzuna's reported total.
        //
        // The headline used to be `az.count + museAdded`, where az.count was
        // Adzuna's own total for the employer phrase. That number and the card's
        // vacancy chart could never agree: the chart counts distinct normalised
        // titles from the archive, while Adzuna's total counts every listing,
        // including one role reposted across a dozen locations (measured at 47%
        // overstatement across the roster; CSL showed 1,089 listings for 438
        // real roles). Counting the deduped union here makes the headline and
        // the chart's last point the same figure by construction.
        const jobs: AdvertisedJob[] = az ? [...az.jobs] : [];
        const seen = new Set(jobs.map((j) => normTitle(j.t)));
        for (const mj of museJobs) {
          const n = normTitle(mj.t);
          if (seen.has(n)) continue;
          seen.add(n);
          jobs.push(mj);
        }
        const count = seen.size;
        const museAdded = jobs.length - (az ? az.jobs.length : 0);
        const source = az && museAdded > 0 ? "Adzuna + The Muse" : az ? "Adzuna" : "The Muse";
        out = { count, source, jobs: jobs.slice(0, 60) };

        // Archive every listing we just pulled to the historical D1 store,
        // tagged by its source. Best-effort + no-op until the DB is bound.
        const rows: ArchiveRow[] = [
          ...(az ? az.jobs.map((j) => jobToArchive(j, "adzuna", company, data.id, where)) : []),
          ...museJobs.map((j) => jobToArchive(j, "muse", company, data.id, where)),
        ];
        await archiveJobs(await getArchiveDb(), rows, today());
      }
    }

    // Fold in every OTHER source's current listings from the D1 archive (chiefly
    // SEEK, scraped daily off-Worker) so the open-roles figure is a deduped union
    // of all current vacancies for this company as at today — not just the live
    // Adzuna/Muse fetch. Deduped by normalised title against the live sample.
    // (Gov agencies returned earlier — their board is their single source.)
    // Runs even when Adzuna/Muse returned nothing (out === null), so a company
    // covered ONLY by an archive source — e.g. the Chinese roster companies whose
    // vacancies come from Zhaopin, or any employer Adzuna/Muse don't index —
    // still surfaces its listings instead of showing a false zero.
    if (data.id) {
      const extra = await currentFromArchive(data.id, out ? out.jobs : []);
      if (extra.added > 0) {
        // Every `portal-<platform>` source is the employer's own careers site;
        // the platform suffix is an implementation detail of how we read it,
        // not something a reader of the card should be shown. Collapsing them
        // also stops a company on two portals (Brambles, Transurban) reading
        // as two sources.
        const extraLabels = [
          ...new Set(
            extra.sources.map((s) =>
              s.startsWith("portal-") ? "Careers site" : ARCHIVE_SOURCE_LABEL[s] || s,
            ),
          ),
        ];
        if (out) {
          const label = [out.source, ...extraLabels].filter(Boolean).join(" + ");
          out = {
            count: out.count + extra.added,
            source: label,
            jobs: [...out.jobs, ...extra.jobs].slice(0, 60),
          };
        } else {
          out = {
            count: extra.added,
            source: extraLabels.filter(Boolean).join(" + ") || "Archive",
            jobs: extra.jobs.slice(0, 60),
          };
        }
      }
    }

    // Record today's count so the card can chart vacancies over time. Only
    // positive counts are stored, so a company a board doesn't index by name
    // (a false 0) never pollutes the history chart.
    if (out && out.count > 0 && data.id) await recordSnapshot(data.id, out.count);

    cache.set(key, { at: Date.now(), data: out });
    return out;
  });

// Stored open-roles history for a company, oldest → newest. Empty until the
// company has been queried at least once (history builds forward from now).
export const getRolesHistory = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<RolePoint[]> => {
    const kv = await getKV();
    if (!kv || !data.id) return [];
    try {
      const raw = await kv.get(`roles:${data.id}`);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((p): p is [string, number] => Array.isArray(p) && p.length === 2)
        .map((p) => ({ d: p[0], c: Number(p[1]) }));
    } catch {
      return [];
    }
  });
