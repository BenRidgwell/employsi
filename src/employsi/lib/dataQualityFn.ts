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

export interface DataQuality {
  ok: boolean;
  /** Set when the caller may not see this, or the archive is unreachable. */
  error?: string;
  generated: string;
  feeds: FeedRow[];
  unmappedTotal: number;
  unmapped: UnmappedRow[];
  attribution: AttributionRow[];
}

const EMPTY: DataQuality = {
  ok: false,
  generated: "",
  feeds: [],
  unmappedTotal: 0,
  unmapped: [],
  attribution: [],
};

function daysSince(day: string, today: string): number {
  const a = Date.parse(day + "T00:00:00Z");
  const b = Date.parse(today + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

export const getDataQuality = createServerFn({ method: "GET" }).handler(
  async (): Promise<DataQuality> => {
    if ((await callerRole()) !== "admin") return { ...EMPTY, error: "Not permitted." };
    const db = await d1();
    if (!db) return { ...EMPTY, error: "The archive is unavailable right now." };
    const today = new Date().toISOString().slice(0, 10);

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
      const feeds: FeedRow[] = (feedRes?.results ?? []).map((r) => {
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
              AND last_seen >= date('now','-30 day')
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
            WHERE (skills IS NULL OR skills = '[]') AND last_seen >= date('now','-30 day')`,
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
              AND last_seen >= date('now','-30 day')
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

      return {
        ok: true,
        generated: today,
        feeds,
        unmappedTotal,
        unmapped,
        attribution: attribution.slice(0, 40),
      };
    } catch {
      return { ...EMPTY, error: "Couldn't read the archive." };
    }
  },
);
