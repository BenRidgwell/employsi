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

import { companyGroup, type Company } from "../data/companies";
import { smoothPath } from "./chart";
import { logoFor } from "./companyLogo";
import type { RolePoint } from "./openRolesFn";
import type { ShareSeries } from "./shareSeriesFn";
import { COMPANY_HEADCOUNT } from "../data/companyHeadcount";
import { GOV_HEADCOUNT } from "../data/perthGovWorkforce";
import { GOV_HEADCOUNT_AU } from "../data/govWorkforceAu";

/** Which badge the tile draws. Three fixed stats, so three fixed glyphs. */
export type StatIcon = "roles" | "skill" | "headcount";

export interface CardStat {
  value: string;
  label: string;
  /** Badge glyph. The tile draws nothing if absent, so a new stat is not
   *  silently given someone else's icon. */
  icon?: StatIcon;
  /** The value is a NAME, not a figure. The tile drops the mono display face
   *  for it — a skill title set at 22px monospace does not fit a third of a
   *  440px card, and set in figures' clothing it reads as a measurement. */
  textValue?: boolean;
  /** Small coloured figure below the value (the headcount YoY). */
  delta?: string | null;
  deltaUp?: boolean;
  /** What the delta is measured over, set beside it in the quiet colour —
   *  "12.8%" alone does not say over what. */
  deltaNote?: string | null;
  /** Provenance line, e.g. "40,648 · Jun 2025". */
  sub?: string | null;
}

/** The card's headcount input, from either source that supplies one. */
export interface CardHeadcount {
  now: number;
  yoy: number | null;
  asof: string;
  span: number;
}

/**
 * Normalise a headcount record into the card's input, in ONE place.
 *
 * Two files supply one: COMPANY_HEADCOUNT, which carries its own measured
 * `span` because the aggregator skips years, and GOV_HEADCOUNT, which has no
 * span field — the WA PSC bulletins report consecutive annual averages by
 * construction, so it is always a year.
 *
 * That "always a year" is a real assumption and it belongs in one place. It was
 * briefly written inline at the two call sites, and they immediately disagreed:
 * the card said one year, the checker read `undefined` and rendered "over
 * undefined years". A default this load-bearing gets stated once.
 */
export function headcountFor(
  rec: { now: number; yoy: number | null; asof: string; span?: number } | null | undefined,
): CardHeadcount | null {
  return rec ? { now: rec.now, yoy: rec.yoy, asof: rec.asof, span: rec.span ?? 1 } : null;
}

/**
 * The filed headcount for a company id, from whichever source has one.
 *
 * THREE SOURCES, ONE LOOKUP, and the merge lives here because it was written
 * out by hand at three call sites and the copies drift — the `span` default
 * disagreed between the card and its own checker within an hour of being
 * added. A fourth jurisdiction should change this function and nothing else.
 *
 *   COMPANY_HEADCOUNT   listed companies, from annual reports
 *   GOV_HEADCOUNT       WA agencies, from the PSC bulletins (predates the
 *                       generator, and carries no span — see headcountFor)
 *   GOV_HEADCOUNT_AU    APS and Victorian agencies, from their open data
 *
 * Order matters only in that the keyspaces do not overlap: a WA agency id
 * cannot collide with a ticker-derived id or an `aps-`/`vic-gov-` one.
 */
export function filedHeadcount(id: string): CardHeadcount | null {
  return headcountFor(COMPANY_HEADCOUNT[id] ?? GOV_HEADCOUNT[id] ?? GOV_HEADCOUNT_AU[id]);
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
  /**
   * Index of the first day the second series actually has a value for. 0 when
   * it covers the whole window, which is the normal case.
   *
   * It exists because the alternative is drawing a line where there is no
   * data. The share fetch asks for six months against a chart of at most 90
   * days, so this is only non-zero for a company that listed inside the
   * window — but when it happens, a flat segment carried back from the first
   * close is indistinguishable from a price that genuinely did not move, and
   * that is the invented-figure failure this codebase exists to avoid.
   */
  secondFrom: number;
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
  /** The broad SECTOR_GROUPS bucket, for the header's sector badge. Distinct
   *  from `sector`, which is the granular label the card prints — "Metals &
   *  Mining" is displayed, "Energy & Natural Resources" picks the glyph. */
  group: string;
  /** "ASX: WES", or "Private". */
  ticker: string;
  /** The two halves of the ticker chip, which the design colours separately.
   *  Both empty for a private company, which gets a single "Private" chip. */
  exchange: string;
  symbol: string;
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
  /**
   * Reported headcount and its change from the annual report, where we have it.
   *
   * `span` is the YEARS BETWEEN the two readings and is NOT always 1. The
   * aggregator skips years for some companies — Qantas's table runs Jun 2026,
   * Jun 2023, Jun 2022 — so the two newest rows can be three years apart, and
   * calling their difference year-on-year reported +60.0%. Measured
   * 2026-09-24: 11 of 137 companies were not a year apart, the worst of them
   * Capricorn Metals at +1,325% over seven years. `yoy` is null where the span
   * could not be established at all.
   */
  headcount?: CardHeadcount | null;
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
/** The hiring-velocity comparison, capped by what the archive holds. */
const VELOCITY_DAYS = 30;

export function buildCompanyCard(input: CardInputs): CompanyCard {
  const c = input.company;
  const isPrivate = !!c.private;

  // ── headline stats ──────────────────────────────────────────────────────
  /**
   * The live open-role count, or NOTHING.
   *
   * This used to be `input.openRoles ?? c.openRoles`, and the fallback was the
   * bug behind a card that showed "111 open roles" beside an empty vacancy
   * chart: the chart draws only archived days and had none, while the number
   * came from hash01(ticker + name). The two halves of the card disagreed
   * because one was measured and one was invented.
   *
   * A roster company's figure is now suppressed instead. Curated records
   * (companies.ts) have no `illustrative` flag and keep their fallback, which
   * is a real number someone entered.
   */
  const open = input.openRoles ?? (c.illustrative ? null : c.openRoles);
  const hc = input.headcount;
  const pay = input.medianPay;
  const top = input.topSkill;
  // Labels are short because the tile is 132px per column and they now sit on
  // their own line above the figure rather than beneath it — "Top skill in
  // demand" wraps to three lines there. The section heading below already says
  // "Skills in demand", so the longer phrasing was repeating itself anyway. The
  // YoY qualifier moved onto the delta line, where the percentage it qualifies
  // actually is.
  const stats: CardStat[] = [
    open === null
      ? {
          // Same shape as the "Top skill" miss below: an em dash and a reason,
          // rather than a figure with nothing behind it.
          value: "—",
          label: "Open roles",
          sub: "no live feed for this employer",
          icon: "roles",
        }
      : { value: open.toLocaleString("en-AU"), label: "Open roles", icon: "roles" },
    top
      ? {
          value: top.name,
          label: "Top skill",
          sub: `${top.n} live ${top.n === 1 ? "ad" : "ads"}`,
          textValue: true,
          icon: "skill",
        }
      : { value: "—", label: "Top skill", sub: "no live ads mapped yet", icon: "skill" },
  ];
  if (hc) {
    stats.push({
      value: hc.now >= 1000 ? `${(hc.now / 1000).toFixed(hc.now >= 10000 ? 0 : 1)}k` : `${hc.now}`,
      label: "Headcount",
      // No change at all when the span is unknown, and the REAL span named when
      // it is not a year — "over 7 years" beside +1,325% is a fact; "YoY"
      // beside it is not.
      delta: hc.yoy === null ? null : signed(hc.yoy),
      deltaUp: (hc.yoy ?? 0) >= 0,
      deltaNote: hc.yoy === null ? null : hc.span === 1 ? "YoY" : `over ${hc.span} years`,
      sub: `${hc.now.toLocaleString("en-AU")} · ${hc.asof}`,
      icon: "headcount",
    });
  } else if (!c.illustrative && c.headcount > 0) {
    // No filed headcount, but a curated one someone entered. Show it, and
    // DON'T attach a YoY, which would have nothing behind it.
    stats.push({
      value:
        c.headcount >= 1000
          ? `${(c.headcount / 1000).toFixed(c.headcount >= 10000 ? 0 : 1)}k`
          : `${c.headcount}`,
      label: "Headcount",
      sub: isPrivate ? "not disclosed · estimated" : null,
      icon: "headcount",
    });
  } else {
    stats.push({
      value: "—",
      label: "Headcount",
      // WHY it is absent differs, and one line cannot honestly cover both.
      //
      //  • A roster company's `c.headcount` is hash01(ticker + name) — Deterra
      //    Royalties came out at 9,883 against a real staff count in the tens —
      //    so it is not shown. "not filed" is the shorthand this card has
      //    always used for it.
      //  • A `headcount` of 0 means UNKNOWN, not zero. The government and
      //    university builders set it deliberately — see buildGovAgency in
      //    perthGov.ts, whose own comment says "the card shows no fabricated
      //    workforce numbers for it" — and this branch is what makes that
      //    true. It says "collected" rather than "filed" or "published"
      //    because it must also be honest about the 41 universities in this
      //    state, which DO publish staff figures; we simply have not wired a
      //    source for them.
      sub: c.illustrative ? "not filed" : "no workforce figure collected",
      icon: "headcount",
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
    let from = 0;
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
      // The first day a real close lands on. Days before it are padded so the
      // array stays index-aligned with the vacancy series, but they are NOT
      // drawn — see secondFrom.
      let firstReal = -1;
      for (const p of vac) {
        const v = byDate.get(p.d);
        if (typeof v === "number") {
          carry = v;
          matched++;
          if (firstReal < 0) firstReal = aligned.length;
        }
        // A weekend or holiday has no close; the previous close IS the price on
        // that day, so carrying it forward is correct here (unlike inventing a
        // trading day, which is why the fetch drops nulls).
        aligned.push(carry || daily[0]);
      }
      if (matched >= 2) {
        from = Math.max(0, firstReal);
        secondValues = aligned;
        secondPts = plot(aligned);
        // Change is measured over the DRAWN span, not the padded one. Reading
        // it from index 0 would compare the real latest price against a value
        // carried backwards, which is a percentage between a fact and a
        // placeholder.
        const chg2 = pctChange(aligned.slice(from));
        second = {
          label: "Share price",
          path: smoothPath(from > 0 ? secondPts.slice(from) : secondPts),
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
      secondFrom: from,
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
    // A month, not a week. A single scrape landing late moves a seven-day
    // endpoint-to-endpoint read by more than most employers move in a month, so
    // the shorter window was mostly reporting collection noise.
    //
    // The span is whatever the archive can actually supply up to VELOCITY_DAYS,
    // and the sentence names it. Collection began on 2026-07-20, so asking for
    // 30 currently yields fewer; claiming "30 days ago" over 24 days of history
    // would be the card inventing a month it never watched. N points span N-1
    // days between the two endpoints being compared.
    const win = vac.slice(-VELOCITY_DAYS);
    const spanDays = win.length - 1;
    const moved = win[win.length - 1].c - win[0].c;
    // Signed. The previous form clamped at zero, so an employer that had shed
    // forty ads read "0 more ads" — indistinguishable from one that had not
    // moved at all.
    const v =
      moved === 0
        ? `unchanged on ${spanDays} days ago`
        : `${Math.abs(moved)} ${moved > 0 ? "more" : "fewer"} ads than ${spanDays} days ago`;
    facts.push({ k: "Hiring velocity", v });
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
    group: companyGroup(c),
    ticker: isPrivate ? "Private" : `${c.exchange || "ASX"}: ${c.ticker}`,
    exchange: isPrivate ? "" : c.exchange || "ASX",
    symbol: isPrivate ? "" : c.ticker,
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
