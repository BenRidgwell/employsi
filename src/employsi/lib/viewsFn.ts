import { createServerFn } from '@tanstack/react-start';
import type { D1Like } from './jobArchive';

// Real "Most viewed" tracking for the What's Trending pane. Every time a user
// opens a company, drops into a city, views a region/continent, or colours the
// map by a skill, the client records a view here; the pane then shows the truly
// most-viewed items with their share of all views. Stored in the shared D1
// archive DB in a dedicated `views` table (one row per kind+ref, a running
// count), so it's durable and cheap to aggregate.
//
// This accumulates real usage during dev/preview. To WIPE it before production
// (as intended), run:
//   wrangler d1 execute employsi-jobs-archive --remote --command "DELETE FROM views"

async function getDb(): Promise<D1Like | null> {
  try {
    const m: any = await import('cloudflare:workers');
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

let ensured = false;
async function ensureTable(db: D1Like): Promise<void> {
  if (ensured) return;
  await (db
    .prepare(
      `CREATE TABLE IF NOT EXISTS views (
         kind        TEXT NOT NULL,   -- company | city | continent | skill
         ref         TEXT NOT NULL,   -- stable id/key (company id, city id, skill name)
         label       TEXT,            -- display name
         sub         TEXT,            -- secondary label (sector, "City", region…)
         count       INTEGER NOT NULL DEFAULT 0,
         last_viewed TEXT,
         PRIMARY KEY (kind, ref)
       )`,
    ) as any).run();
  ensured = true;
}

export interface ViewInput {
  kind: 'company' | 'city' | 'continent' | 'skill';
  ref: string;
  label: string;
  sub?: string;
}

// Record one view (fire-and-forget from the client). Upserts the running count.
export const recordView = createServerFn({ method: 'POST' })
  .validator((d: ViewInput) => d)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const kind = (data?.kind || '').trim();
    const ref = (data?.ref || '').trim().slice(0, 120);
    const label = (data?.label || '').trim().slice(0, 120);
    if (!kind || !ref || !label) return { ok: false };
    const db = await getDb();
    if (!db) return { ok: false };
    try {
      await ensureTable(db);
      await (db
        .prepare(
          `INSERT INTO views (kind, ref, label, sub, count, last_viewed)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)
           ON CONFLICT(kind, ref) DO UPDATE SET
             count = count + 1,
             label = excluded.label,
             sub = excluded.sub,
             last_viewed = excluded.last_viewed`,
        )
        .bind(kind, ref, label, (data.sub || '').slice(0, 80), new Date().toISOString()) as any).run();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

export interface ViewedRow {
  kind: 'company' | 'city' | 'continent' | 'skill';
  ref: string;
  label: string;
  sub: string;
  count: number;
  share: string; // e.g. "23%"
}

// The most-viewed items across all kinds, each with its share of total views.
// Returns [] until any views have been recorded; the pane falls back to its
// static seed in that case.
export const getMostViewed = createServerFn({ method: 'GET' })
  .handler(async (): Promise<ViewedRow[]> => {
    const db = await getDb();
    if (!db) return [];
    try {
      await ensureTable(db);
      const tot: any = await ((db
        .prepare(`SELECT SUM(count) AS n FROM views`) as any).first());
      const total = Number(tot?.n) || 0;
      if (!total) return [];
      const res: any = await ((db
        .prepare(`SELECT kind, ref, label, sub, count FROM views ORDER BY count DESC, last_viewed DESC LIMIT 6`) as any).all());
      const rows: any[] = res?.results ?? [];
      return rows.map((r) => ({
        kind: String(r.kind) as ViewedRow['kind'],
        ref: String(r.ref),
        label: String(r.label || ''),
        sub: String(r.sub || ''),
        count: Number(r.count) || 0,
        share: `${Math.max(1, Math.round((Number(r.count) / total) * 100))}%`,
      }));
    } catch {
      return [];
    }
  });
