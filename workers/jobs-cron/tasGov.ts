// Tasmanian Government jobs feed.
//
// Scrapes the official TAS public-sector jobs board (careers.jobs.tas.gov.au)
// and maps every advertised role to one of the TAS gov agencies plotted in
// Hobart (see data/hobartGov.ts). Live-vacancies source for those agencies —
// real, ToS-clean public data from the government's own board.
//
// The board is a server-rendered Rails app (Turbo). Its search is a plain GET —
// `/jobs/search?page=N&dropdown_field_1_uids[]=<uid>` returns the agency's
// vacancy list as HTML, 30 cards per page. The job cards themselves DON'T name
// the department, so — unlike the NT board's single all-in-one POST — we fetch
// one agency at a time using the board's own department-filter uid (carried on
// each agency in hobartGov.ts) and page through until a short page ends it.

import { skillsForText } from "../../src/employsi/data/skillsTaxonomy";
import { HOBART_GOV_IDS, TAS_GOV_UID } from "../../src/employsi/data/hobartGov";

const SEARCH = "https://careers.jobs.tas.gov.au/jobs/search";
const PAGE_SIZE = 30;
const MAX_PAGES = 12; // 360 vacancies/agency — well above the busiest (Health ~160)

// A stored TAS job — mirrors the app's AdvertisedJob shape so the company card
// renders it like any other role, plus a few gov extras.
export interface StoredTasJob {
  t: string;
  loc: string;
  cat: string;
  url: string;
  created: string; // YYYY-MM-DD first seen (the board carries no posting date)
  city: string | null; // Hobart-market (TAS) roles
  skills: string[];
  salN?: number;
  emp?: string; // employment type (e.g. "Fixed-term, part-time")
  seen?: string; // YYYY-MM-DD last seen on the board (for age-out)
}

const clean = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Pull the inner text of a card's `<span id="<kind>_icon_text_...">…</span>`.
function fieldText(card: string, kind: string): string {
  const m = card.match(new RegExp(`id="${kind}_icon_text_[^"]*">([\\s\\S]*?)</span>`));
  return m ? clean(m[1]) : "";
}

// pay_scale renders as bare text inside its list item (no icon_text span).
function payScaleText(card: string): string {
  const m = card.match(/job-component-list-pay_scale">([\s\S]*?)<\/div>/);
  return m ? clean(m[1]) : "";
}

// Best-effort salary midpoint from a string that names dollar figures.
//
// The SEARCH page never yields one: TAS prints the pay scale as an award-band
// label ("Health and Human Services … General Stream, Level 1"), and a sample
// of the live board had a dollar figure in 0 of 30 cards. The figure lives on
// the JOB PAGE instead ("$121,540 per annum"), which is why enrichDetails below
// exists — without it this source is permanently 0% salary, which is exactly
// what the archive showed.
function salaryFrom(pay: string): number | undefined {
  const nums = (pay.match(/\$\s?([\d,]{4,})/g) || [])
    .map((x) => Number(x.replace(/[^\d]/g, "")))
    .filter((n) => n > 0);
  if (!nums.length) return undefined;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

// How many job pages one run may open to look for a salary, and how many at a
// time. This is deliberately BOUNDED rather than "every job": the board carries
// a few hundred vacancies, and fetching them all would push the run past the
// Worker's waitUntil budget — the failure that silently stopped the Queensland
// board writing for three days. A capped slice per run fills the archive in
// over a few days instead, and because the upsert only fills a NULL salary,
// re-running never overwrites a figure already captured.
const DETAIL_BUDGET = 60;
const DETAIL_CONCURRENCY = 6;

// The job page states the rate as "$121,540 per annum" (or a range). Anything
// not qualified as annual is left alone — an hourly rate read as a salary would
// be worse than no figure.
function salaryFromDetail(html: string): number | undefined {
  const m = html.match(
    /\$\s?([\d,]{5,})(?:\s*(?:-|–|to)\s*\$?\s?([\d,]{5,}))?[^<\n]{0,40}?per annum/i,
  );
  if (!m) return undefined;
  const lo = Number(m[1].replace(/[^\d]/g, ""));
  const hi = m[2] ? Number(m[2].replace(/[^\d]/g, "")) : lo;
  if (!lo || lo < 20000) return undefined;
  return Math.round((lo + hi) / 2);
}

async function fetchDetail(url: string, signalMs = 15000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "employsi-jobs/1.0 (+https://employsi.com; TAS gov vacancies feed)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fill in salaries from job pages, up to DETAIL_BUDGET of them.
 *
 * THE CANDIDATE SET HAS TO REMEMBER, and for a long time it did not. The
 * comment here used to claim the window "advances by itself" because jobs
 * priced on an earlier run drop out of it. That was never true: every run
 * re-parses the board from scratch, the search page states no salary (measured:
 * a dollar figure in 0 of 30 cards), so `!j.salN` held for every job every day
 * and the slice re-fetched the SAME first 60 job pages forever. The board has
 * ~230 live vacancies and the archive sat at 14 priced, which is what that
 * looks like from the outside.
 *
 * So the salaries already known are passed IN, seeded onto the jobs before the
 * candidate set is taken. Now a priced job really does drop out, the window
 * really does advance, and the board fills in over a few runs — which is what
 * DETAIL_BUDGET was always sized for.
 */
/**
 * Which jobs this run should open a detail page for. Exported so the advancing
 * window can be tested without crawling the live board twice — the board
 * throttles a second full crawl, which made an end-to-end test of this
 * unreadable.
 *
 * Seeds `salN` from what is already known (mutating, so the callers' rows carry
 * the figure onward to KV and D1), then takes the unpriced head of the list.
 */
export function salaryCandidates(
  jobs: StoredTasJob[],
  known?: Map<string, number>,
  budget = DETAIL_BUDGET,
): StoredTasJob[] {
  if (known?.size) for (const j of jobs) if (!j.salN && j.url) j.salN = known.get(j.url);
  return jobs.filter((j) => !j.salN && j.url).slice(0, budget);
}

async function enrichDetails(jobs: StoredTasJob[], known?: Map<string, number>): Promise<number> {
  const todo = salaryCandidates(jobs, known);
  let found = 0;
  let fetched = 0;
  for (let i = 0; i < todo.length; i += DETAIL_CONCURRENCY) {
    const band = todo.slice(i, i + DETAIL_CONCURRENCY);
    const pages = await Promise.all(band.map((j) => fetchDetail(j.url)));
    band.forEach((j, k) => {
      const html = pages[k];
      if (!html) return;
      fetched++;
      const n = salaryFromDetail(html);
      if (n) {
        j.salN = n;
        found++;
      }
    });
  }
  // One line an operator can act on: whether the job pages were reachable at
  // all, and how many of them actually stated a salary.
  console.log(
    `tas-gov detail enrich: ${todo.length} candidates, ${fetched} fetched, ${found} priced`,
  );
  return found;
}

// Parse one search-results page into StoredTasJob[]. Cards are delimited by the
// `link_job_title_…` anchor; we slice each card off the next anchor so per-card
// field lookups can't bleed into the following card.
export function parseTasGov(html: string, today: string): StoredTasJob[] {
  const anchors = [
    ...html.matchAll(/<a id="link_job_title[^"]*"\s+href="([^"]+)">([\s\S]*?)<\/a>/g),
  ];
  const out: StoredTasJob[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const start = a.index ?? 0;
    const end = i + 1 < anchors.length ? (anchors[i + 1].index ?? html.length) : html.length;
    const card = html.slice(start, end);
    const title = clean(a[2]);
    const url = a[1].trim();
    if (!title || !url) continue;
    const cat = fieldText(card, "category");
    const pay = payScaleText(card);
    out.push({
      t: title,
      loc: fieldText(card, "location") || "Tasmania",
      cat: cat || "Government",
      url,
      created: "",
      city: "hobart",
      skills: skillsForText(`${title} ${cat}`),
      salN: salaryFrom(pay),
      emp: fieldText(card, "employment_type") || undefined,
      seen: today,
    });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch a page. Returns the HTML, or 'throttled' when the board rate-limited us
// (HTTP 429/503) or the request errored — the caller distinguishes that from a
// legitimately-empty agency so it can retry rather than record "no vacancies".
async function fetchPage(
  uid: string,
  page: number,
  signalMs = 20000,
): Promise<string | "throttled"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  try {
    const qs = `page=${page}&query=&dropdown_field_1_uids%5B%5D=${uid}`;
    const res = await fetch(`${SEARCH}?${qs}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "employsi-jobs/1.0 (+https://employsi.com; TAS gov vacancies feed)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (res.ok) return await res.text();
    // 429/503 with an optional Retry-After — treat anything non-OK as throttled.
    return "throttled";
  } catch {
    return "throttled";
  } finally {
    clearTimeout(timer);
  }
}

interface AgencyFetch {
  jobs: StoredTasJob[];
  ok: boolean; // false ⇒ page 1 never loaded (throttled/unreachable) — worth a retry
}

// Page through one agency's vacancies. The board rate-limits bursts (a token
// bucket that trips after ~15 rapid requests), so each page is retried with
// escalating backoff; a page that never loads leaves ok=false so the whole
// agency can be re-attempted in a second pass once the bucket has refilled.
async function fetchAgency(uid: string, today: string): Promise<AgencyFetch> {
  const jobs: StoredTasJob[] = [];
  const seenUrls = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let html: string | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(1200 * attempt); // 1.2s, 2.4s, 3.6s — let the bucket refill
      const r = await fetchPage(uid, page);
      if (r !== "throttled") {
        html = r;
        break;
      }
    }
    if (html === null) return { jobs, ok: page > 1 }; // page 1 unreachable ⇒ needs retry
    const parsed = parseTasGov(html, today);
    if (!parsed.length) break;
    let added = 0;
    for (const j of parsed) {
      if (seenUrls.has(j.url)) continue; // guard against a repeated last page
      seenUrls.add(j.url);
      jobs.push(j);
      added++;
    }
    if (parsed.length < PAGE_SIZE || added === 0) break; // last page reached
    await sleep(400);
  }
  return { jobs, ok: true };
}

export interface TasGovResult {
  updated: string;
  parsed: number; // total jobs matched across all agencies
  enriched: number; // salaries recovered from job pages this run
  byAgency: Record<string, StoredTasJob[]>;
}

// Fetch every TAS agency's board, one at a time, into { agencyId → jobs }. Two
// passes: agencies the board throttled on the first sweep are retried after a
// cooldown so a single daily run reliably captures all of them.
export async function fetchTasGov(
  today: string,
  /** url -> salary already captured on an earlier run, so the detail-fetch
   *  window advances instead of re-reading the same head of the board. */
  knownSalaries?: Map<string, number>,
): Promise<TasGovResult | null> {
  const byAgency: Record<string, StoredTasJob[]> = {};
  const ids = HOBART_GOV_IDS.filter((id) => TAS_GOV_UID[id]);
  let parsed = 0;
  let anyOk = false;
  const throttled: string[] = [];

  for (const id of ids) {
    const { jobs, ok } = await fetchAgency(TAS_GOV_UID[id], today);
    if (ok) anyOk = true;
    else throttled.push(id);
    byAgency[id] = jobs;
    parsed += jobs.length;
    await sleep(700); // gentle pacing between agencies to stay under the burst cap
  }

  // Second pass for any agency the board rate-limited: wait for the bucket to
  // refill, then re-fetch. Only overwrites when the retry actually finds jobs,
  // so a genuinely-empty agency stays empty.
  if (throttled.length) {
    await sleep(8000);
    for (const id of throttled) {
      const { jobs, ok } = await fetchAgency(TAS_GOV_UID[id], today);
      if (ok) anyOk = true;
      if (jobs.length) {
        parsed += jobs.length - byAgency[id].length;
        byAgency[id] = jobs;
      }
      await sleep(1500);
    }
  }

  if (!anyOk) return null; // board unreachable — don't age out stored jobs

  // Open a bounded slice of job pages for the salaries the list view withholds.
  // Failure here is not failure of the run: the jobs are already parsed, so a
  // detail fetch that times out just leaves that salary for another day.
  const enriched = await enrichDetails(Object.values(byAgency).flat(), knownSalaries);

  return { updated: today, parsed, enriched, byAgency };
}
