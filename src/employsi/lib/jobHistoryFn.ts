import { createServerFn } from "@tanstack/react-start";
import type { D1Like } from "./jobArchive";
import { COMPANY_ID_ALIAS, type RolePoint } from "./openRolesFn";
import { SKILL_CATEGORY } from "../data/skillsTaxonomy";

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
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 86400000));
}

export const getRoleHistory = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<RoleHistory | null> => {
    const id = (data.id || "").trim();
    if (!id) return null;
    const db = await getArchiveDb();
    if (!db) return null;
    const today = new Date().toISOString().slice(0, 10);
    try {
      // Longest-running first: order by the first-seen → last-seen span.
      const rowsRes = await db
        .prepare(
          `SELECT title, source, location, salary, first_seen, last_seen, seen_count
             FROM jobs
            WHERE company_id = ?1
            ORDER BY (julianday(last_seen) - julianday(first_seen)) DESC, first_seen ASC
            LIMIT 40`,
        )
        .bind(id)
        .all();
      const rows = rowsRes?.results ?? [];
      if (!rows.length) return null;

      const aggRes = await db
        .prepare(`SELECT COUNT(*) AS n, MIN(first_seen) AS since FROM jobs WHERE company_id = ?1`)
        .bind(id)
        .first();
      const total = Number(aggRes?.n) || rows.length;
      const since = String(aggRes?.since || rows[0].first_seen);

      let longestDays = 0;
      const items: RoleHistoryItem[] = rows.map((r) => {
        const firstSeen = String(r.first_seen);
        const lastSeen = String(r.last_seen);
        const daysOpen = daysBetween(firstSeen, lastSeen);
        if (daysOpen > longestDays) longestDays = daysOpen;
        return {
          title: String(r.title || ""),
          source: String(r.source || ""),
          location: String(r.location || ""),
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
  dir: "up" | "down";
  series: number[]; // weekly live-vacancy count over the last ~3 months (13 wks)
}

const TREND_WEEKS = 13; // ~3 months of weekly buckets for the per-skill sparkline

// The top skill increases / decreases for a company, from historical vacancy
// analysis of the D1 archive. Each archived listing carries its mapped skills +
// the window it was live (first_seen…last_seen); we tally skill mentions in the
// most-recent WINDOW days vs the WINDOW days before that and rank the biggest
// movers. Powers the card's "where they're hiring" area (now demand shifts).
// Sparse until the archive has more than one window of history — it fills in as
// the daily pulls accumulate.
export const getSkillTrends = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<SkillMover[]> => {
    const id = (data.id || "").trim();
    if (!id) return [];
    const db = await getArchiveDb();
    if (!db) return [];
    try {
      const res = await db
        .prepare(
          `SELECT skills, first_seen, last_seen FROM jobs WHERE company_id = ?1 AND skills IS NOT NULL`,
        )
        .bind(id)
        .all();
      const rows = res?.results ?? [];
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
      // Weekly bucket boundaries (oldest→newest) for the 3-month sparkline.
      const wkStart: string[] = [];
      const wkEnd: string[] = [];
      for (let i = TREND_WEEKS - 1; i >= 0; i--) {
        wkStart.push(day((i + 1) * 7 - 1));
        wkEnd.push(day(i * 7));
      }
      const nowT: Record<string, number> = {};
      const prevT: Record<string, number> = {};
      const seriesT: Record<string, number[]> = {};
      for (const r of rows) {
        let skills: string[] = [];
        try {
          skills = JSON.parse(String(r.skills || "[]"));
        } catch {
          skills = [];
        }
        if (!skills.length) continue;
        const fs = String(r.first_seen || "");
        const ls = String(r.last_seen || "");
        if (!fs || !ls) continue;
        // Active in the recent window (…first_seen ≤ today & last_seen ≥ start).
        if (ls >= recentStart) for (const s of skills) nowT[s] = (nowT[s] || 0) + 1;
        // Active in the prior window.
        if (fs <= priorEnd && ls >= priorStart)
          for (const s of skills) prevT[s] = (prevT[s] || 0) + 1;
        // Per-week live-vacancy count for the sparkline (live = fs ≤ wkEnd & ls ≥ wkStart).
        for (const s of skills) {
          const arr = (seriesT[s] ||= new Array(TREND_WEEKS).fill(0));
          for (let w = 0; w < TREND_WEEKS; w++) if (fs <= wkEnd[w] && ls >= wkStart[w]) arr[w]++;
        }
      }
      const skills = new Set([...Object.keys(nowT), ...Object.keys(prevT)]);
      const movers: SkillMover[] = [];
      for (const s of skills) {
        const now = nowT[s] || 0;
        const prev = prevT[s] || 0;
        const delta = now - prev;
        if (delta === 0) continue;
        const pct = prev > 0 ? Math.round((delta / prev) * 100) : 100;
        movers.push({
          skill: s,
          now,
          prev,
          delta,
          pct,
          dir: delta > 0 ? "up" : "down",
          series: seriesT[s] || [],
        });
      }
      // Biggest absolute movers first, increases ahead of decreases on ties.
      movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.delta - a.delta);
      return movers.slice(0, 8);
    } catch {
      return [];
    }
  });

// One "Live trends" ticker row: a canonical skill and how its vacancy demand has
// moved, market-wide, over the most recent window versus the one before it.
export interface LiveSkillTrend {
  name: string; // canonical skill
  tag: string; // 'Demand'
  v: number; // % change (positive = rising demand); newly-surging capped at +24
  // Daily count of live vacancies demanding this skill, oldest → newest, for
  // the ticker's sparkline. Omitted when the archive is too young to draw an
  // honest line (see SPARK_MIN_POINTS below) — the ticker then shows the row
  // without one rather than inventing a shape.
  spark?: number[];
}

// The three windows the ticker's window control cycles through, matching the
// design. Each is computed independently from the archive against its OWN prior
// window (24h vs the day before, 7d vs the week before, 30d vs the month
// before), so switching window changes what is being measured rather than
// rescaling one number — the design's mock multiplied a single delta by 2.1 and
// 3.4, which would have been a fabricated figure here.
export type TrendWindow = "24h" | "7d" | "30d";
export const TREND_WINDOWS: { key: TrendWindow; days: number; label: string; short: string }[] = [
  { key: "24h", days: 1, label: "· Last 24 hours", short: "24h" },
  { key: "7d", days: 7, label: "· Last 7 days", short: "7d" },
  { key: "30d", days: 30, label: "· Last 30 days", short: "30d" },
];
export type LiveSkillTrends = Record<TrendWindow, LiveSkillTrend[]>;

// Market-wide daily skill-demand trends for the app's "Live trends" ticker.
// Reads every recently-active listing in the D1 archive (all sources — Adzuna,
// Muse, Jooble, SEEK, Indeed, Zhaopin, and the WA/SA/VIC/QLD/APS government
// boards), tallies how many vacancies demand each canonical skill in the recent
// WINDOW days versus the WINDOW days before that, and ranks the biggest movers.
// This replaces the old hand-seeded random-walk ticker with real demand signal
// that shifts a little each day as the archive accumulates. Returns [] until the
// archive holds enough history to compute movers; the client falls back to a
// static seed in that case so the ticker is never empty.
export const getLiveSkillTrends = createServerFn({ method: "GET" }).handler(
  async (): Promise<LiveSkillTrends> => {
    const empty: LiveSkillTrends = { "24h": [], "7d": [], "30d": [] };
    const db = await getArchiveDb();
    if (!db) return empty;
    // Sparkline length. The archive stores first_seen/last_seen per listing, so
    // "how many live vacancies demanded skill X on day D" is recoverable for any
    // day the archive was actually running — no new storage needed, and the line
    // gets richer on its own as the archive accumulates. 30 days is the longest
    // any window needs; the shorter windows draw the tail of the same series.
    const SPARK_DAYS = 30;
    const SPARK_MIN_POINTS = 5; // below this the line says more about the
    // archive's age than about demand, so it is dropped entirely
    const day = (offset: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    // The widest window pair (30 + 30) bounds the scan; the narrower windows are
    // computed from the same rows, so all three cost one query.
    const widest = Math.max(...TREND_WINDOWS.map((w) => w.days));
    const scanFrom = day(widest * 2);
    // Per-window comparison boundaries, resolved once.
    const bounds = TREND_WINDOWS.map((w) => ({
      key: w.key,
      recentStart: day(w.days),
      priorStart: day(w.days * 2),
      priorEnd: day(w.days),
      now: {} as Record<string, number>,
      prev: {} as Record<string, number>,
    }));
    // Oldest → newest, the days the sparkline covers.
    const sparkDays: string[] = [];
    for (let i = SPARK_DAYS - 1; i >= 0; i--) sparkDays.push(day(i));
    try {
      const res = await db
        .prepare(
          `SELECT skills, first_seen, last_seen FROM jobs
             WHERE skills IS NOT NULL AND last_seen >= ?1`,
        )
        .bind(scanFrom)
        .all();
      const rows = res?.results ?? [];
      if (!rows.length) return empty;
      // skill -> per-day live-vacancy count, indexed against sparkDays.
      const daily: Record<string, number[]> = {};
      // The earliest day the archive holds anything at all. Days before it are
      // not "zero demand", they are "we weren't collecting" — drawing them would
      // render every skill as a hockey stick.
      let archiveStart = "9999-99-99";
      for (const r of rows) {
        let skills: string[] = [];
        try {
          skills = JSON.parse(String(r.skills || "[]"));
        } catch {
          skills = [];
        }
        if (!skills.length) continue;
        const fs = String(r.first_seen || "");
        const ls = String(r.last_seen || "");
        if (!fs || !ls) continue;
        if (fs < archiveStart) archiveStart = fs;
        for (const b of bounds) {
          if (ls >= b.recentStart) for (const s of skills) b.now[s] = (b.now[s] || 0) + 1;
          if (fs <= b.priorEnd && ls >= b.priorStart)
            for (const s of skills) b.prev[s] = (b.prev[s] || 0) + 1;
        }
        // A listing is live on day D when it was first seen on or before D and
        // last seen on or after it.
        for (let i = 0; i < sparkDays.length; i++) {
          const d = sparkDays[i];
          if (fs > d || ls < d) continue;
          for (const sk of skills) {
            const arr = (daily[sk] ||= new Array(sparkDays.length).fill(0));
            arr[i] += 1;
          }
        }
      }
      // Trim the series to days the archive actually covers.
      const firstCovered = sparkDays.findIndex((d) => d >= archiveStart);
      const sparkFrom = firstCovered < 0 ? sparkDays.length : firstCovered;
      const sparkFor = (name: string): number[] | undefined => {
        const arr = daily[name];
        if (!arr) return undefined;
        const cut = arr.slice(sparkFrom);
        if (cut.length < SPARK_MIN_POINTS) return undefined;
        // A dead-flat line is noise, not signal — leave it off.
        return cut.some((v) => v !== cut[0]) ? cut : undefined;
      };

      const out = { ...empty };
      for (const b of bounds) {
        const skills = new Set([...Object.keys(b.now), ...Object.keys(b.prev)]);
        type Row = { name: string; v: number; sig: number };
        const movers: Row[] = [];
        for (const s of skills) {
          if (!(s in SKILL_CATEGORY)) continue; // only canonical skills on the ticker
          const now = b.now[s] || 0;
          const prev = b.prev[s] || 0;
          // Require a little volume so single-listing noise doesn't dominate.
          if (now + prev < 3) continue;
          const delta = now - prev;
          if (delta === 0) continue;
          let pct = prev > 0 ? (delta / prev) * 100 : 100;
          pct = Math.max(-16, Math.min(24, pct)); // match the ticker's visual band
          movers.push({ name: s, v: Math.round(pct * 10) / 10, sig: Math.abs(delta) });
        }
        // Biggest absolute movers first; interleave so the ticker mixes up + down.
        movers.sort((a, b2) => b2.sig - a.sig || Math.abs(b2.v) - Math.abs(a.v));
        const picked = movers.slice(0, 16);
        // Fallback: if the archive is too young for real movers in this window,
        // show the highest-demand skills right now as a mild positive so the
        // ticker still reads live.
        if (picked.length < 6) {
          const top = Object.entries(b.now)
            .filter(([s]) => s in SKILL_CATEGORY)
            .sort((x, y) => y[1] - x[1])
            .slice(0, 16);
          const seen = new Set(picked.map((p) => p.name));
          for (const [name, cnt] of top) {
            if (seen.has(name)) continue;
            picked.push({ name, v: Math.min(18, 2 + Math.round(cnt / 3)), sig: cnt });
            if (picked.length >= 12) break;
          }
        }
        out[b.key] = picked.map((p) => ({
          name: p.name,
          tag: "Demand",
          v: p.v,
          spark: sparkFor(p.name),
        }));
      }
      return out;
    } catch {
      return empty;
    }
  },
);

// One market-wide skill mover for the "What's Trending" pane.
export interface MarketSkillMover {
  skill: string;
  cat: string; // skill category (for the legend chip)
  now: number; // vacancies demanding it in the recent 30 days
  prev: number; // ...in the prior 30 days
  pct: number; // % change (capped display; 100 = newly appearing)
  dir: "up" | "down";
}

export interface MarketSkillMovers {
  risers: MarketSkillMover[];
  fallers: MarketSkillMover[];
}

// Market-wide skill risers and fallers for the "What's Trending" pane. Same
// archive + method as the ticker, but a 30-day-vs-prior-30-day window (a
// month-on-month read rather than the ticker's weekly momentum) and split into
// the biggest gainers and biggest decliners at the skill level, across every
// data feed. Returns empty lists until the archive has two windows of history;
// the pane falls back to its illustrative sections in that case.
export const getMarketSkillMovers = createServerFn({ method: "GET" }).handler(
  async (): Promise<MarketSkillMovers> => {
    const db = await getArchiveDb();
    if (!db) return { risers: [], fallers: [] };
    const day = (offset: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - offset);
      return d.toISOString().slice(0, 10);
    };
    // Adaptive window: a month-on-month read once there's ≥60 days of history,
    // but narrowed to split whatever history exists so both risers AND fallers
    // surface while the archive is still young (it widens to 30 as data accrues).
    let WINDOW = 30;
    try {
      const span = await db
        .prepare(
          `SELECT MIN(first_seen) AS mn, MAX(last_seen) AS mx FROM jobs WHERE skills IS NOT NULL`,
        )
        .first();
      const spanDays = span?.mn && span?.mx ? daysBetween(String(span.mn), String(span.mx)) : 0;
      if (spanDays > 0) WINDOW = Math.max(2, Math.min(30, Math.floor(spanDays / 2)));
    } catch {
      /* keep default */
    }
    const recentStart = day(WINDOW);
    const priorStart = day(WINDOW * 2);
    const priorEnd = recentStart;
    try {
      const res = await db
        .prepare(
          `SELECT skills, first_seen, last_seen FROM jobs
             WHERE skills IS NOT NULL AND last_seen >= ?1`,
        )
        .bind(priorStart)
        .all();
      const rows = res?.results ?? [];
      if (!rows.length) return { risers: [], fallers: [] };
      const nowT: Record<string, number> = {};
      const prevT: Record<string, number> = {};
      for (const r of rows) {
        let skills: string[] = [];
        try {
          skills = JSON.parse(String(r.skills || "[]"));
        } catch {
          skills = [];
        }
        if (!skills.length) continue;
        const fs = String(r.first_seen || "");
        const ls = String(r.last_seen || "");
        if (!fs || !ls) continue;
        if (ls >= recentStart) for (const s of skills) nowT[s] = (nowT[s] || 0) + 1;
        if (fs <= priorEnd && ls >= priorStart)
          for (const s of skills) prevT[s] = (prevT[s] || 0) + 1;
      }
      const all = new Set([...Object.keys(nowT), ...Object.keys(prevT)]);
      const movers: MarketSkillMover[] = [];
      for (const s of all) {
        if (!(s in SKILL_CATEGORY)) continue;
        const now = nowT[s] || 0;
        const prev = prevT[s] || 0;
        if (now + prev < 3) continue; // volume floor against single-listing noise
        const delta = now - prev;
        if (delta === 0) continue;
        const pctRaw = prev > 0 ? (delta / prev) * 100 : 100;
        const pct = Math.max(-100, Math.min(300, Math.round(pctRaw)));
        movers.push({
          skill: s,
          cat: SKILL_CATEGORY[s],
          now,
          prev,
          pct,
          dir: delta > 0 ? "up" : "down",
        });
      }
      // Rank each side by magnitude (bigger swing first), tie-break on volume.
      const risers = movers
        .filter((m) => m.dir === "up")
        .sort((a, b) => b.pct - a.pct || b.now - a.now)
        .slice(0, 6);
      const fallers = movers
        .filter((m) => m.dir === "down")
        .sort((a, b) => a.pct - b.pct || b.prev - a.prev)
        .slice(0, 6);
      return { risers, fallers };
    } catch {
      return { risers: [], fallers: [] };
    }
  },
);

// A daily "live vacancies" time-series derived from the D1 archive: for each of
// the last N days, how many of the company's archived listings were live that
// day (first_seen ≤ day ≤ last_seen). This powers the vacancy-movement chart
// from the *stored history* (all sources — Adzuna, Muse, Jooble, SEEK, WA-gov),
// which is what lets the WA government agencies — whose live count comes from
// the scraped board, not Adzuna — show the same current+historical graph the
// private companies get. Builds forward as the archive accumulates, so a
// freshly-seeded company shows a short series that lengthens over the days.
export const getVacancyTrend = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<RolePoint[]> => {
    const id = (data.id || "").trim();
    if (!id) return [];
    const db = await getArchiveDb();
    if (!db) return [];
    try {
      const res = await db
        .prepare(
          `SELECT title, first_seen, last_seen FROM jobs
            WHERE company_id = ?1
              AND source NOT IN ('adzuna', 'muse')`,
        )
        // Same alias the headline uses, so a dual-listed issuer's chart reads
        // the rows its "Open roles" number was counted from (HSBC is on the
        // roster twice but archived once).
        .bind(COMPANY_ID_ALIAS[id] ?? id)
        .all();
      const rows = res?.results ?? [];
      if (!rows.length) return [];
      // Count DISTINCT ROLES open on a day, not archive rows.
      //
      // This has to match how the card's "Open roles" headline counts, or the
      // chart's last point disagrees with the number printed beside it. That
      // headline dedupes by normalised title and ignores adzuna/muse (those are
      // counted from the live fetch instead), so this does both.
      //
      // Measured on the live archive: 5,873 rows were open across the roster on
      // one day but only 4,006 distinct company+title pairs — the row count
      // overstated by 47%. It is worst for employers that advertise one role in
      // many locations: CSL had 1,089 rows for 438 real roles.
      const norm = (s: string) =>
        s
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      // title -> the day-spans it was open for, so a role listed by three
      // sources contributes one span set rather than three roles.
      const byTitle = new Map<string, [string, string][]>();
      for (const r of rows) {
        const t = norm(String(r.title || ""));
        const fs = String(r.first_seen || "");
        const ls = String(r.last_seen || "");
        if (!t || !fs || !ls) continue;
        const list = byTitle.get(t);
        if (list) list.push([fs, ls]);
        else byTitle.set(t, [[fs, ls]]);
      }
      if (!byTitle.size) return [];
      const DAYS = 90;
      const now = new Date();
      const series: RolePoint[] = [];
      for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() - i);
        const ds = d.toISOString().slice(0, 10);
        let c = 0;
        for (const spans of byTitle.values()) {
          if (spans.some(([fs, ls]) => fs <= ds && ds <= ls)) c++;
        }
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
