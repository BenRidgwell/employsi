import { createServerFn } from '@tanstack/react-start';
import type { D1Like } from './jobArchive';
import type { RolePoint } from './openRolesFn';

// Reads the historical job archive (Cloudflare D1) written by the jobs-cron
// worker + the app's live fetch (see jobArchive.ts). Powers the "Vacancy
// history" section on the company card: which roles a company has advertised,
// how long each has been open (first-seen → most recent), and how many pulls
// it's appeared in. History builds forward from when the archive started, so
// the "days open" figures grow over the days/weeks after a role first appears.

export interface RoleHistoryItem {
  title: string;
  source: string; // adzuna | muse | jooble
  location: string;
  salary: string | null;
  firstSeen: string; // YYYY-MM-DD
  lastSeen: string; // YYYY-MM-DD
  seenCount: number;
  daysOpen: number; // lastSeen − firstSeen, in days (0 when first seen today)
  active: boolean; // still appearing in the most recent pulls
}

export interface RoleHistory {
  total: number; // distinct roles archived for this company
  since: string; // earliest first_seen across them
  longestDays: number; // longest-running role's days open
  items: RoleHistoryItem[]; // longest-open first, capped
}

async function getArchiveDb(): Promise<D1Like | null> {
  try {
    const m: any = await import('cloudflare:workers');
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 86400000));
}

export const getRoleHistory = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<RoleHistory | null> => {
    const id = (data.id || '').trim();
    if (!id) return null;
    const db = await getArchiveDb();
    if (!db) return null;
    const today = new Date().toISOString().slice(0, 10);
    try {
      // Longest-running first: order by the first-seen → last-seen span.
      const rowsRes: any = await (db
        .prepare(
          `SELECT title, source, location, salary, first_seen, last_seen, seen_count
             FROM jobs
            WHERE company_id = ?1
            ORDER BY (julianday(last_seen) - julianday(first_seen)) DESC, first_seen ASC
            LIMIT 40`,
        )
        .bind(id) as any).all();
      const rows: any[] = rowsRes?.results ?? [];
      if (!rows.length) return null;

      const aggRes: any = await (db
        .prepare(`SELECT COUNT(*) AS n, MIN(first_seen) AS since FROM jobs WHERE company_id = ?1`)
        .bind(id) as any).first();
      const total = Number(aggRes?.n) || rows.length;
      const since = String(aggRes?.since || rows[0].first_seen);

      let longestDays = 0;
      const items: RoleHistoryItem[] = rows.map((r) => {
        const firstSeen = String(r.first_seen);
        const lastSeen = String(r.last_seen);
        const daysOpen = daysBetween(firstSeen, lastSeen);
        if (daysOpen > longestDays) longestDays = daysOpen;
        return {
          title: String(r.title || ''),
          source: String(r.source || ''),
          location: String(r.location || ''),
          salary: r.salary != null ? String(r.salary) : null,
          firstSeen,
          lastSeen,
          seenCount: Number(r.seen_count) || 1,
          daysOpen,
          active: lastSeen === today,
        };
      });
      return { total, since, longestDays, items };
    } catch {
      return null;
    }
  });

// A daily "live vacancies" time-series derived from the D1 archive: for each of
// the last N days, how many of the company's archived listings were live that
// day (first_seen ≤ day ≤ last_seen). This powers the vacancy-movement chart
// from the *stored history* (all sources — Adzuna, Muse, Jooble, SEEK, WA-gov),
// which is what lets the WA government agencies — whose live count comes from
// the scraped board, not Adzuna — show the same current+historical graph the
// private companies get. Builds forward as the archive accumulates, so a
// freshly-seeded company shows a short series that lengthens over the days.
export const getVacancyTrend = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<RolePoint[]> => {
    const id = (data.id || '').trim();
    if (!id) return [];
    const db = await getArchiveDb();
    if (!db) return [];
    try {
      const res: any = await (db
        .prepare(`SELECT first_seen, last_seen FROM jobs WHERE company_id = ?1`)
        .bind(id) as any).all();
      const rows: any[] = res?.results ?? [];
      if (!rows.length) return [];
      const spans = rows
        .map((r) => [String(r.first_seen || ''), String(r.last_seen || '')])
        .filter(([fs, ls]) => fs && ls);
      const DAYS = 90;
      const now = new Date();
      const series: RolePoint[] = [];
      for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        const ds = d.toISOString().slice(0, 10);
        let c = 0;
        for (const [fs, ls] of spans) if (fs <= ds && ds <= ls) c++;
        series.push({ d: ds, c });
      }
      // Drop the leading run of zeros before the archive had any data for this
      // company, so the chart starts where its history actually begins.
      const first = series.findIndex((p) => p.c > 0);
      return first <= 0 ? series : series.slice(first);
    } catch {
      return [];
    }
  });
