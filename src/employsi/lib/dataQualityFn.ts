import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import type { D1Like } from "./jobArchive";
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

export interface FeedRow {
  source: string;
  /** Most recent day this source wrote anything. */
  lastSeen: string;
  /** Rows it still counts as currently advertised. */
  live: number;
  total: number;
  /** Whole days since it last wrote. */
  staleDays: number;
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
                  COUNT(*) AS total,
                  SUM(CASE WHEN last_seen >= date('now','-1 day') THEN 1 ELSE 0 END) AS live
             FROM jobs
            GROUP BY source
            ORDER BY source`,
        )
        .all();
      const feeds: FeedRow[] = (feedRes?.results ?? []).map((r) => {
        const lastSeen = String(r.last_seen || "");
        return {
          source: String(r.source || ""),
          lastSeen,
          live: Number(r.live) || 0,
          total: Number(r.total) || 0,
          staleDays: lastSeen ? daysSince(lastSeen, today) : 999,
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
