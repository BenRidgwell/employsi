import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLandingStats, type LandingStats } from "@/employsi/lib/landingStatsFn";
import {
  getLiveSkillTrends,
  TREND_WINDOWS,
  type LiveSkillTrend,
  type TrendWindow,
} from "@/employsi/lib/jobHistoryFn";

/**
 * The live figures on the marketing pages, and ONLY live figures.
 *
 * The design exports these pages came from ship with stand-ins: counters that
 * default to 248,000 / 36,500 / 42 / 1,180, a vacancy count that ticks up by a
 * random 1–4 every 2.2 seconds, a ticker of nine hand-written skills with
 * hand-written salaries and changes, and a hero overlay asserting "Project
 * management +6%, A$148,000". None of that is ported. Every number drawn here
 * comes from the same two server functions the previous landing page and the
 * app's own ticker read, so the site and the product cannot disagree:
 *
 *  • getLandingStats — the four counters (see landingStatsFn.ts for exactly
 *    what each one counts, and why "vacancies" is distinct roles, not rows).
 *  • getLiveSkillTrends — market-wide skill-demand movers per window, with an
 *    honest median salary where enough live ads state one.
 *
 * When a read fails the figure is SUPPRESSED ("—", or the overlay simply not
 * drawn), never back-filled with a plausible number.
 */

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function useLandingStats() {
  return useQuery({
    queryKey: ["landingStats"],
    queryFn: () => getLandingStats(),
    staleTime: SIX_HOURS,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}

export interface Movers {
  window: TrendWindow;
  /** "Last 24 hours" etc — names the window the figures were measured over. */
  label: string;
  short: string;
  rows: LiveSkillTrend[];
}

/**
 * The skill movers for the shortest window that has any, since a window whose
 * prior half predates the archive returns nothing on purpose (see
 * jobHistoryFn). The label travels with the rows so the page always names the
 * window it is actually showing, never the one it wished for.
 */
export function useSkillMovers(): { movers: Movers | null; loading: boolean } {
  // Same query key as the app ticker's, so a visitor moving on to /app reuses it.
  const { data, isPending } = useQuery({
    queryKey: ["liveSkillTrends"],
    queryFn: () => getLiveSkillTrends(),
    staleTime: SIX_HOURS,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  if (!data) return { movers: null, loading: isPending };
  for (const w of TREND_WINDOWS) {
    const rows = data[w.key];
    if (rows && rows.length) {
      return {
        movers: { window: w.key, label: w.label.replace(/^·\s*/, ""), short: w.short, rows },
        loading: false,
      };
    }
  }
  return { movers: null, loading: false };
}

/**
 * The riser and faller for the hero callouts — BOTH, from one window.
 *
 * The callouts are a pair by design (a green card and a red card), and the
 * ticker's window can hold only one side: on 2026-09-29 the 24-hour window
 * had fallers and no riser, so the green half of the overlay silently did not
 * draw. So this walks the windows shortest-first and takes the first one that
 * has a mover on each side. Both cards always come from the SAME window, so
 * the pair never compares a day's move with a month's.
 *
 * If no window has both, it falls back to whatever the shortest window with
 * any movers has — one card rather than an invented second one.
 */
export function useHeroMovers(): { up: LiveSkillTrend | null; down: LiveSkillTrend | null } {
  const { data } = useQuery({
    queryKey: ["liveSkillTrends"],
    queryFn: () => getLiveSkillTrends(),
    staleTime: SIX_HOURS,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  if (!data) return { up: null, down: null };
  let fallback: { up: LiveSkillTrend | null; down: LiveSkillTrend | null } | null = null;
  for (const w of TREND_WINDOWS) {
    const rows = data[w.key];
    if (!rows?.length) continue;
    const m = topMovers(rows);
    if (m.up && m.down) return m;
    fallback ??= m;
  }
  return fallback ?? { up: null, down: null };
}

/** The biggest riser and the biggest faller in one window's rows. */
export function topMovers(rows: LiveSkillTrend[]): {
  up: LiveSkillTrend | null;
  down: LiveSkillTrend | null;
} {
  let up: LiveSkillTrend | null = null;
  let down: LiveSkillTrend | null = null;
  for (const r of rows) {
    if (r.v > 0 && (!up || r.v > up.v)) up = r;
    if (r.v < 0 && (!down || r.v < down.v)) down = r;
  }
  return { up, down };
}

export const fmtCount = (n: number) => Math.round(n).toLocaleString("en-AU");

/** "+6.0%" / "−2.0%" — a real minus sign, so the two line up in tabular figures. */
export const fmtChange = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;

/**
 * Counts each stat up from zero the first time the element scrolls into view,
 * as the design does — but to the MEASURED value, and it stops there. The
 * design's version then kept adding a random 1–4 to the vacancy count every
 * 2.2 seconds, animating a precision the archive (refreshed nightly) does not
 * have.
 */
export function useCountUp(
  stats: LandingStats | null | undefined,
  keys: readonly (keyof Omit<LandingStats, "asAt">)[],
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  const [p, setP] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!("IntersectionObserver" in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen || !stats) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setP(1);
      return;
    }
    const t0 = performance.now();
    const D = 1800;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / D);
      setP(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, stats]);

  const values = Object.fromEntries(
    keys.map((k) => [k, stats ? fmtCount(stats[k] * p) : null]),
  ) as Record<(typeof keys)[number], string | null>;
  return { ref, values };
}
