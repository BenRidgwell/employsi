/**
 * The company card's view model, from `Employsi Company Card public.html` and
 * `Employsi Company Card private.html`.
 *
 * The two designs are the same card with three differences, and all three fall
 * out of whether the company files public accounts:
 *
 *   - the ticker chip reads its exchange listing, or "Private"
 *   - the second chart line is the share price, or revenue per employee
 *   - the third fact is time-to-hire, or the last known valuation
 *
 * so one builder covers both and `isPrivate` picks the variant.
 *
 * Everything here is assembled from sources we actually hold. Where a design
 * cell has no honest source it returns null and the card omits the row — the
 * alternative is a number that looks measured and isn't. What is currently
 * null, and why:
 *
 *   - **Time to hire.** `Company.timeToFill` is generated from a hash of the
 *     company id (see data/topPrivateCompanies.ts and the gov rosters); it is
 *     layout filler, not a measurement. Nothing we ingest records when a
 *     requisition opened and when it was filled.
 *   - **Last valuation.** No source, and nothing we ingest carries one for a
 *     proprietary company.
 *   - **Revenue per employee over time.** We hold the latest ratio (from the
 *     company-stats fetch, or the static seed), not a quarterly history — so
 *     the private card gets a figure, not a line.
 *   - **Hiring velocity** and the "vs 30 days ago" deltas are computed from the
 *     D1 vacancy archive, which only began collecting on 2026-07-20. They stay
 *     null until the window they claim actually exists.
 */

import type { Company } from "../data/companies";
import { smoothPath } from "./chart";
import { logoFor } from "./companyLogo";
import type { RolePoint } from "./openRolesFn";
import type { ShareSeries } from "./shareSeriesFn";

export interface CardStat {
  value: string;
  label: string;
  /** The value is a NAME, not a figure. The tile drops the mono display face
   *  for it — a skill title set at 22px monospace does not fit a third of a
   *  440px card, and set in figures' clothing it reads as a measurement. */
  textValue?: boolean;
  /** Small coloured figure beside the value (the headcount YoY). */
  delta?: string | null;
  deltaUp?: boolean;
  /** Provenance line, e.g. "40,648 · Jun 2025". */
  sub?: string | null;
}

export interface CardChartLine {
  label: string;
  /** SVG path over the shared 400×150 viewBox. */
  path: string;
  latest: string;
  delta: string;
  up: boolean;
}

export interface CardChart {
  /** e.g. "Last 6 days" — the archive's real window, never a rounder number. */
  label: string;
  vacancies: CardChartLine;
  area: string;
  /** Null when there is no second series on the same daily calendar. */
  second: CardChartLine | null;
  axis: string[];
  /**
   * The plotted points, so the chart can be scrubbed and markers can sit on the
   * lines. The paths above are already-projected SVG strings and a value cannot
   * be read back out of them, which is why the chart had no hover readout at
   * all.
   *
   * `days`, `vacValues` and `secondValues` are index-aligned; `secondValues`
   * and `secondPts` are null when there is no second series.
   */
  days: string[];
  vacValues: number[];
  secondValues: number[] | null;
  vacPts: [number, number][];
  secondPts: [number, number][] | null;
}

export interface CardFact {
  k: string;
  v: string;
}

export interface CardSkill {
  name: string;
  n: number;
}

export interface CardHiring {
  name: string;
  n: number;
  pct: string;
  /** Change over the archive's window; null while the window is too short. */
  delta: string | null;
}

export interface CompanyCard {
  id: string;
  name: string;
  sector: string;
  /** "ASX: WES", or "Private". */
  ticker: string;
  isPrivate: boolean;
  logo: string;
  mark: string;
  stats: CardStat[];
  chart: CardChart | null;
  /** Why the chart is missing, when it is. */
  chartNote: string | null;
  facts: CardFact[];
  skills: CardSkill[];
  /** Everything beyond the first SKILLS_SHOWN, so the card's "+N more" chip can
   *  reveal them without another round trip. */
  restSkills: CardSkill[];
  moreSkills: number;
  hiring: CardHiring[];
  hiringWindow: string | null;
}

const UP = "#1f6a48";
const DOWN = "#97332b";
export const TREND_UP = UP;
export const TREND_DOWN = DOWN;

const VB_W = 400;
const VB_H = 150;
/** Plot band inside the viewBox. The area fill closes on BASE_Y below the band
 *  so the gradient runs past the lowest point instead of stopping on it. */
const PLOT_TOP = 14;
const PLOT_BOT = 124;
const BASE_Y = 140;

interface Scale {
  x: (i: number) => number;
  y: (v: number) => number;
}

function scaleFor(d: number[]): Scale {
  const n = d.length;
  const min = Math.min(...d);
  const max = Math.max(...d);
  const span = max - min || 1;
  // The design pads the range by 35% either side so a flat series doesn't draw
  // as a line pinned to the floor of the box.
  const pad = span * 0.35;
  const lo = min - pad;
  const hi = max + pad;
  return {
    x: (i) => (i / Math.max(1, n - 1)) * (VB_W - 4) + 2,
    y: (v) => PLOT_BOT - ((v - lo) / (hi - lo)) * (PLOT_BOT - PLOT_TOP),
  };
}

function plot(d: number[]): [number, number][] {
  if (d.length < 2) return [];
  const s = scaleFor(d);
  return d.map((v, i) => [s.x(i), s.y(v)]);
}

function areaOf(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  return smoothPath(pts) + ` L ${VB_W} ${BASE_Y} L 0 ${BASE_Y} Z`;
}

function pctChange(d: number[]): number {
  if (d.length < 2 || !d[0]) return 0;
  return ((d[d.length - 1] - d[0]) / d[0]) * 100;
}

/** A tenth of a percent is meaningful at 6.5% and noise at 4250% — past 100 the
 *  decimal is dropped and the thousands separated, so the pill stays readable. */
function signed(v: number, unit = "%"): string {
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : 1;
  return (
    (v >= 0 ? "+" : "−") +
    a.toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits }) +
    unit
  );
}

/** "2026-07-21" → "21 Jul". */
function shortDay(iso: string): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Four evenly spaced labels across the series, as the design's axis. */
function axisOf(dates: string[]): string[] {
  if (dates.length < 2) return dates.map(shortDay);
  const want = Math.min(4, dates.length);
  const out: string[] = [];
  for (let i = 0; i < want; i++) {
    out.push(shortDay(dates[Math.round((i / (want - 1)) * (dates.length - 1))]));
  }
  return out;
}

export interface CardInputs {
  company: Company;
  /** Live open-role count, where a feed has one. */
  openRoles?: number | null;
  /** Reported headcount + YoY from the annual report, where we have it. */
  headcount?: { now: number; yoy: number; asof: string } | null;
  /** Daily live-vacancy series from the D1 archive. */
  vacancies: RolePoint[];
  /** Quarterly + daily share price, public companies only. */
  share?: ShareSeries | null;
  /** Latest revenue per employee, $m — private companies' second figure. */
  revPerEmp?: number | null;
  /** Median advertised salary across the live ads that state one. Null when
   *  none do — the seed `Company.salary` is illustrative, so a card with no
   *  live salary shows a gap rather than that number. */
  medianPay?: { text: string; n: number } | null;
  /** The busiest hiring area right now, for the "Biggest hiring area" fact.
   *  Passed in for the same reason as `topSkill`: the Hiring bars are drawn
   *  from the archive where it has areas, and a fact naming a different area
   *  than the top bar on the same card is worse than either being stale. */
  topArea?: string | null;
  /** The single most-advertised skill right now, for the headline tile.
   *  Passed in rather than taken off `skillCounts` so it comes from the same
   *  source as the Skills tab — the two naming different top skills on one card
   *  would be worse than either being slightly stale. */
  topSkill?: { name: string; n: number } | null;
  /** Skill → live-ad count for this company. */
  skillCounts: Record<string, number>;
  /** Role area → live-ad count for this company. */
  roleCounts: Record<string, number>;
}

const SKILLS_SHOWN = 6;
const HIRING_SHOWN = 6;
/** Below this many days the archive cannot support a change figure. */
const MIN_TREND_DAYS = 14;

export function buildCompanyCard(input: CardInputs): CompanyCard {
  const c = input.company;
  const isPrivate = !!c.private;

  // ── headline stats ──────────────────────────────────────────────────────
  const open = input.openRoles ?? c.openRoles;
  const hc = input.headcount;
  const pay = input.medianPay;
  const top = input.topSkill;
  const stats: CardStat[] = [
    { value: open.toLocaleString("en-AU"), label: "Open roles" },
    top
      ? {
          value: top.name,
          label: "Top skill in demand",
          sub: `${top.n} live ${top.n === 1 ? "ad" : "ads"}`,
          textValue: true,
        }
      : { value: "—", label: "Top skill in demand", sub: "no live ads mapped yet" },
  ];
  if (hc) {
    stats.push({
      value: hc.now >= 1000 ? `${(hc.now / 1000).toFixed(hc.now >= 10000 ? 0 : 1)}k` : `${hc.now}`,
      label: "Headcount · YoY",
      delta: signed(hc.yoy),
      deltaUp: hc.yoy >= 0,
      sub: `${hc.now.toLocaleString("en-AU")} · ${hc.asof}`,
    });
  } else {
    // No filed headcount: show the figure we do have and DON'T attach a YoY,
    // which would have nothing behind it.
    stats.push({
      value:
        c.headcount >= 1000
          ? `${(c.headcount / 1000).toFixed(c.headcount >= 10000 ? 0 : 1)}k`
          : `${c.headcount}`,
      label: "Headcount",
      sub: isPrivate ? "not disclosed · estimated" : null,
    });
  }

  // ── chart ───────────────────────────────────────────────────────────────
  const vac = input.vacancies;
  let chart: CardChart | null = null;
  let chartNote: string | null = null;
  if (vac.length >= 2) {
    const vals = vac.map((p) => p.c);
    const pts = plot(vals);
    const chg = pctChange(vals);
    const days = vac.length;
    let second: CardChartLine | null = null;
    let secondValues: number[] | null = null;
    let secondPts: [number, number][] | null = null;
    // The second line is only drawn when it sits on the SAME days as the
    // vacancy series. A quarterly share series or a single revenue ratio would
    // both look like a second line on this axis while measuring another window.
    const daily = input.share?.daily ?? [];
    const dailyDates = input.share?.dailyDates ?? [];
    if (!isPrivate && daily.length >= 2) {
      const byDate = new Map(dailyDates.map((d, i) => [d, daily[i]]));
      const aligned: number[] = [];
      let carry = 0;
      let matched = 0;
      for (const p of vac) {
        const v = byDate.get(p.d);
        if (typeof v === "number") {
          carry = v;
          matched++;
        }
        // A weekend or holiday has no close; the previous close IS the price on
        // that day, so carrying it forward is correct here (unlike inventing a
        // trading day, which is why the fetch drops nulls).
        aligned.push(carry || daily[0]);
      }
      if (matched >= 2) {
        secondValues = aligned;
        secondPts = plot(aligned);
        const chg2 = pctChange(aligned);
        second = {
          label: "Share price",
          path: smoothPath(secondPts),
          latest: `${input.share?.currency === "AUD" ? "A$" : "$"}${aligned[aligned.length - 1].toFixed(2)}`,
          delta: signed(chg2),
          up: chg2 >= 0,
        };
      }
    }
    chart = {
      label: `Last ${days} day${days === 1 ? "" : "s"}`,
      vacancies: {
        label: "Vacancies",
        path: smoothPath(pts),
        latest: vals[vals.length - 1].toLocaleString("en-AU"),
        delta: signed(chg),
        up: chg >= 0,
      },
      area: areaOf(pts),
      second,
      axis: axisOf(vac.map((p) => p.d)),
      days: vac.map((p) => p.d),
      vacValues: vals,
      secondValues,
      vacPts: pts,
      secondPts,
    };
  } else {
    chartNote =
      "No vacancy history for this employer yet — the archive records forward from the first time a company is queried.";
  }

  // ── facts ───────────────────────────────────────────────────────────────
  // Only rows with a source behind them. The design's third row (time to hire /
  // last valuation) has none for any company — see the file header.
  const facts: CardFact[] = [];
  const roleEntries = Object.entries(input.roleCounts).sort((a, b) => b[1] - a[1]);
  const biggestArea = input.topArea ?? roleEntries[0]?.[0] ?? null;
  if (biggestArea) facts.push({ k: "Biggest hiring area", v: biggestArea });
  if (vac.length >= MIN_TREND_DAYS) {
    const week = vac.slice(-7);
    const added = Math.max(0, week[week.length - 1].c - week[0].c);
    facts.push({ k: "Hiring velocity", v: `${added} more ads than 7 days ago` });
  }
  if (isPrivate && input.revPerEmp) {
    facts.push({ k: "Revenue per employee", v: `$${input.revPerEmp.toFixed(2)}m` });
  }
  if (pay) {
    // Displaced from the headline tiles by the top skill, but still a real
    // measurement off live ads — it keeps a row rather than leaving the card.
    facts.push({ k: "Median advertised salary", v: `${pay.text} · ${pay.n} live ads` });
  }
  if (!isPrivate && c.exchange) {
    facts.push({ k: "Listed on", v: c.exchange });
  }

  // ── skills + hiring ─────────────────────────────────────────────────────
  const skillEntries = Object.entries(input.skillCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const skills = skillEntries.slice(0, SKILLS_SHOWN).map(([name, n]) => ({ name, n }));
  const restSkills = skillEntries.slice(SKILLS_SHOWN).map(([name, n]) => ({ name, n }));

  const hiringTop = roleEntries.slice(0, HIRING_SHOWN);
  const hiMax = hiringTop.length ? hiringTop[0][1] : 1;
  const hiring: CardHiring[] = hiringTop.map(([name, n]) => ({
    name,
    n,
    pct: `${Math.max(3, Math.round((n / hiMax) * 100))}%`,
    delta: null,
  }));

  return {
    id: c.id,
    name: c.name,
    sector: c.sector,
    ticker: isPrivate ? "Private" : `${c.exchange || "ASX"}: ${c.ticker}`,
    isPrivate,
    logo: logoFor(c.id, c.domain),
    mark: c.ticker,
    stats,
    chart,
    chartNote,
    facts,
    skills,
    restSkills,
    moreSkills: restSkills.length,
    hiring,
    hiringWindow: vac.length >= MIN_TREND_DAYS ? `vs ${vac.length} days ago` : null,
  };
}
