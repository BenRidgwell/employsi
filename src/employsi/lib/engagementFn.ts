import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import type { D1Like } from "./jobArchive";

/**
 * The admin console's Engagement tab, read from app_event and the auth tables.
 *
 * ADMIN ONLY, ENFORCED HERE, for the same reason dataQualityFn is: the role is
 * re-derived from the session cookie rather than taken from the caller. This
 * returns per-cohort behaviour of named accounts, which no end user has any
 * business seeing.
 *
 * EVERY FIGURE IS A COUNT OF ROWS THAT EXIST.
 * Nothing is modelled, smoothed or extrapolated. Where there is no data yet the
 * answer is zero and the pane says the capture started recently — a young table
 * looks exactly like a dead product if you don't say which it is, and the whole
 * point of this console is to stop a reader being misled by a plausible number.
 *
 * WHY A COHORT IS A SIGNUP WEEK
 * Retention is measured against `user.createdAt`, not against first activity.
 * Signup is the moment the product made a promise; measuring from first activity
 * quietly excludes everyone who signed up and never came back, which is the
 * group retention is supposed to be about.
 *
 * WHY WEEKS RUN MONDAY-TO-MONDAY
 * SQLite's strftime('%W') is week-of-year and rolls over at new year in a way
 * that puts late December and early January in the same bucket. Weeks are
 * derived from the day string instead, in TypeScript, so a cohort is always
 * seven days and always starts on a Monday.
 */

const DAY_MS = 86_400_000;

async function d1(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

type Row = Record<string, unknown>;

async function all(db: D1Like, sql: string, ...bind: unknown[]): Promise<Row[]> {
  const st = db.prepare(sql) as unknown as {
    bind: (...a: unknown[]) => { all: () => Promise<{ results?: Row[] }> };
    all: () => Promise<{ results?: Row[] }>;
  };
  const q = bind.length ? st.bind(...bind) : st;
  const r = await q.all();
  return r?.results ?? [];
}

const n = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const s = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));

/** The Monday on or before `day` (YYYY-MM-DD), as YYYY-MM-DD. */
export function weekStart(day: string): string {
  const t = Date.parse(day + "T00:00:00Z");
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  // getUTCDay: 0 = Sunday. Monday-start means Sunday counts as day 6.
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(t - back * DAY_MS).toISOString().slice(0, 10);
}

function dayString(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export interface Leading {
  key: string;
  label: string;
  /** This week's figure. */
  value: number;
  /** Change on the week before, in whole units. Null when there is no prior week. */
  delta: number | null;
  /** Eight weeks, oldest first, for the sparkline. */
  series: number[];
  note: string;
}

export interface Cohort {
  /** Monday of the signup week. */
  week: string;
  size: number;
  /** W1..W5: how many of the cohort were active in each later week. Null = the
   *  week has not happened yet, which is not the same as nobody returning. */
  cells: (number | null)[];
}

export interface Lagging {
  key: string;
  label: string;
  value: number;
  delta: number | null;
  note: string;
}

export interface TimeBand {
  band: string;
  sessions: number;
  pct: number;
}

export interface Engagement {
  ok: boolean;
  error?: string;
  /** The trailing window the lagging figures were read over. */
  days: number;
  /** ISO day the capture's earliest row falls on, or "" when the table is empty. */
  since: string;
  /** Total rows, so a reader can tell "quiet product" from "just switched on". */
  events: number;
  generated: string;
  leading: Leading[];
  cohorts: Cohort[];
  lagging: Lagging[];
  timeBands: TimeBand[];
  medianSessionMs: number | null;
}

const EMPTY = (error?: string, days = 30): Engagement => ({
  ok: !error,
  error,
  days,
  since: "",
  events: 0,
  generated: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
  leading: [],
  cohorts: [],
  lagging: [],
  timeBands: [],
  medianSessionMs: null,
});

/** Session-length buckets. Fixed edges so the shape is comparable week to week. */
const BANDS: { band: string; lo: number; hi: number }[] = [
  { band: "< 30s", lo: 0, hi: 30_000 },
  { band: "30s – 2m", lo: 30_000, hi: 120_000 },
  { band: "2 – 5m", lo: 120_000, hi: 300_000 },
  { band: "5 – 10m", lo: 300_000, hi: 600_000 },
  { band: "10m +", lo: 600_000, hi: Infinity },
];

/**
 * `days` is the trailing window for the Lagging card, the session-length
 * distribution and the KPI row — the three things a window can honestly change.
 * The leading indicators are weekly by definition and cohorts are keyed on
 * signup week, so neither moves with it; the pane labels them accordingly
 * rather than letting the control imply it changed something it did not.
 */
export const getEngagement = createServerFn({ method: "GET" })
  .validator((data: { days?: number }) => data)
  .handler(async ({ data }): Promise<Engagement> => {
    const days = [1, 7, 30].includes(Number(data?.days)) ? Number(data.days) : 30;
    if ((await callerRole()) !== "admin") return EMPTY("Not permitted.", days);
    const db = await d1();
    if (!db) return EMPTY("The archive isn't reachable from here.", days);

    try {
      const meta = await all(db, "SELECT COUNT(*) AS n, MIN(day) AS since FROM app_event");
      const events = n(meta[0]?.n);
      const since = s(meta[0]?.since);

      // ── Leading indicators: eight Monday-start weeks of signed-in activity ──
      // Signed-in only, because that is the population retention is measured on
      // and mixing anonymous traffic in would make the two panes disagree.
      const from = dayString(56);
      const acts = await all(
        db,
        "SELECT day, name, user_key, session_id FROM app_event" +
          " WHERE day >= ? AND user_key <> ''",
        from,
      );

      const weeks: string[] = [];
      {
        const thisWeek = weekStart(dayString(0));
        for (let i = 7; i >= 0; i--) {
          weeks.push(
            new Date(Date.parse(thisWeek + "T00:00:00Z") - i * 7 * DAY_MS)
              .toISOString()
              .slice(0, 10),
          );
        }
      }
      const weekIndex = new Map(weeks.map((w, i) => [w, i]));

      const blank = () => weeks.map(() => new Set<string>());
      const activeUsers = blank();
      const searchUsers = blank();
      const sessions = blank();
      const opens = weeks.map(() => 0);

      for (const r of acts) {
        const i = weekIndex.get(weekStart(s(r.day)));
        if (i === undefined) continue;
        const u = s(r.user_key);
        const name = s(r.name);
        activeUsers[i].add(u);
        if (name === "search") searchUsers[i].add(u);
        if (name === "session_start" && r.session_id) sessions[i].add(s(r.session_id));
        if (name === "company_open") opens[i] += 1;
      }

      const last = weeks.length - 1;
      const lead = (key: string, label: string, series: number[], note: string): Leading => ({
        key,
        label,
        value: series[last] ?? 0,
        delta: series.length > 1 ? (series[last] ?? 0) - (series[last - 1] ?? 0) : null,
        series,
        note,
      });

      const leading: Leading[] = [
        lead(
          "wau",
          "Signed-in weekly",
          activeUsers.map((set) => set.size),
          "Distinct accounts with any activity this week.",
        ),
        lead(
          "sessions",
          "Sessions",
          sessions.map((set) => set.size),
          "Page sessions opened by a signed-in account.",
        ),
        lead(
          "searchers",
          "Searched",
          searchUsers.map((set) => set.size),
          "Accounts that ran at least one search. Terms are not recorded.",
        ),
        lead("opens", "Companies opened", opens, "Company cards opened this week."),
      ];

      // ── Retention by signup cohort ──────────────────────────────────────────
      // Six most recent complete-enough weeks. A cell is the share of that
      // cohort seen again in week N after signup.
      const users = await all(
        db,
        'SELECT lower("email") AS k, substr("createdAt", 1, 10) AS d FROM "user"' +
          ' WHERE substr("createdAt", 1, 10) >= ?',
        dayString(7 * 12),
      );
      const cohortOf = new Map<string, string>();
      const cohortSize = new Map<string, number>();
      for (const u of users) {
        const k = s(u.k);
        const w = weekStart(s(u.d));
        if (!k || !w) continue;
        cohortOf.set(k, w);
        cohortSize.set(w, (cohortSize.get(w) ?? 0) + 1);
      }

      // Every day each signed-up account was active, over the same window.
      const seen = await all(
        db,
        "SELECT DISTINCT user_key AS k, day FROM app_event WHERE user_key <> '' AND day >= ?",
        dayString(7 * 12),
      );
      const returned = new Map<string, Set<string>>(); // cohort -> "week#user"
      for (const r of seen) {
        const k = s(r.k);
        const c = cohortOf.get(k);
        if (!c) continue;
        const wk = weekStart(s(r.day));
        const nth = Math.round((Date.parse(wk) - Date.parse(c)) / (7 * DAY_MS));
        if (nth < 1 || nth > 5) continue;
        const bucket = returned.get(c) ?? new Set<string>();
        bucket.add(`${nth}#${k}`);
        returned.set(c, bucket);
      }

      const nowWeek = weekStart(dayString(0));
      const cohorts: Cohort[] = [...cohortSize.keys()]
        .sort()
        .slice(-6)
        .map((week) => {
          const bucket = returned.get(week);
          const elapsed = Math.round((Date.parse(nowWeek) - Date.parse(week)) / (7 * DAY_MS));
          return {
            week,
            size: cohortSize.get(week) ?? 0,
            cells: [1, 2, 3, 4, 5].map((nth) =>
              // A week that has not happened yet is null, not zero. Printing 0%
              // for a cohort that signed up on Monday would read as total
              // churn when it means "ask again next week".
              nth > elapsed
                ? null
                : [...(bucket ?? [])].filter((x) => x.startsWith(`${nth}#`)).length,
            ),
          };
        })
        .reverse();

      // ── Lagging: trailing 30 days against the 30 before it ─────────────────
      const win = async (fromDay: string, toDay: string) => {
        const rows = await all(
          db,
          "SELECT name, user_key, session_id FROM app_event WHERE day >= ? AND day < ?",
          fromDay,
          toDay,
        );
        const signedIn = new Set<string>();
        const sess = new Set<string>();
        let follows = 0;
        let searches = 0;
        let companyOpens = 0;
        for (const r of rows) {
          const u = s(r.user_key);
          if (u) signedIn.add(u);
          if (r.session_id) sess.add(s(r.session_id));
          const nm = s(r.name);
          if (nm === "follow_add") follows += 1;
          if (nm === "search") searches += 1;
          if (nm === "company_open") companyOpens += 1;
        }
        return { users: signedIn.size, sessions: sess.size, follows, searches, companyOpens };
      };
      const cur = await win(dayString(days), dayString(-1));
      const prev = await win(dayString(days * 2), dayString(days));
      const signups = await all(
        db,
        'SELECT COUNT(*) AS n FROM "user" WHERE substr("createdAt", 1, 10) >= ?',
        dayString(days),
      );
      const signupsPrev = await all(
        db,
        'SELECT COUNT(*) AS n FROM "user"' +
          ' WHERE substr("createdAt", 1, 10) >= ? AND substr("createdAt", 1, 10) < ?',
        dayString(days * 2),
        dayString(days),
      );

      const lag = (key: string, label: string, v: number, p: number, note: string): Lagging => ({
        key,
        label,
        value: v,
        delta: p === 0 && v === 0 ? null : v - p,
        note,
      });
      const lagging: Lagging[] = [
        lag("signups", "New accounts", n(signups[0]?.n), n(signupsPrev[0]?.n), "Signed up."),
        lag("users", "Signed-in users", cur.users, prev.users, "Distinct accounts seen."),
        lag("sessions", "Sessions", cur.sessions, prev.sessions, "Including signed-out."),
        lag("follows", "Follows added", cur.follows, prev.follows, "Companies and skills."),
        lag("opens", "Companies opened", cur.companyOpens, prev.companyOpens, "Cards opened."),
      ];

      // ── Time in app ─────────────────────────────────────────────────────────
      const lens = (
        await all(
          db,
          "SELECT ms FROM app_event WHERE name = 'session_end' AND ms > 0 AND day >= ?" +
            " ORDER BY ms",
          dayString(days),
        )
      ).map((r) => n(r.ms));
      const total = lens.length;
      const timeBands: TimeBand[] = BANDS.map((b) => {
        const c = lens.filter((v) => v >= b.lo && v < b.hi).length;
        return { band: b.band, sessions: c, pct: total ? Math.round((c / total) * 100) : 0 };
      });
      // The median, not the mean: one tab left open for an hour drags a mean
      // enough to make a typical session look twice as long as it is.
      const medianSessionMs = total ? lens[Math.floor((total - 1) / 2)] : null;

      return {
        ok: true,
        days,
        since,
        events,
        generated: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
        leading,
        cohorts,
        lagging,
        timeBands,
        medianSessionMs,
      };
    } catch (e) {
      return EMPTY(String((e as Error)?.message || e), days);
    }
  });
