// Append-only historical archive of every job we pull from Adzuna, The Muse and
// Jooble, written to a Cloudflare D1 (SQLite) database. Both the daily jobs-cron
// worker and the app's live per-company fetch call archiveJobs, so the archive
// accumulates across all three sources and every market.
//
// Storage model: one row per distinct listing, keyed by a stable
// source|title|company|location hash. Re-seeing a listing on a later run bumps
// last_seen + seen_count rather than inserting a duplicate, so the table is a
// deduped history with first-seen / last-seen dates — the raw material for
// "how long has this role been open", vacancy longevity, and time-series
// reporting the KV snapshots can't provide.
//
// The db handle is passed in (never imported) so this module stays free of any
// worker-only bindings and can be shared by both bundles. When no D1 binding is
// present (e.g. before the database is provisioned) callers pass a falsy handle
// and archiveJobs is a no-op, so the pipeline runs unchanged until it's wired.

// Minimal structural type for the D1 surface we use — avoids depending on
// @cloudflare/workers-types in the app bundle.
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): unknown;
  };
  batch(statements: unknown[]): Promise<unknown>;
}

export interface ArchiveRow {
  source: string; // adzuna | muse | jooble
  title: string;
  company?: string | null; // employer name from the ad
  companyId?: string | null; // app company id, for company-scoped pulls
  hub?: string | null; // matched city / hub key
  location?: string; // raw location text
  category?: string; // job category / posted-via platform
  salary?: string | null; // when the source states one
  url?: string;
  posted?: string; // the ad's own date (YYYY-MM-DD)
  skills?: string[]; // mapped canonical skills
}

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
}

// A stable key so the same ad from the same source dedupes across runs.
function jobKey(r: ArchiveRow): string {
  return [r.source, norm(r.title), norm(r.company || r.companyId || ''), norm(r.location || r.hub || '')].join('|').slice(0, 400);
}

// Upsert a batch of listings. New listings insert with first_seen = last_seen =
// today; re-seen listings bump last_seen + seen_count and backfill any field
// that was previously empty. Best-effort: a D1 hiccup never breaks the pull.
export async function archiveJobs(db: D1Like | null | undefined, rows: ArchiveRow[], today: string): Promise<void> {
  if (!db || !rows.length) return;
  const stmt = db.prepare(
    `INSERT INTO jobs
       (job_key, source, title, company, company_id, hub, location, category, salary, url, posted, skills, first_seen, last_seen, seen_count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, 1)
     ON CONFLICT(job_key) DO UPDATE SET
       last_seen  = ?13,
       seen_count = seen_count + 1,
       salary     = COALESCE(salary, ?9),
       url        = COALESCE(NULLIF(url, ''), ?10),
       posted     = COALESCE(NULLIF(posted, ''), ?11),
       skills     = COALESCE(skills, ?12)`,
  );
  const seen = new Set<string>();
  const stmts: unknown[] = [];
  for (const r of rows) {
    if (!r.title) continue;
    const key = jobKey(r);
    if (seen.has(key)) continue; // collapse duplicates within this batch
    seen.add(key);
    stmts.push(
      stmt.bind(
        key,
        r.source,
        r.title,
        r.company ?? null,
        r.companyId ?? null,
        r.hub ?? null,
        r.location ?? '',
        r.category ?? '',
        r.salary ?? null,
        r.url ?? '',
        r.posted ?? '',
        r.skills && r.skills.length ? JSON.stringify(r.skills) : null,
        today,
      ),
    );
  }
  try {
    // D1 caps statements per batch; chunk to stay well under it.
    for (let i = 0; i < stmts.length; i += 50) {
      await db.batch(stmts.slice(i, i + 50));
    }
  } catch {
    // history is best-effort — never let an archive write break the live pull
  }
}
