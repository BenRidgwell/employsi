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
//
// bind() returns the statement, and the statement carries all()/first()/run().
// It previously returned `unknown`, which meant every caller had to cast to
// `any` twice just to reach .all() — the reason nearly half this codebase's
// explicit `any`s existed. Typing the chain properly removes the casts and
// gives real column types at the call sites.
export type SqlValue = string | number | boolean | null;
export type SqlRow = Record<string, SqlValue>;

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = SqlRow>(): Promise<{ results?: T[] } | null>;
  first<T = SqlRow>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(query: string): D1Statement;
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

/**
 * Sources that are CLOSED CORPORA, not feeds — a fixed set of rows recovered
 * once, not a market being watched.
 *
 * `wayback` recovers advertisements from dead career sites through the Internet
 * Archive (scripts/wayback-to-d1.py). Measured on production 2026-08-12: 8,436
 * rows spanning first_seen 2003-12-29 to last_seen 2018-04-22, and the only
 * source in the archive with any first_seen before 2020.
 *
 * They live in the same table as the live feeds because they are the same kind
 * of thing — an ad that was up on a day — and the company card's history wants
 * them. But any aggregate that means "the market NOW", or that derives the
 * archive's own depth from MIN(first_seen), has to leave them out, because on
 * those questions they are not old data, they are the wrong data. Measured on
 * the same day: BHP's span reads 2003-12-29 → 2026-08-12 with them and
 * 2026-07-16 → 2026-08-12 without, so "collected since" was wrong by 22 years
 * and 95% of BHP's rows are Wayback.
 */
export const HISTORICAL_SOURCES = new Set(["wayback"]);

/**
 * The above as a SQL predicate, to `AND` onto a WHERE clause.
 *
 * COALESCE rather than a bare `NOT IN`: a NULL source would make `NOT IN`
 * evaluate to NULL and drop the row silently. There are none today, but an
 * unattributed row is far likelier to be a live feed with a parser fault than a
 * closed corpus, and losing it without trace is the worse failure.
 */
export const LIVE_FEEDS_ONLY_SQL = `COALESCE(source,'') NOT IN (${[...HISTORICAL_SOURCES]
  .map((s) => `'${s}'`)
  .join(",")})`;

/**
 * How many days a feed's rows keep reading as "currently advertised".
 *
 * "Live" is an INFERENCE, not an observation: the archive holds the day a feed
 * last SAW an ad, never the day the ad came down. So the grace period has to
 * match the cadence of the feed that wrote the row — it is the resolution at
 * which that feed can tell us anything at all. One day is right for a feed that
 * runs nightly, because yesterday's sighting is the most recent one there can
 * be. It is simply wrong for a feed that runs weekly.
 *
 * MEASURED 2026-10-03, and the reason this exists. Edith Cowan University's
 * Chief People Officer ad was collected by LinkedIn on 2026-09-25 and last seen
 * on 2026-09-28. linkedin-archive.yml runs MONDAYS (17:20 UTC), so the next
 * sighting could not arrive before 2026-10-05 — and under a flat one-day rule
 * the ad read as closed from 2026-09-29, six days of every seven, while it was
 * still up. The commit that set that cadence said as much: "LinkedIn's own rows
 * will read as currently advertised only on the day of the run."
 *
 * Eight days, not seven: a week, plus the same one day of slack a daily feed
 * gets for not having run yet. That is deliberately TIGHTER than
 * scraper-health.py's 10-day staleness allowance for LinkedIn, which asks a
 * different question — "has this feed stopped working" tolerates one late
 * Monday, where "is this ad still up" should expire the moment a run that
 * should have refreshed it has not.
 *
 * THE COST, STATED: an ad taken down on the Tuesday keeps counting until the
 * following Monday. The archive cannot tell that case from one still open, and
 * the alternative error was far larger and ran the other way — reporting zero
 * live ads for an employer that was advertising all week. Any figure built on a
 * weekly feed is a figure at weekly resolution, which is the honest reading of
 * what the feed collects.
 *
 * A source absent from this map gets DEFAULT_LIVE_DAYS. Adding a weekly or
 * fortnightly feed means adding it here, or its ads flicker in and out of every
 * live count in the app.
 */
export const SOURCE_LIVE_DAYS: Record<string, number> = { linkedin: 8 };

/** Every feed not named above runs nightly, so yesterday is the live cut. */
export const DEFAULT_LIVE_DAYS = 1;

export const liveDaysFor = (source: string | null | undefined): number =>
  SOURCE_LIVE_DAYS[(source || "").trim()] ?? DEFAULT_LIVE_DAYS;

/**
 * The oldest `last_seen` that still reads as live ON `day`, for this source.
 *
 * `day` is the reference day the caller is asking about — normally yesterday,
 * the newest day the feeds have finished reporting. A nightly feed's answer is
 * `day` itself, which is exactly the old behaviour.
 */
export function liveFromFor(source: string | null | undefined, day: string): string {
  const back = liveDaysFor(source) - 1;
  if (!back || !day) return day;
  return new Date(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) - back * 864e5)
    .toISOString()
    .slice(0, 10);
}

/** Was a row with this `last_seen`, from this source, still live on `day`? */
export const isLiveOn = (
  lastSeen: string | null | undefined,
  source: string | null | undefined,
  day: string,
): boolean => !!lastSeen && String(lastSeen) >= liveFromFor(source, day);

// The same per-source grace as a SQL expression, built from the map above so
// the two cannot drift. `offset` turns a source's allowance into a date
// modifier; the ELSE branch carries DEFAULT_LIVE_DAYS.
//
// COALESCE for the same reason LIVE_FEEDS_ONLY_SQL uses it: a NULL source must
// fall to the default rather than making the comparison NULL and dropping the
// row without trace.
const graceCase = (offset: (days: number) => string) =>
  `CASE COALESCE(source,'') ${Object.entries(SOURCE_LIVE_DAYS)
    .map(([src, d]) => `WHEN '${src}' THEN '${offset(d)}'`)
    .join(" ")} ELSE '${offset(DEFAULT_LIVE_DAYS)}' END`;

/**
 * Rows that are currently advertised, as a WHERE fragment. Binds nothing.
 *
 * For every nightly feed this is `last_seen >= date('now','-1 day')`, which is
 * what it has always been and what the company cards count.
 */
export const LIVE_NOW_SQL = `last_seen >= date('now', ${graceCase((d) => `-${d} day`)})`;

/**
 * Open on a given day, as a WHERE fragment. The day is bound TWICE, in order.
 *
 * An ad is live on day D if it was first seen on or before D and last seen on
 * or after D — less the grace its feed is owed, because a weekly feed cannot
 * have seen it on D even when it was up. Spans collection gaps for the same
 * reason it always did: an ad first seen on the 3rd and last seen on the 9th is
 * live on the 6th whether or not any row carries that date.
 */
export const LIVE_ON_DAY_SQL = `first_seen <= ? AND last_seen >= date(?, ${graceCase(
  (d) => `-${d - 1} day`,
)})`;

/**
 * LIVE_ON_DAY_SQL with the day as a NUMBERED bind, so it is supplied once.
 *
 * Same predicate, different binding style. Two call sites read the day as `?1`
 * because they bind a second parameter after it, and silently swapping them to
 * positional `?` would have bound the day where the skill pattern goes.
 */
export const liveOnDaySql = (n = 1) => `first_seen <= ?${n} AND ${liveSinceDaySql(n)}`;

/**
 * Just the trailing half of liveOnDaySql: last seen recently enough, for this
 * row's source, measured against a bound reference day.
 *
 * Used where the caller is already scoping by month or by company and only
 * wants the "has a feed seen it lately" cut, not the full open-on-a-day
 * reconstruction.
 */
export const liveSinceDaySql = (n = 1) =>
  `last_seen >= date(?${n}, ${graceCase((d) => `-${d - 1} day`)})`;

/** The day the app means by "now": yesterday, never the part-collected today. */
export const LIVE_DAY_SQL = "date('now','-1 day')";

/** LIVE_ON_DAY_SQL anchored to that day, so it binds nothing. */
export const LIVE_NOW_ON_DAY_SQL =
  `first_seen <= ${LIVE_DAY_SQL} AND last_seen >= ` +
  `date(${LIVE_DAY_SQL}, ${graceCase((d) => `-${d - 1} day`)})`;

// Han, kana and Hangul. A string containing any of them is normalised keeping
// every letter and digit, because the ASCII rule below deletes them all.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function norm(s: string): string {
  // CJK TEXT WAS ERASED BY THE ASCII RULE, and every title in it keyed as "".
  // Measured 2026-09-30 on the first run of the Chinese own-board feeds:
  // NetEase fetched 2,654 roles and wrote 172 rows — one per city, since
  // title and company both normalised to nothing and only the (Chinese) place
  // told rows apart, and a Chinese place collapsed too. Ping An: 2,770 -> 27.
  // Only strings WITH CJK take the Unicode path, so every existing Latin key
  // (accents included — "Crédit" still keys as "cr dit") is byte-for-byte what
  // it was; changing those would split every such role into two rows until the
  // old one aged out.
  if (CJK.test(s || "")) {
    return (s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .slice(0, 120);
  }
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

import { roleKey } from "./roleKey";

// A stable key so the same ad from the same source dedupes across runs.
//
// SOURCE IS THE FIRST FIELD, which is why one job on two boards is two rows.
// That is kept on purpose — it is the record of what each feed showed, and the
// coverage checks read it — and `role_key` below is what lets a COUNT see
// those two rows as one role. See lib/roleKey.ts.
export function jobKey(r: ArchiveRow): string {
  return [
    r.source,
    norm(r.title),
    norm(r.company || r.companyId || ""),
    norm(r.location || r.hub || ""),
  ]
    .join("|")
    .slice(0, 400);
}

// Upsert a batch of listings. New listings insert with first_seen = last_seen =
// today; re-seen listings bump last_seen + seen_count and backfill any field
// that was previously empty. Best-effort: a D1 hiccup never breaks the pull.
export async function archiveJobs(
  db: D1Like | null | undefined,
  rows: ArchiveRow[],
  today: string,
): Promise<void> {
  if (!db || !rows.length) return;
  // `role_key` is added lazily, the same way llm_usage and the other late
  // tables are: the column did not exist when this table was created, and a
  // migration that has to be run by hand before a deploy is a migration
  // someone forgets. ALTER TABLE throws once the column is there, which is the
  // success case, so the error is swallowed.
  try {
    await db.prepare("ALTER TABLE jobs ADD COLUMN role_key TEXT").run?.();
  } catch {
    /* already added — the only outcome after the first run */
  }
  try {
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_jobs_role_key ON jobs(role_key)").run?.();
  } catch {
    /* best effort: the counts are correct without it, only slower */
  }
  const stmt = db.prepare(
    `INSERT INTO jobs
       (job_key, role_key, source, title, company, company_id, hub, location, category, salary, url, posted, skills, first_seen, last_seen, seen_count)
     VALUES (?1, ?14, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, 1)
     ON CONFLICT(job_key) DO UPDATE SET
       last_seen  = ?13,
       seen_count = seen_count + 1,
       salary     = COALESCE(salary, ?9),
       url        = COALESCE(NULLIF(url, ''), ?10),
       posted     = COALESCE(NULLIF(posted, ''), ?11),
       skills     = COALESCE(skills, ?12),
       -- Set on re-seen rows too, so the archive fills in without a backfill
       -- for anything still being advertised. Only the dormant rows need one.
       role_key   = COALESCE(NULLIF(role_key, ''), ?14)`,
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
        r.location ?? "",
        r.category ?? "",
        r.salary ?? null,
        r.url ?? "",
        r.posted ?? "",
        r.skills && r.skills.length ? JSON.stringify(r.skills) : null,
        today,
        roleKey(r.companyId, r.company, r.hub, r.location, r.title),
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
