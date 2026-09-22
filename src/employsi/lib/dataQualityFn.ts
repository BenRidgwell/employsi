import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { HISTORICAL_SOURCES, type D1Like } from "./jobArchive";
import { COMPANIES } from "../data/companies";
import { normName, sameCompanyName, substringOnlyMatch } from "./advertiserMatch";

/**
 * The archive's own health, for the administrator view.
 *
 * These three questions were only answerable from a terminal — scraper-health
 * runs nightly in CI, audit-attribution.py and check-skills.ts run by hand.
 * None of that is visible to the person who has to decide whether a number on
 * a card can be trusted, which is the wrong way round: the checks exist
 * precisely because a broken feed LOOKS like an honest quiet market.
 *
 * ADMIN ONLY, ENFORCED HERE. The role is re-derived from the session cookie
 * rather than taken from the caller, exactly as the moderation handlers do —
 * this reads internal operational detail (which feeds are dead, which rows are
 * misattributed) that end users have no business seeing.
 */

async function d1(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

/**
 * Re-exported so this module keeps reading as the health panel's own vocabulary.
 * The set is defined in jobArchive because the analyst answers need it too and
 * must not import this admin-only module to get it.
 *
 * Here it means: a closed corpus is not expected to write again, so the
 * freshness check does not apply. `wayback`'s newest row is from 2018 because
 * the hostnames were retired in 2018, which is the correct answer, not a fault.
 * Left in the staleness check it would sit permanently red at "3000d silent"
 * and every real outage would then have to be found next to a false alarm that
 * never clears — which is how a health panel stops being read at all.
 */
export { HISTORICAL_SOURCES };

/**
 * Sources with NO SCHEDULE, so silence carries no information and the freshness
 * table has nothing to say about them. They are dropped from it entirely.
 *
 * This is not the same exemption as HISTORICAL_SOURCES above, which is why it
 * is a separate set. A closed corpus has FINISHED — wayback's newest row is
 * from 2018 because the hostnames were retired in 2018. These have not
 * finished; they are simply only ever run BY HAND, so "47 days silent" means
 * nobody has run one, not that anything is broken.
 *
 * theirstack is an on-demand paid backfill: scripts/theirstack-to-d1.py has no
 * workflow and is never scheduled, so it can only ever appear stale.
 *
 * THE RULE ALREADY EXISTED, on the other health surface. scripts/scraper-
 * health.py has carried `ON_DEMAND = {'theirstack', 'muse', 'wayback'}` for
 * exactly this reason, and check_freshness() returns early for those before it
 * computes an age at all. This panel only knew about wayback, so the CLI check
 * and the admin console disagreed about the same feed — the CLI stayed green
 * while the console showed a permanent red row.
 *
 * `muse` is in that set too and is deliberately NOT here: it is an Adzuna
 * fallback that fires only when Adzuna returns nothing for a company, so it is
 * a judgement call whether its silence is worth seeing, and that call has not
 * been made. Add it here if the answer is no.
 *
 * A source is removed from a HEALTH view here, which is the move this repo is
 * otherwise right to be suspicious of — so the test is whether a schedule could
 * ever make the row go green. For these it could not.
 */
const ON_DEMAND_SOURCES = new Set(["theirstack"]);

/**
 * What KIND of thing each source is, because "seek" and "portal-sf" are not the
 * same sort of feed and a row count from one does not mean what it means from
 * the other.
 *
 * The distinction that actually matters when reading the table:
 *   Government job board  one employer family, complete for it — a drop is real
 *   Job board             a primary market, one country's employers post to it
 *   Job board aggregator  republishes OTHER boards, so its rows overlap theirs
 *                         and its totals must never be added to them
 *   Company career portal the employer's own ATS, the source of record for that
 *                         employer and the only one with no middleman
 *
 * Aggregators are called out separately from boards on purpose. Adzuna and Jora
 * carry SEEK's and Indeed's listings, so "adzuna 19,434 + seek 2,989" is not
 * 22,423 vacancies — the job_key dedupe is what keeps the archive honest about
 * that, and labelling the feeds is what keeps the READER honest about it.
 *
 * `portal-*` is one row per ATS PLATFORM, not per employer (portal-sf is every
 * tenant we read on SuccessFactors), so the employer is filled in from the data
 * rather than from this table: one name when the platform carries one employer,
 * a count when it carries several.
 */
const SOURCE_KIND: Record<string, string> = {
  adzuna: "Job board aggregator",
  indeed: "Job board aggregator",
  jooble: "Job board aggregator",
  jora: "Job board aggregator",
  muse: "Job board aggregator",
  seek: "Job board",
  linkedin: "Job board",
  jobstreet: "Job board",
  "jobstreet-ph": "Job board",
  "jobsdb-hk": "Job board",
  naukri: "Job board",
  gulftalent: "Job board",
  zhaopin: "Job board",
  // Run by Workforce Singapore, a statutory board — but it lists every
  // employer, not government ones, so it is a national job board and not the
  // "government job board" the -gov feeds are.
  mycareersfuture: "Job board",
  // Sells back-catalogue postings; not a board anyone applies through.
  theirstack: "Job posting data vendor",
  wayback: "Web archive",
};

/** Human label for a source, given how many employers its rows cover. */
export function sourceKind(
  source: string,
  companies: number,
  soleCompanyName: string | null,
): string {
  const known = SOURCE_KIND[source];
  if (known) return known;
  if (source.endsWith("-gov")) return "Government job board";
  if (source.startsWith("portal-")) {
    if (companies === 1 && soleCompanyName) return `Company career portal · ${soleCompanyName}`;
    if (companies > 1) return `Company career portal · ${companies} companies`;
    return "Company career portal";
  }
  // Never guessed at: an unclassified source says so, so adding a feed and
  // forgetting this table is visible rather than silently mislabelled.
  return "Unclassified";
}

export interface FeedRow {
  source: string;
  /** Most recent day this source wrote anything. */
  lastSeen: string;
  /** Rows it still counts as currently advertised. */
  live: number;
  total: number;
  /** Whole days since it last wrote. */
  staleDays: number;
  /** A closed historical corpus: it has finished, so it cannot be stale. */
  historical: boolean;
  /** Earliest day this source has a row for — the span a corpus covers. */
  firstSeen: string;
  /** What sort of feed this is — see sourceKind(). */
  kind: string;
}

export interface UnmappedRow {
  title: string;
  n: number;
}

export interface AttributionRow {
  source: string;
  companyId: string;
  advertiser: string;
  rosterName: string;
  n: number;
  /** Why it was flagged, for the reader to judge rather than just obey. */
  reason: string;
}

/** One month of the ingest chart: rows that FIRST appeared in that month. */
export interface IngestBucket {
  /** YYYY-MM. */
  month: string;
  /** Short label for the axis, e.g. "Jul". */
  label: string;
  /** YYYY, so a series crossing a new year can say which. */
  year: string;
  /**
   * The feeds carrying 95% of the archive had not all started this month, so
   * the bar is short for collection reasons rather than market ones. Drawn,
   * but marked — see the note in the handler.
   */
  partial: boolean;
  /** Of the rows first seen that month, how many are still advertised. */
  live: number;
  /** The rest — seen once, since taken down. */
  archived: number;
}

/**
 * How much of the archive the taxonomy can read.
 *
 * `prevPct` is the SAME measurement over the preceding window, never a
 * different one — comparing an exact-day count against a reconstruction is
 * mostly measuring the difference between the two methods, which is this
 * codebase's most-repeated trap.
 */
export interface MatchRate {
  mapped: number;
  unmapped: number;
  pct: number;
  /** Null until the archive is old enough to hold a full prior window. */
  prevPct: number | null;
}

export interface DataQuality {
  ok: boolean;
  /** Set when the caller may not see this, or the archive is unreachable. */
  error?: string;
  generated: string;
  feeds: FeedRow[];
  unmappedTotal: number;
  unmapped: UnmappedRow[];
  attribution: AttributionRow[];
  ingest: IngestBucket[];
  match: MatchRate;
  /** The window the figures below were actually computed over, in days. */
  windowDays: number;
  /**
   * Oldest month the ingest chart can honestly start at: a month is only
   * comparable once the feeds carrying it had arrived. See the note in the
   * handler — without it the chart draws the archive filling out and reads as
   * a hiring surge.
   */
  ingestFrom: string;
}

const EMPTY: DataQuality = {
  ok: false,
  generated: "",
  feeds: [],
  unmappedTotal: 0,
  unmapped: [],
  attribution: [],
  ingest: [],
  match: { mapped: 0, unmapped: 0, pct: 0, prevPct: null },
  windowDays: 30,
  ingestFrom: "",
};

function daysSince(day: string, today: string): number {
  const a = Date.parse(day + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export const getDataQuality = createServerFn({ method: "GET" })
  .validator((data: { days?: number }) => data)
  .handler(async ({ data }): Promise<DataQuality> => {
    if ((await callerRole()) !== "admin") return { ...EMPTY, error: "Not permitted." };
    const db = await d1();
    if (!db) return { ...EMPTY, error: "The archive is unavailable right now." };
    const today = new Date().toISOString().slice(0, 10);
    // The window the console's range control asked for. Clamped to values the
    // control can actually produce rather than trusted, since it arrives from
    // the caller: an unbounded number here would be interpolated into the SQL
    // below.
    const DAYS = [1, 7, 30].includes(Number(data?.days)) ? Number(data.days) : 30;

    try {
      // 1. Feed freshness. `live` uses the same "currently advertised" rule the
      //    app itself uses (last_seen within a day), so this panel and a
      //    company card cannot disagree about what is open.
      const feedRes = await db
        .prepare(
          `SELECT source,
                  MAX(last_seen) AS last_seen,
                  MIN(first_seen) AS first_seen,
                  COUNT(*) AS total,
                  COUNT(DISTINCT company_id) AS companies,
                  MAX(company_id) AS a_company,
                  SUM(CASE WHEN last_seen >= date('now','-1 day') THEN 1 ELSE 0 END) AS live
             FROM jobs
            GROUP BY source
            ORDER BY source`,
        )
        .all();
      const rosterName = new Map(COMPANIES.map((c) => [c.id, c.name]));
      const feeds: FeedRow[] = (feedRes?.results ?? [])
        // Dropped before anything downstream counts them, so the silent tally,
        // the "N of M sources" footer and the KPI all agree. Filtering in the
        // component instead would leave M counting a row the table cannot show.
        .filter((r) => !ON_DEMAND_SOURCES.has(String(r.source || "")))
        .map((r) => {
          const lastSeen = String(r.last_seen || "");
          const source = String(r.source || "");
          const companies = Number(r.companies) || 0;
          // a_company is only meaningful when the source carries exactly one, and
          // sourceKind is the only thing that reads it — MAX() over a single
          // group value is just "that value".
          const sole = companies === 1 ? (rosterName.get(String(r.a_company || "")) ?? null) : null;
          return {
            source,
            lastSeen,
            firstSeen: String(r.first_seen || ""),
            live: Number(r.live) || 0,
            total: Number(r.total) || 0,
            staleDays: lastSeen ? daysSince(lastSeen, today) : 999,
            historical: HISTORICAL_SOURCES.has(source),
            kind: sourceKind(source, companies, sole),
          };
        });

      // 2. Titles that mapped to no skill at all. These are the taxonomy's
      //    blind spots: the role is archived and counted, but contributes
      //    nothing to any demand figure, so it is invisible in exactly the
      //    place it would matter. Grouped by title so the recurring ones —
      //    the ones worth a taxonomy term — sort to the top.
      const unmappedRes = await db
        .prepare(
          `SELECT title, COUNT(*) AS n
             FROM jobs
            WHERE (skills IS NULL OR skills = '[]')
              AND last_seen >= date('now','-${DAYS} day')
              AND title <> ''
            GROUP BY title
            ORDER BY n DESC
            LIMIT 40`,
        )
        .all();
      const unmapped: UnmappedRow[] = (unmappedRes?.results ?? []).map((r) => ({
        title: String(r.title || ""),
        n: Number(r.n) || 0,
      }));
      const totalRes = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM jobs
            WHERE (skills IS NULL OR skills = '[]')
              AND last_seen >= date('now','-${DAYS} day')`,
        )
        .first();
      const unmappedTotal = Number(totalRes?.n) || 0;

      // 3. Rows whose advertiser does not look like the company they are filed
      //    under. Most mismatches are correct — Adzuna returns the BRAND, and
      //    CHEP really is Brambles — so only the two shapes that indicate a
      //    genuine fault are surfaced: the roster name appearing inside a word,
      //    and an advertiser that is a DIFFERENT roster company.
      const attrRes = await db
        .prepare(
          `SELECT source, company_id, company, COUNT(*) AS n
             FROM jobs
            WHERE company IS NOT NULL AND company <> '' AND company_id IS NOT NULL
              AND last_seen >= date('now','-${DAYS} day')
            GROUP BY source, company_id, company`,
        )
        .all();
      const nameOf = new Map(COMPANIES.map((c) => [c.id, c.name]));
      const byName = new Map<string, string>();
      for (const c of COMPANIES) {
        const k = normName(c.name);
        if (k && !byName.has(k)) byName.set(k, c.id);
      }
      const attribution: AttributionRow[] = [];
      for (const r of attrRes?.results ?? []) {
        const companyId = String(r.company_id || "");
        const advertiser = String(r.company || "");
        const rosterName = nameOf.get(companyId);
        if (!rosterName) continue;
        if (sameCompanyName(advertiser, rosterName)) continue;

        let reason = "";
        if (substringOnlyMatch(advertiser, rosterName)) {
          reason = `matches "${rosterName}" only inside a word`;
        } else {
          for (const [k, id] of byName) {
            if (id === companyId) continue;
            if (sameCompanyName(advertiser, k)) {
              reason = `is roster company ${id}`;
              break;
            }
          }
        }
        if (!reason) continue; // a brand name — expected, not a fault
        attribution.push({
          source: String(r.source || ""),
          companyId,
          advertiser,
          rosterName,
          n: Number(r.n) || 0,
          reason,
        });
      }
      attribution.sort((a, b) => b.n - a.n);

      // 4. Ingest volume by month, split into rows still advertised and rows
      //    since taken down. Keyed on first_seen, so each row is counted in the
      //    month it ARRIVED and appears exactly once across the chart.
      //
      //    THE WHOLE ARCHIVE IS DRAWN AND THE SHORT MONTHS ARE MARKED, which
      //    are different things — the first version of this chart confused them
      //    and showed one bar.
      //
      //    The difficulty is real. A month is only comparable once the feeds
      //    covering it had arrived, and the archive's earliest months hold a
      //    handful of sources rather than a quiet market, so an unmarked series
      //    draws the ARCHIVE filling out and reads as a hiring surge. But the
      //    first fix — start where EVERY live feed had arrived — was worse, and
      //    measurably so. Measured 2026-09-22: that rule returned 2026-09-21,
      //    set by `portal-undefined`, a 33-row feed one day old, so a
      //    three-month archive rendered as a single September bar. It is the
      //    "a strict rule lets three ads collapse a series to nothing" trap
      //    this codebase already names.
      //
      //    So coverage is weighed by SHARE, at the same 95% the analyst's
      //    coverageDay uses: the day by which feeds carrying 95% of the rows
      //    had all started. Measured the same day that is 2026-08-03 — and 90%
      //    gives the same date, so it is not knife-edge — against a strict
      //    2026-09-21. Earlier months are returned with `partial: true` and the
      //    card says so, which is the point: the reader gets the whole history
      //    AND is told which part of it is short for collection reasons.
      //
      //    Closed corpora are excluded outright. wayback's rows are dated
      //    2003-2018, so bucketing them would put ~90 empty months either side
      //    of the three real ones.
      const COVERAGE_TARGET = 0.95;
      const contributing = feeds.filter((f) => !f.historical && f.firstSeen && f.total > 0);
      const totalRows = contributing.reduce((t, f) => t + f.total, 0);
      let acc = 0;
      let coverFrom = "";
      for (const f of [...contributing].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen))) {
        acc += f.total;
        if (acc >= totalRows * COVERAGE_TARGET) {
          coverFrom = f.firstSeen;
          break;
        }
      }
      const histList = [...HISTORICAL_SOURCES].map((h) => `'${h}'`).join(",") || "''";
      const ingestRes = await db
        .prepare(
          `SELECT substr(first_seen,1,7) AS ym,
                  COUNT(*) AS total,
                  SUM(CASE WHEN last_seen >= date('now','-1 day') THEN 1 ELSE 0 END) AS live
             FROM jobs
            WHERE first_seen <> '' AND source NOT IN (${histList})
            GROUP BY ym
            ORDER BY ym`,
        )
        .all();
      const MON = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      const ingest: IngestBucket[] = (ingestRes?.results ?? []).map((r) => {
        const month = String(r.ym || "");
        const total = Number(r.total) || 0;
        const live = Number(r.live) || 0;
        const mi = Number(month.slice(5, 7)) - 1;
        return {
          month,
          label: MON[mi] ?? month,
          year: month.slice(0, 4),
          live,
          archived: Math.max(0, total - live),
          partial: !!coverFrom && month < coverFrom.slice(0, 7),
        };
      });

      // 5. Skill match rate over the same 30-day window the unmapped list uses,
      //    and the same measurement again over the 30 days before it. Both
      //    halves are counted the identical way; the only difference is which
      //    days they cover.
      const matchRow = await db
        .prepare(
          `SELECT SUM(CASE WHEN skills IS NULL OR skills = '[]' THEN 0 ELSE 1 END) AS mapped,
                  SUM(CASE WHEN skills IS NULL OR skills = '[]' THEN 1 ELSE 0 END) AS unmapped
             FROM jobs
            WHERE last_seen >= date('now','-${DAYS} day')`,
        )
        .first();
      const prevRow = await db
        .prepare(
          `SELECT SUM(CASE WHEN skills IS NULL OR skills = '[]' THEN 0 ELSE 1 END) AS mapped,
                  SUM(CASE WHEN skills IS NULL OR skills = '[]' THEN 1 ELSE 0 END) AS unmapped
             FROM jobs
            WHERE last_seen >= date('now','-${2 * DAYS} day')
              AND last_seen <  date('now','-${DAYS} day')`,
        )
        .first();
      const pctOf = (m: number, u: number) => (m + u > 0 ? (100 * m) / (m + u) : 0);
      const mMapped = Number(matchRow?.mapped) || 0;
      const mUnmapped = Number(matchRow?.unmapped) || 0;
      const pMapped = Number(prevRow?.mapped) || 0;
      const pUnmapped = Number(prevRow?.unmapped) || 0;
      const match: MatchRate = {
        mapped: mMapped,
        unmapped: mUnmapped,
        pct: pctOf(mMapped, mUnmapped),
        // Suppressed rather than shown as a swing off nothing when the prior
        // window is empty, which it is for any feed younger than 60 days.
        prevPct: pMapped + pUnmapped > 0 ? pctOf(pMapped, pUnmapped) : null,
      };

      return {
        ok: true,
        generated: today,
        feeds,
        unmappedTotal,
        unmapped,
        attribution: attribution.slice(0, 40),
        ingest,
        match,
        ingestFrom: coverFrom,
        // Echoed back rather than assumed by the caller: the handler clamps
        // what it was given, so the card must label its figures with the
        // window that was actually used.
        windowDays: DAYS,
      };
    } catch {
      return { ...EMPTY, error: "Couldn't read the archive." };
    }
  });
