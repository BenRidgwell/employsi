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

// A skill demand mover: how a canonical skill's presence in this company's
// vacancies has shifted between an earlier window and the most recent one.
export interface SkillMover {
  skill: string;
  now: number; // listings mentioning it in the recent window
  prev: number; // ...in the prior window
  delta: number; // now − prev
  pct: number; // % change (100 when newly appearing)
  dir: 'up' | 'down';
}

// The top skill increases / decreases for a company, from historical vacancy
// analysis of the D1 archive. Each archived listing carries its mapped skills +
// the window it was live (first_seen…last_seen); we tally skill mentions in the
// most-recent WINDOW days vs the WINDOW days before that and rank the biggest
// movers. Powers the card's "where they're hiring" area (now demand shifts).
// Sparse until the archive has more than one window of history — it fills in as
// the daily pulls accumulate.
export const getSkillTrends = createServerFn({ method: 'GET' })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<SkillMover[]> => {
    const id = (data.id || '').trim();
    if (!id) return [];
    const db = await getArchiveDb();
    if (!db) return [];
    try {
      const res: any = await (db
        .prepare(`SELECT skills, first_seen, last_seen FROM jobs WHERE company_id = ?1 AND skills IS NOT NULL`)
        .bind(id) as any).all();
      const rows: any[] = res?.results ?? [];
      if (!rows.length) return [];
      const WINDOW = 30; // days per comparison window
      const day = (offset: number) => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - offset);
        return d.toISOString().slice(0, 10);
      };
      const recentStart = day(WINDOW);
      const priorStart = day(WINDOW * 2);
      const priorEnd = recentStart;
      const nowT: Record<string, number> = {};
      const prevT: Record<string, number> = {};
      for (const r of rows) {
        let skills: string[] = [];
        try {
          skills = JSON.parse(String(r.skills || '[]'));
        } catch {
          skills = [];
        }
        if (!skills.length) continue;
        const fs = String(r.first_seen || '');
        const ls = String(r.last_seen || '');
        if (!fs || !ls) continue;
        // Active in the recent window (…first_seen ≤ today & last_seen ≥ start).
        if (ls >= recentStart) for (const s of skills) nowT[s] = (nowT[s] || 0) + 1;
        // Active in the prior window.
        if (fs <= priorEnd && ls >= priorStart) for (const s of skills) prevT[s] = (prevT[s] || 0) + 1;
      }
      const skills = new Set([...Object.keys(nowT), ...Object.keys(prevT)]);
      const movers: SkillMover[] = [];
      for (const s of skills) {
        const now = nowT[s] || 0;
        const prev = prevT[s] || 0;
        const delta = now - prev;
        if (delta === 0) continue;
        const pct = prev > 0 ? Math.round((delta / prev) * 100) : 100;
        movers.push({ skill: s, now, prev, delta, pct, dir: delta > 0 ? 'up' : 'down' });
      }
      // Biggest absolute movers first, increases ahead of decreases on ties.
      movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.delta - a.delta);
      return movers.slice(0, 8);
    } catch {
      return [];
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
