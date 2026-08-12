import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { marketVisible, isReleasedRow } from "./markets";
import type { D1Like, SqlValue } from "./jobArchive";
import { COMPANY_ID_ALIAS, type RolePoint } from "./openRolesFn";
import { SKILL_CATEGORY, parseStoredSkills } from "../data/skillsTaxonomy";
import { AREA_SOURCES, canonicalArea } from "../data/hiringAreas";
import { annualAud, medianAnnual } from "./salaryParse";

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
    // Unreleased market: withhold the data as well as the marker. Without this
    // the fade would be cosmetic — the id is guessable and the response would
    // still answer. See lib/markets.ts for why these are hidden rather than
    // unsupported.
    if (!marketVisible(await callerRole(), id, true)) return null;
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
    // Unreleased market: withhold the data as well as the marker. Without this
    // the fade would be cosmetic — the id is guessable and the response would
    // still answer. See lib/markets.ts for why these are hidden rather than
    // unsupported.
    if (!marketVisible(await callerRole(), id, true)) return [];
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
        // parseStoredSkills, not a bare JSON.parse: archived rows keep the
        // skill names they were written with, so a renamed skill needs its old
        // name mapped forward or that row's demand vanishes (see SKILL_ALIAS).
        const skills = parseStoredSkills(r.skills);
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
  /**
   * Median annual salary, in AUD, advertised across the currently-live
   * Australian vacancies that demand this skill.
   *
   * Omitted when too few of them state one. Australian only, and never
   * converted from another currency — see lib/salaryParse for why the currency
   * of an archived salary string is knowable only from its hub, and why
   * averaging a San Jose figure with a Brisbane one produces a number that is
   * not a salary anywhere.
   */
  pay?: number;
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
    // The ticker is a market-wide roll-up, so it has to be rolled up over the
    // markets the reader can actually see — otherwise an end user reads a
    // headline demand figure carrying vacancies from countries the product has
    // not released to them.
    const seesAll = (await callerRole()) === "admin";
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
          `SELECT skills, first_seen, last_seen, hub, company_id, salary, source FROM jobs
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
      // New listings per day, used below to find the day collection actually
      // began rather than the day the first stray row landed.
      const newPerDay: Record<string, number> = {};
      // skill -> every annual AUD figure advertised for it RIGHT NOW. See
      // salaryParse for why only Australian rows count and why nothing is
      // converted. `payFrom` is the same boundary the app uses for "currently
      // advertised", so the median describes the ads a reader could go and
      // apply to today — not the 60-day scan window the deltas need.
      const payAds: Record<string, number[]> = {};
      const payFrom = day(1);
      for (const r of rows) {
        // parseStoredSkills, not a bare JSON.parse: archived rows keep the
        // skill names they were written with, so a renamed skill needs its old
        // name mapped forward or that row's demand vanishes (see SKILL_ALIAS).
        const skills = parseStoredSkills(r.skills);
        if (!skills.length) continue;
        const fs = String(r.first_seen || "");
        const ls = String(r.last_seen || "");
        if (!fs || !ls) continue;
        if (!seesAll && !isReleasedRow(r.hub as string | null, r.company_id as string | null))
          continue;
        if (fs < archiveStart) archiveStart = fs;
        newPerDay[fs] = (newPerDay[fs] || 0) + 1;
        if (ls >= payFrom) {
          const aud = annualAud({
            salary: r.salary as string | null,
            hub: r.hub as string | null,
            source: r.source as string | null,
          });
          if (aud !== null) for (const s of skills) (payAds[s] ||= []).push(aud);
        }
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
      // WHEN DID COLLECTION ACTUALLY START?
      //
      // Not the same question as "what is the oldest row", and getting them
      // confused is what broke this. The archive's first rows trickle in while
      // a feed is being set up — measured here: 4 rows on the first day, 4 on
      // the second, 1 on the third, then 1,994 on the fourth. Treating the
      // first of those as the start makes the three days before the real ramp
      // look like days of near-zero demand, and every skill then reads as
      // exploding growth against them.
      //
      // So the start is the first day carrying at least a tenth of the median
      // day's new listings. That cleanly separates a 1-row setup day from a
      // 2,000-row collecting day without needing a hand-picked date.
      const dayCounts = Object.values(newPerDay).sort((a, c) => a - c);
      const medianNew = dayCounts.length ? dayCounts[Math.floor(dayCounts.length / 2)] : 0;
      const collectingDays = Object.keys(newPerDay)
        .filter((d) => newPerDay[d] >= medianNew * 0.1)
        .sort();
      const coverageStart = collectingDays[0] ?? archiveStart;

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
        // A CHANGE IS ONLY REPORTABLE WHEN BOTH HALVES WERE COLLECTED.
        //
        // Each window compares the last N days against the N before them. If
        // the archive was not running for that earlier half, `prev` is 0 for
        // every skill — not because demand was zero, but because nobody was
        // looking. The old code turned that into `pct = 100`, clamped to the
        // ticker's +24% band, so a 30-day window over a 12-day-old archive
        // reported every single skill as up 24%. That is an invented number
        // presented as measurement, and the 7-day window was distorted the
        // same way by a prior half that was only partly collected.
        //
        // A window whose prior half predates collection is left EMPTY. The
        // ticker says so rather than showing a figure nobody measured, and the
        // window starts reporting on its own once the archive is old enough.
        if (b.priorStart < coverageStart) {
          out[b.key] = [];
          continue;
        }
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
          // prev === 0 here means genuinely new demand within a collected
          // window, not a gap in the archive — that case is excluded above.
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
          // Undefined when too few Australian ads state a salary — the row then
          // renders without a figure rather than with a thin one. It is the
          // same figure in every window on purpose: the median is a LEVEL
          // ("what these roles pay now") while the percentage is a MOVEMENT
          // over the selected window, so rescaling it per window would be
          // asserting a trend nothing measured.
          pay: medianAnnual(payAds[p.name] || []) ?? undefined,
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
  now: number; // mean daily live vacancies demanding it, recent window
  prev: number; // ...prior window
  pct: number; // % change between the two means
  dir: "up" | "down";
}

export interface MarketSkillMovers {
  risers: MarketSkillMover[];
  fallers: MarketSkillMover[];
  /** Length of each comparison window, in days. 0 when nothing was measurable. */
  windowDays: number;
  /** The recent window, inclusive: YYYY-MM-DD. */
  from: string;
  to: string;
  /** Feeds that covered BOTH windows and were therefore counted. */
  sources: string[];
  /** The area measured, for the pane's footnote (e.g. "Perth", "Worldwide"). */
  scope: string;
}

const NO_MOVERS: MarketSkillMovers = {
  risers: [],
  fallers: [],
  windowDays: 0,
  from: "",
  to: "",
  sources: [],
  scope: "",
};

const SAFE_SOURCE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function shiftDay(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/**
 * Market-wide skill risers and fallers for the "What's Trending" pane.
 *
 * WHAT IS MEASURED. For each skill, the MEAN NUMBER OF VACANCIES LIVE PER DAY
 * that map to it, in a recent window, against the same figure for the window
 * immediately before. A vacancy is live on a day when first_seen ≤ day ≤
 * last_seen, which is the definition the company vacancy chart already uses —
 * and it is only meaningful because listings age out: last_seen stops advancing
 * the moment a job leaves the board, so a closed vacancy stops being counted.
 * (Measured on the live archive: 93.7% of Adzuna rows and 87.7% of WA
 * government rows carry a last_seen older than that feed's own latest run.)
 *
 * WHY IT IS A DAILY MEAN and not a count of rows in the window. A window count
 * scales with how long the window is and with how much the archive happened to
 * grow, so the two windows are not comparable. A daily mean is a level, so the
 * percentage change between two windows is a real change in demand.
 *
 * WHY THE WINDOW IS CHOSEN, NOT FIXED. The previous version halved the archive's
 * total span and compared window against window across every feed. That is what
 * emptied the fallers list: feeds are added over time, so the recent window
 * contained sources the prior window could not — 20 of the 33 feeds began on or
 * after the recent window's start date — and almost every skill therefore rose.
 * Here the window is the LONGEST one for which the feeds that covered BOTH
 * windows still account for most of the archive, and only those feeds are
 * counted. Nothing is compared against a period it did not exist in.
 *
 * Risers and fallers come from the same computation over the same window, so
 * the two lists are directly comparable — they are two ends of one ranking.
 */
const MOVER_MIN_WINDOW = 3;
const MOVER_MAX_WINDOW = 30;
/** A window only counts if the feeds spanning both halves are this much of the archive. */
const MOVER_MIN_COVERAGE = 0.5;
/** Mean daily vacancies a skill needs in BOTH windows to be ranked. */
const MOVER_MIN_LEVEL = 3;

/**
 * SCOPE. The pane sits over a map that is already showing one city, one region
 * or the whole world, so its numbers have to be about that same area — a Perth
 * local view reporting worldwide movers is answering a question nobody asked.
 * `hubs` is the set of archive hub keys the current layer covers, resolved on
 * the client from the same geo tables the analyst scope chips use; an empty
 * list means worldwide, which is genuinely everything rather than a fallback.
 *
 * Hub values are mostly lower-case city keys, but a few rows carry a
 * capitalised or country-level hub ("Singapore", "Australia"), so the match is
 * on lower(hub) — the same rule scopeClause uses in analystFn.
 */
export interface MoverScope {
  hubs: string[];
  /** Display label for the footnote. */
  label: string;
}

export const getMarketSkillMovers = createServerFn({ method: "GET" })
  .validator((data: MoverScope) => data)
  .handler(async ({ data }): Promise<MarketSkillMovers> => {
    const db = await getArchiveDb();
    if (!db) return NO_MOVERS;
    const hubs = (data?.hubs ?? []).map((h) => String(h).toLowerCase()).filter(Boolean);
    const scopeLabel = data?.label || "Worldwide";
    // Bound, not inlined: a region is a few dozen hubs, well inside D1's
    // parameter cap, so there is no reason to build these into the string.
    const hubWhere = hubs.length ? ` AND lower(hub) IN (${hubs.map(() => "?").join(",")})` : "";
    try {
      // Yesterday, not today: the scrapers run through the night, so today is
      // always a partial day and would read as a market-wide collapse.
      const asOf = shiftDay(new Date().toISOString().slice(0, 10), -1);

      // When each feed started, and how much of the archive it is — measured
      // WITHIN THE SCOPE, because coverage is not uniform across areas. The
      // Chinese and Indian feeds carry no Australian rows, so counting them
      // towards a Perth window would pick a window Perth's own feeds cannot
      // support.
      const cov = await db
        .prepare(
          `SELECT source, MIN(first_seen) AS mn, COUNT(*) AS n
             FROM jobs WHERE skills IS NOT NULL${hubWhere} GROUP BY source`,
        )
        .bind(...hubs)
        .all();
      const feeds = (cov?.results ?? [])
        .map((r) => ({
          source: String(r.source || ""),
          mn: String(r.mn || ""),
          n: Number(r.n) || 0,
        }))
        .filter((f) => SAFE_SOURCE.test(f.source) && f.mn);
      if (!feeds.length) return NO_MOVERS;
      const totalRows = feeds.reduce((a, f) => a + f.n, 0);

      // Longest window whose both-halves feeds still carry most of the archive.
      let windowDays = 0;
      let eligible: string[] = [];
      for (let w = MOVER_MAX_WINDOW; w >= MOVER_MIN_WINDOW; w--) {
        const start = shiftDay(asOf, -(2 * w - 1));
        const ok = feeds.filter((f) => f.mn <= start);
        const share = ok.reduce((a, f) => a + f.n, 0) / Math.max(1, totalRows);
        if (ok.length && share >= MOVER_MIN_COVERAGE) {
          windowDays = w;
          eligible = ok.map((f) => f.source);
          break;
        }
      }
      if (!windowDays) return NO_MOVERS;

      const recentStart = shiftDay(asOf, -(windowDays - 1));
      const priorStart = shiftDay(asOf, -(2 * windowDays - 1));
      const priorEnd = shiftDay(recentStart, -1);

      // Sources are inlined rather than bound: D1 caps bound parameters well
      // below the feed count, and each one is checked against SAFE_SOURCE above.
      const list = eligible.map((s) => `'${s}'`).join(",");
      const res = await db
        .prepare(
          `SELECT skills, first_seen, last_seen FROM jobs
             WHERE skills IS NOT NULL
               AND source IN (${list})
               AND last_seen >= ?
               AND first_seen <= ?${hubWhere}`,
        )
        .bind(priorStart, asOf, ...hubs)
        .all();
      const rows = res?.results ?? [];
      if (!rows.length) return NO_MOVERS;

      // Vacancy-days per skill in each window ÷ window length = daily mean.
      const nowD: Record<string, number> = {};
      const prevD: Record<string, number> = {};
      const overlap = (fs: string, ls: string, a: string, b: string): number => {
        const lo = fs > a ? fs : a;
        const hi = ls < b ? ls : b;
        return hi < lo ? 0 : daysBetween(lo, hi) + 1;
      };
      for (const r of rows) {
        // parseStoredSkills, not a bare JSON.parse: archived rows keep the
        // skill names they were written with, so a renamed skill needs its old
        // name mapped forward or that row's demand vanishes (see SKILL_ALIAS).
        const skills = parseStoredSkills(r.skills);
        if (!skills.length) continue;
        const fs = String(r.first_seen || "");
        const ls = String(r.last_seen || "");
        if (!fs || !ls) continue;
        const dNow = overlap(fs, ls, recentStart, asOf);
        const dPrev = overlap(fs, ls, priorStart, priorEnd);
        if (!dNow && !dPrev) continue;
        for (const s of skills) {
          if (dNow) nowD[s] = (nowD[s] || 0) + dNow;
          if (dPrev) prevD[s] = (prevD[s] || 0) + dPrev;
        }
      }

      const movers: MarketSkillMover[] = [];
      for (const s of new Set([...Object.keys(nowD), ...Object.keys(prevD)])) {
        if (!(s in SKILL_CATEGORY)) continue;
        const now = (nowD[s] || 0) / windowDays;
        const prev = (prevD[s] || 0) / windowDays;
        // Both windows must clear the floor. A one-sided floor is what lets a
        // skill that simply appeared read as the market's fastest riser, and it
        // is also why "new" could never have a mirror on the fallers side.
        if (now < MOVER_MIN_LEVEL || prev < MOVER_MIN_LEVEL) continue;
        const pctRaw = ((now - prev) / prev) * 100;
        if (Math.abs(pctRaw) < 0.5) continue; // flat
        movers.push({
          skill: s,
          cat: SKILL_CATEGORY[s],
          now: Math.round(now),
          prev: Math.round(prev),
          pct: Math.round(pctRaw),
          dir: pctRaw > 0 ? "up" : "down",
        });
      }
      const risers = movers
        .filter((m) => m.dir === "up")
        .sort((a, b) => b.pct - a.pct || b.now - a.now)
        .slice(0, 6);
      const fallers = movers
        .filter((m) => m.dir === "down")
        .sort((a, b) => a.pct - b.pct || b.prev - a.prev)
        .slice(0, 6);
      return {
        risers,
        fallers,
        windowDays,
        from: recentStart,
        to: asOf,
        sources: eligible.sort(),
        scope: scopeLabel,
      };
    } catch {
      return NO_MOVERS;
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
            WHERE company_id = ?1`,
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
      // This is the SAME construction the card's "Open roles" headline uses —
      // the deduped union of every source's current listings — so the chart's
      // last point and the number printed beside it are one figure measured two
      // ways, not two different figures. It used to exclude adzuna/muse on the
      // grounds that the headline counted those from the live fetch instead,
      // which is exactly what made the two disagree; the headline is now
      // row-backed (see openRolesFn) so every source belongs in both.
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
      // The series ENDS YESTERDAY. The scrapers run through the night, so on
      // any given day some feeds have reported and some have not: a job whose
      // last_seen is still yesterday is not closed, it just has not been looked
      // at yet today. Charting today therefore drew every company's line
      // falling to (or near) zero on its last point — an artefact of collection
      // timing, not a real collapse in hiring. Yesterday is the last day every
      // feed has had a full run to report in.
      const end = new Date();
      end.setUTCDate(end.getUTCDate() - 1);
      const series: RolePoint[] = [];
      for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date(end);
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

// ── per-skill demand for one company ────────────────────────────────────────
//
// What a single employer is actually recruiting for, skill by skill, with a
// daily series behind each one. Powers the company card's skill search (which
// skills can be picked) and the per-skill sparklines beside them.
//
// This is a COMPANY-SCOPED version of the reconstruction getLiveSkillTrends
// already runs market-wide: the archive stores `skills`, `first_seen` and
// `last_seen` on every row, so "how many of this employer's vacancies demanded
// skill X on day D" is recoverable for any day the archive was running. No new
// storage, and the line lengthens on its own as the archive accumulates.
//
// It is deliberately NOT getSkillTrends above. That one answers "which skills
// moved most" in 13 weekly buckets over ~3 months and returns the top 8 movers;
// this one answers "everything this employer is hiring for right now", daily,
// unranked and uncapped, which is what a search list and a per-row sparkline
// need. The two would fight if merged.

export interface CompanySkillDemand {
  skill: string;
  /** Skill category, for the search row's second line. */
  cat: string;
  /** Ads currently advertised by this company that demand the skill. */
  now: number;
  /** Daily live count across `CompanySkillTrends.days`, oldest → newest.
   *  Omitted when the archive is too young to draw an honest line, or when the
   *  line is dead flat — see SPARK_MIN_POINTS. */
  spark?: number[];
  /** Change across the covered window. Null when the window is too short to
   *  support one, in which case the row shows a count and no percentage. */
  pct: number | null;
  dir: "up" | "down" | "flat";
  /** Median annual AUD across the currently-live Australian ads demanding this
   *  skill. Undefined when too few state one (medianAnnual enforces MIN_ADS) —
   *  the card then shows the gap rather than a median over two ads. */
  pay?: number;
  /** Australian live ads for this skill that state a salary at all. */
  payN: number;
  /**
   * Where the live ads for this skill sit, highest first — the hot-spot map.
   *
   * Hub KEYS only, not coordinates: the lng/lat table (data/mapboxWorldGeo)
   * belongs to the map layer and pulling it in here would drag the whole roster
   * and city graph into a Worker that only needs to count. It also means the
   * caller decides what is plottable, which is the same judgement it already
   * makes for every other marker it draws.
   */
  hubs: { hub: string; n: number }[];
  /** Ads FIRST SEEN on each day of `days` — new postings, against `spark`'s
   *  count of ads live. Stock and flow are different questions and the card
   *  draws them together; one is not the other restated. Omitted alongside
   *  `spark` when the window is too short to say anything. */
  newSpark?: number[];
  /** Live ads for this skill with no hub recorded at all. With `hubs` this is
   *  what lets a map say how much of the picture it is showing rather than
   *  implying it is showing all of it. */
  hubless: number;
}

/** A hiring area — the job-board category an ad was filed under — with the same
 *  14-day comparison the skills carry. */
export interface CompanyAreaDemand {
  area: string;
  /** Ads currently advertised in this area. */
  now: number;
  /** The same count at the start of the covered window. */
  prev: number;
  /** Change across it. Null when the window is too short to support one; the
   *  card then shows the count and no arrow. Zero is a measured no-change and
   *  is NOT null — the two states read differently. */
  pct: number | null;
  dir: "up" | "down" | "flat";
}

export interface CompanySkillTrends {
  /** The days every `spark` is indexed against, oldest → newest. Trimmed to
   *  days the archive actually covered, so a young archive returns a short
   *  array rather than a long one padded with zeros. */
  days: string[];
  /** Every canonical skill with at least one live ad, highest count first.
   *  Uncapped: this is the set a search box offers, and a list that silently
   *  stops would read as the complete one. Callers cap their own display. */
  skills: CompanySkillDemand[];
  /** Hiring areas, highest live count first. Same rows, same window — the
   *  card's "where they're hiring" bars and their trend arrows. */
  areas: CompanyAreaDemand[];
  /**
   * Currently-advertised ads for this company, counted ONCE each.
   *
   * Not the sum of the per-skill counts: an ad carrying four skills is one ad
   * and four of those. This is the denominator a map needs to say how much of
   * the company it is showing, and adding up the skills would overstate it
   * several times over.
   */
  liveAds: number;
  /** The same ads by hub, also counted once each. A caller filters this by
   *  whatever it can actually place — "Australia" is a hub in this archive and
   *  is not a dot — and the shortfall against `liveAds` is the honest coverage
   *  figure. */
  hubs: { hub: string; n: number }[];
}

const NO_SKILL_TRENDS: CompanySkillTrends = {
  days: [],
  skills: [],
  areas: [],
  liveAds: 0,
  hubs: [],
};

/** Days of daily history the card's sparklines draw. */
const SKILL_SPARK_DAYS = 14;

/** Below this many covered days the line says more about the archive's age
 *  than about demand, so it is dropped. Same threshold the ticker uses. */
const SKILL_SPARK_MIN = 5;
/**
 * Live ads a skill or area needs on its busiest day before a percentage is
 * reported at all.
 *
 * Without it the tail of the list is nonsense: measured on BHP, Geotechnical
 * went 0 -> 3 ads and reported +1,500%, Warehousing & Logistics went 3 -> 1 and
 * reported -83.3%. Those are two ads moving, not a market shifting, and printed
 * beside a real +7% they read as the same kind of fact. The row keeps its
 * count; it just stops claiming a trend. Same reasoning as the ticker's
 * `now + prev < 3` guard.
 */
const SKILL_MIN_VOLUME = 3;

/** How far back the collection-start test looks. Long enough to hold a normal
 *  run of collecting days, short enough that back-dated rows cannot drag the
 *  median under the floor. Matches the ticker's widest scan. */
const COVERAGE_HORIZON_DAYS = 60;

/**
 * Change between the two halves of a covered window, as a percentage.
 *
 * Means, not endpoints. A daily live-vacancy count is noisy — one big posting
 * day or one slow scrape moves a single point several ads — and first-vs-last
 * hands that whole swing to two arbitrary days. Comparing the mean of the older
 * half against the mean of the newer half is the same construction
 * MarketSkillMovers already uses ("mean daily live vacancies, recent window vs
 * prior"), and it survives a single bad day.
 *
 * Returns null when there is nothing to compare against, which is different
 * from zero and must stay different: null is "not measurable", zero is
 * "measured, did not move".
 */
function halfWindowChange(series: number[]): { pct: number | null; prev: number } {
  if (series.length < SKILL_SPARK_MIN) return { pct: null, prev: 0 };
  const half = Math.floor(series.length / 2);
  const mean = (a: number[]) => a.reduce((t, v) => t + v, 0) / a.length;
  const before = mean(series.slice(0, half));
  const after = mean(series.slice(series.length - half));
  const prev = Math.round(before);
  if (before <= 0) return { pct: null, prev };
  return { pct: Math.round(((after - before) / before) * 1000) / 10, prev };
}

const isoDaysAgo = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

/**
 * The first day the archive was genuinely COLLECTING, not merely the oldest row.
 *
 * Confusing the two is what broke the ticker once already (see the long note in
 * getLiveSkillTrends): the first rows trickle in while a feed is set up — a
 * handful a day — and then the real ramp starts. Treating the trickle as the
 * start makes those days look like near-zero demand and every skill then reads
 * as explosive growth against them.
 *
 * Asked archive-wide rather than per company, because "when did we start
 * collecting" is a property of the archive. A single employer's own first_seen
 * histogram is far too sparse for the median test to mean anything.
 */
async function archiveCoverageStart(db: D1Like): Promise<string | null> {
  // SCOPED TO A RECENT HORIZON, and that is the whole trick.
  //
  // Asked over the entire table this returns 2003-12-29. `first_seen` is not
  // purely "the day we first saw it" — measured on the live archive there are
  // 798 distinct values reaching back two decades, because some feeds carry a
  // historical date in. Twenty years of thin days drags the median down to 9,
  // the 10% floor to 0.9, and every day with a single row then qualifies as a
  // collecting day. The guard silently passed everything.
  //
  // Over the last 60 days the median is ~4,600 and the floor ~460, which cleanly
  // separates the setup trickle (6, 9, 2, 1 rows on 16-19 July 2026) from the
  // day collection actually started (3,627 on the 20th) — the date CLAUDE.md
  // records independently.
  const res = await db
    .prepare(
      `SELECT first_seen AS d, COUNT(*) AS n FROM jobs WHERE first_seen >= ?1 GROUP BY first_seen`,
    )
    .bind(isoDaysAgo(COVERAGE_HORIZON_DAYS))
    .all();
  const rows = res?.results ?? [];
  if (!rows.length) return null;
  const counts = rows.map((r) => Number(r.n) || 0).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] || 0;
  const collecting = rows
    .filter((r) => (Number(r.n) || 0) >= median * 0.1)
    .map((r) => String(r.d || ""))
    .filter(Boolean)
    .sort();
  return collecting[0] ?? null;
}

export const getCompanySkillTrends = createServerFn({ method: "GET" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<CompanySkillTrends> => {
    const id = (data.id || "").trim();
    if (!id) return NO_SKILL_TRENDS;
    // Unreleased market: withhold the data as well as the marker, exactly as
    // the other per-company readers here do. See lib/markets.ts.
    if (!marketVisible(await callerRole(), id, true)) return NO_SKILL_TRENDS;
    const db = await getArchiveDb();
    if (!db) return NO_SKILL_TRENDS;
    try {
      // Oldest → newest, the days the sparkline covers. It ENDS YESTERDAY, not
      // today.
      //
      // Today is always mid-collection: the crons run through the day, so only
      // the ads re-seen so far carry today's last_seen. Measured on the live
      // archive for BHP: 346 rows last seen on the 10th against 113 on the 11th
      // at the time of writing. Ending the window on that partial day put a
      // collapse at the right-hand end of every series and made the change
      // read as a crash — Welding & Fabrication came out at −100% while its
      // real fortnight was flat. getVacancyTrend already ends a day back for
      // the same reason.
      const window: string[] = [];
      for (let i = SKILL_SPARK_DAYS; i >= 1; i--) window.push(isoDaysAgo(i));
      const scanFrom = window[0];
      // The same one-day boundary the rest of the app calls "currently
      // advertised", and the last day of the window above, so the card's counts
      // and its line end at the same place.
      const liveFrom = isoDaysAgo(1);

      const res = await db
        .prepare(
          `SELECT skills, category, first_seen, last_seen, salary, hub, source FROM jobs
             WHERE company_id = ?1 AND skills IS NOT NULL AND last_seen >= ?2`,
        )
        // Same alias the headline and the vacancy chart use, so a dual-listed
        // issuer's skills read the rows its counts came from (HSBC is on the
        // roster twice but archived once).
        .bind(COMPANY_ID_ALIAS[id] ?? id, scanFrom)
        .all();
      const rows = res?.results ?? [];
      if (!rows.length) return NO_SKILL_TRENDS;

      // Trim the window to days the archive actually covered. Days before
      // collection began are not "no demand", they are "nobody was looking",
      // and drawing them renders every skill as a hockey stick.
      const coverage = await archiveCoverageStart(db);
      const firstCovered = coverage ? window.findIndex((d) => d >= coverage) : 0;
      const from = firstCovered < 0 ? window.length : firstCovered;

      return foldSkillRows(rows, window, liveFrom, from);
    } catch {
      return NO_SKILL_TRENDS;
    }
  });

/** The archive columns the fold below reads. Structurally a SqlRow, so query
 *  results pass straight through and a test can hand-build one. */
export type SkillRow = Partial<
  Record<"skills" | "category" | "first_seen" | "last_seen" | "salary" | "hub" | "source", SqlValue>
>;

/**
 * The pure half of getCompanySkillTrends: archive rows in, per-skill demand
 * out. Split from the handler so the day-membership reconstruction — the part
 * that is easy to get subtly wrong and impossible to eyeball on a chart — can
 * be exercised directly. See scripts/check-skill-trends.ts.
 *
 * `window` is every day the sparkline could cover, oldest → newest; `from` is
 * the index where archive coverage begins within it.
 */
export function foldSkillRows(
  rows: SkillRow[],
  window: string[],
  liveFrom: string,
  from: number,
): CompanySkillTrends {
  const now: Record<string, number> = {};
  const daily: Record<string, number[]> = {};
  const payAds: Record<string, number[]> = {};
  // Areas are tallied off the SAME rows in the same pass. A listing carries one
  // category and many skills, so they cannot share a bucket, but they can share
  // a query — and the card draws both.
  const areaNow: Record<string, number> = {};
  const areaDaily: Record<string, number[]> = {};
  // Earliest row per contributing feed. A feed that only started covering this
  // employer part-way through the window would otherwise draw a step change
  // that reads as hiring — see areaStart below.
  const areaSourceStart: Record<string, string> = {};
  const hubNow: Record<string, Record<string, number>> = {};
  const hubless: Record<string, number> = {};
  // Row-level, so an ad with four skills counts once here and four times above.
  let liveAds = 0;
  const liveByHub: Record<string, number> = {};
  const fresh: Record<string, number[]> = {};

  {
    for (const r of rows) {
      // parseStoredSkills, not a bare JSON.parse: archived rows keep the skill
      // names they were written with, so a renamed skill needs mapping forward
      // or that row's demand vanishes (see SKILL_ALIAS).
      const skills = parseStoredSkills(r.skills).filter((s) => s in SKILL_CATEGORY);
      if (!skills.length) continue;
      const fs = String(r.first_seen || "");
      const ls = String(r.last_seen || "");
      if (!fs || !ls) continue;
      // One vocabulary across both feeds that publish a taxonomy. See
      // data/hiringAreas.ts for why the two are mapped into a third rather than
      // SEEK being folded onto Adzuna, and for what is deliberately not an area.
      const src = String(r.source || "");
      const area = AREA_SOURCES.has(src) ? canonicalArea(r.category as string | null) : null;
      if (area && (!areaSourceStart[src] || fs < areaSourceStart[src])) areaSourceStart[src] = fs;

      if (ls >= liveFrom) {
        for (const s of skills) now[s] = (now[s] || 0) + 1;
        const aud = annualAud({
          salary: r.salary as string | null,
          hub: r.hub as string | null,
          source: src,
        });
        if (aud !== null) for (const s of skills) (payAds[s] ||= []).push(aud);
        if (area) areaNow[area] = (areaNow[area] || 0) + 1;
        // Hot spots are LIVE ads only: the map answers "where are they hiring
        // this now", not "where have they ever".
        const hub = String(r.hub || "").trim();
        liveAds += 1;
        if (hub) liveByHub[hub] = (liveByHub[hub] || 0) + 1;
        for (const sk of skills) {
          if (hub) {
            const byHub = (hubNow[sk] ||= {});
            byHub[hub] = (byHub[hub] || 0) + 1;
          } else {
            hubless[sk] = (hubless[sk] || 0) + 1;
          }
        }
      }
      const newAt = window.indexOf(fs);
      if (newAt >= 0)
        for (const sk of skills) (fresh[sk] ||= new Array(window.length).fill(0))[newAt] += 1;
      // A listing is live on day D when it was first seen on or before D and
      // last seen on or after it.
      for (let i = 0; i < window.length; i++) {
        const d = window[i];
        if (fs > d || ls < d) continue;
        for (const s of skills) {
          const arr = (daily[s] ||= new Array(window.length).fill(0));
          arr[i] += 1;
        }
        if (area) {
          const arr = (areaDaily[area] ||= new Array(window.length).fill(0));
          arr[i] += 1;
        }
      }
    }
  }

  const liveSkills = Object.keys(now);
  if (!liveSkills.length) return NO_SKILL_TRENDS;
  const days = window.slice(from);

  const skills: CompanySkillDemand[] = liveSkills
    .map((s) => {
      const full = daily[s];
      const cut = full ? full.slice(from) : [];
      const enough = cut.length >= SKILL_SPARK_MIN;
      // A dead-flat line is noise, not signal — leave it off.
      const moves = enough && cut.some((v) => v !== cut[0]);
      const loud = cut.length > 0 && Math.max(...cut) >= SKILL_MIN_VOLUME;
      const { pct } = loud ? halfWindowChange(cut) : { pct: null };
      return {
        skill: s,
        cat: SKILL_CATEGORY[s],
        now: now[s],
        spark: moves ? cut : undefined,
        newSpark: moves ? (fresh[s] || new Array(cut.length).fill(0)).slice(from) : undefined,
        pct,
        dir:
          pct === null || pct === 0
            ? ("flat" as const)
            : pct > 0
              ? ("up" as const)
              : ("down" as const),
        pay: medianAnnual(payAds[s] || []) ?? undefined,
        payN: (payAds[s] || []).length,
        hubs: Object.entries(hubNow[s] || {})
          .map(([hub, n]) => ({ hub, n }))
          .sort((x, y) => y.n - x.n || x.hub.localeCompare(y.hub)),
        hubless: hubless[s] || 0,
      };
    })
    .sort((a, b) => b.now - a.now || a.skill.localeCompare(b.skill));

  /**
   * Where the AREA series can honestly start.
   *
   * Not the same day the skills can. A feed that only began covering this
   * employer part-way through the window contributes nothing before that day,
   * so the areas it carries climb from near-zero — as collection, not as
   * hiring. Measured when SEEK was added: Mater's SEEK rows begin on one day,
   * 56 of 63 of them, and Healthcare & Medical came out at +996% over a
   * fortnight in which nothing much happened.
   *
   * So the area window starts at the LATEST first appearance among the feeds
   * that contributed one. Conservative — a feed that covered the employer all
   * along but genuinely had no ads until day 8 is treated the same way — and
   * conservative is the right direction, because the alternative is printing a
   * collection artefact as growth.
   */
  const areaStart = Object.values(areaSourceStart).sort().pop();
  const areaFrom = areaStart
    ? Math.max(
        from,
        window.findIndex((d) => d >= areaStart),
      )
    : from;

  const areas: CompanyAreaDemand[] = Object.keys(areaNow)
    .map((a) => {
      const cut = (areaDaily[a] || []).slice(areaFrom < 0 ? window.length : areaFrom);
      // Same floors and the same half-window comparison the skills use, so a
      // bar and its arrow are measured the same way.
      const loud = cut.length > 0 && Math.max(...cut) >= SKILL_MIN_VOLUME;
      const { pct, prev } = loud ? halfWindowChange(cut) : { pct: null, prev: 0 };
      return {
        area: a,
        now: areaNow[a],
        prev,
        pct,
        // Zero is a measured no-change, distinct from null. Rendering it as
        // "up" would put a growth arrow on a category that did not move.
        dir:
          pct === null || pct === 0
            ? ("flat" as const)
            : pct > 0
              ? ("up" as const)
              : ("down" as const),
      };
    })
    .sort((a, b) => b.now - a.now || a.area.localeCompare(b.area));

  return {
    days,
    skills,
    areas,
    liveAds,
    hubs: Object.entries(liveByHub)
      .map(([hub, n]) => ({ hub, n }))
      .sort((x, y) => y.n - x.n || x.hub.localeCompare(y.hub)),
  };
}

// ── market rank for a skill ─────────────────────────────────────────────────
//
// Where a skill sits by live-ad count across every employer in the archive,
// locally and worldwide. The company card prints it beside a skill's own count,
// because the count alone does not say whether it is a lot: measured on the
// live archive, BHP's largest skill is Mining Engineering at 63 ads, which is
// 54th of 96 nationally — big for this employer, niche in the market. HSE /
// Safety at 48 ads is 28th. Without the rank those two read the same way.
//
// Its own function, not a field on getCompanySkillTrends, for two reasons: the
// answer is identical for every company, so it wants one cache entry rather
// than one per card; and it is a market-wide scan, which is a different cost
// and a different market-visibility question from a company-scoped read.

export interface SkillRank {
  /** Rank by live ads inside `hubs`, 1 = most advertised. Null when the skill
   *  has no live ad there at all — absent is not "last". */
  localRank: number | null;
  localOf: number;
  localAds: number;
  globalRank: number | null;
  globalOf: number;
  globalAds: number;
}

export type SkillRanks = Record<string, SkillRank>;

export const getSkillMarketRanks = createServerFn({ method: "GET" })
  .validator((data: { hubs?: string[] }) => data)
  .handler(async ({ data }): Promise<SkillRanks> => {
    const db = await getArchiveDb();
    if (!db) return {};
    // "Local" is whatever hub set the caller names. The geography lives in the
    // map layer (CITY_COUNTRY, HUB_LNGLAT) and this function should not grow a
    // second opinion about which cities are in which country — it counts, the
    // caller decides what it is counting.
    const local = new Set((data.hubs || []).map((h) => h.trim()).filter(Boolean));
    // A market-wide roll-up has to be rolled up over the markets the reader can
    // actually see, or an end user reads a headline rank carrying vacancies
    // from countries the product has not released to them. Same rule the
    // ticker applies, same reason.
    const seesAll = (await callerRole()) === "admin";
    try {
      const res = await db
        .prepare(
          `SELECT skills, hub, company_id FROM jobs
             WHERE skills IS NOT NULL AND last_seen >= ?1`,
        )
        .bind(isoDaysAgo(1))
        .all();
      const rows = res?.results ?? [];
      if (!rows.length) return {};

      const globalN: Record<string, number> = {};
      const localN: Record<string, number> = {};
      for (const r of rows) {
        const hub = String(r.hub || "").trim();
        if (!seesAll && !isReleasedRow(hub || null, r.company_id as string | null)) continue;
        const skills = parseStoredSkills(r.skills).filter((s) => s in SKILL_CATEGORY);
        if (!skills.length) continue;
        const isLocal = local.has(hub);
        for (const s of skills) {
          globalN[s] = (globalN[s] || 0) + 1;
          if (isLocal) localN[s] = (localN[s] || 0) + 1;
        }
      }

      // Ties share a rank rather than being split by name: two skills on 40 ads
      // are equally in demand, and printing one as #12 and the other as #13
      // invents a distinction the counts do not carry.
      const ranked = (counts: Record<string, number>): Record<string, number> => {
        const order = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const out: Record<string, number> = {};
        let rank = 0;
        let prev: number | null = null;
        order.forEach(([name, n], i) => {
          if (n !== prev) {
            rank = i + 1;
            prev = n;
          }
          out[name] = rank;
        });
        return out;
      };
      const gRank = ranked(globalN);
      const lRank = ranked(localN);
      const gOf = Object.keys(globalN).length;
      const lOf = Object.keys(localN).length;

      const out: SkillRanks = {};
      for (const s of Object.keys(globalN)) {
        out[s] = {
          localRank: lRank[s] ?? null,
          localOf: lOf,
          localAds: localN[s] || 0,
          globalRank: gRank[s] ?? null,
          globalOf: gOf,
          globalAds: globalN[s],
        };
      }
      return out;
    } catch {
      return {};
    }
  });
