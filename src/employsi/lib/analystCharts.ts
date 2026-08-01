import { ALL_SKILLS } from "../data/skillsTaxonomy";
import { IVI_MONTHS } from "../data/iviSkillDemand";
import { CITY_LABEL, GLOBAL_HUB_LABEL } from "../data/geo";
import { seriesFor } from "./skillHeat";
import { skillHistory, sourceForKey } from "./marketHistory";
import type {
  AnalystChartLine,
  AnalystChartMultiples,
  AnalystChartScatter,
  ScatterPoint,
} from "./analystFn";

/**
 * The chart shapes "Ask an analyst" can draw, built from `Analyst_Chart_Outputs`.
 *
 * ── WHAT THE DESIGN ASKED FOR, AND WHY THE SECOND SERIES CHANGED ───────────
 *
 * All four of the design's charts read employsi hiring against a company's
 * SHARE PRICE — a 12-month dual line, a lead–lag correlogram, a growth-vs-
 * correlation scatter, and peer small multiples of the same. Its own caption
 * states the rule the charts run on: "solid ink is employsi hiring data, dashed
 * grey is the market series it is being read against".
 *
 * That rule is kept. The market series is not, because employsi does not hold
 * one that would survive it:
 *
 *   • The share prices in data/finance.ts are EIGHT QUARTERLY POINTS per
 *     company, of which three are real (52-week low, 52-week high, last close)
 *     and the path between them is explicitly illustrative. Companies outside
 *     that list get a series derived from a hash of the ticker.
 *   • The vacancy archive's own history is one month deep — first_seen spans
 *     2026-07 to 2026-08 — and the `posted` dates that reach further back ramp
 *     from 88 rows a month to 36,733 as COLLECTION grew, not as hiring did.
 *
 * A Pearson r over an interpolated quarterly curve and a collection ramp would
 * be a number with three decimal places and nothing behind it. So the lead–lag
 * correlogram and every correlation figure are not built at all, and the second
 * line is the thing employsi genuinely measures against: the same national
 * vacancy series, for every category in the scope. "Is this skill growing
 * faster than the market it sits in" is a real question with a real answer,
 * drawn in the design's own chart language.
 *
 * Everything below therefore comes from the published monthly series (JSA IVI,
 * StatCan, MRSD, MBIE, ONS, Eurostat, BLS) — the same merge the heat map runs
 * on, so a chart here and a colour on the map can never disagree.
 */

/** Months of history to draw. Five years — long enough to show a cycle. */
const WINDOW = 60;

function labelFor(key: string): string {
  return GLOBAL_HUB_LABEL[key] || CITY_LABEL[key] || key;
}

/**
 * Rebase a slice to 100 at its first point.
 *
 * Two series counted in different units (a skill's vacancies against the whole
 * market's) cannot share a y-axis as raw counts — one would flatten the other
 * into the axis. Indexing both to 100 puts them in the same space and makes the
 * chart answer the only question worth asking of the pair: which grew faster.
 */
function rebase(values: number[]): number[] | null {
  const base = values.find((v) => v > 0);
  if (!base) return null;
  return values.map((v) => (v / base) * 100);
}

/**
 * Every published category in the scope, summed — the market a skill is read
 * against.
 *
 * Categories OVERLAP: one occupation maps to several skills, so this total is
 * larger than the true vacancy count. That is why it is only ever drawn as an
 * INDEX and never as a number — rebased to 100, the double counting cancels
 * and what is left is the market's shape, which is what the comparison needs.
 * The source line says so rather than leaving the reader to assume a headcount.
 */
function marketSeries(keys: string[], only?: Set<string>): number[] | null {
  const total = new Array(IVI_MONTHS.length).fill(0);
  let any = false;
  for (const skill of ALL_SKILLS) {
    if (only && !only.has(skill)) continue;
    const h = skillHistory(skill, keys);
    if (!h) continue;
    any = true;
    for (let i = 0; i < total.length; i++) total[i] += h.series[i] || 0;
  }
  return any ? total : null;
}

function windowOf(series: number[], from: number): { start: number; end: number } {
  const end = series.length - 1;
  return { start: Math.max(from, end - (WINDOW - 1)), end };
}

/**
 * 1a — the skill's own series against the market it sits in, both indexed.
 *
 * Returns null when the scope has under two years of overlapping history, which
 * is short enough that the line would be shape without meaning.
 */
export function lineChart(
  skill: string,
  keys: string[],
  only?: Set<string>,
): AnalystChartLine | null {
  const h = skillHistory(skill, keys);
  if (!h) return null;
  const market = marketSeries(keys, only);
  if (!market) return null;

  const { start, end } = windowOf(h.series, h.from);
  if (end - start < 24) return null;

  const subject = rebase(h.series.slice(start, end + 1));
  const reference = rebase(market.slice(start, end + 1));
  if (!subject || !reference) return null;

  return {
    kind: "line",
    months: IVI_MONTHS.slice(start, end + 1),
    series: [
      { label: skill, points: subject, tone: "ink" },
      { label: "All categories, same areas", points: reference, tone: "muted" },
    ],
    note: `Indexed to 100 at ${IVI_MONTHS[start]}`,
  };
}

/**
 * 1c — every category in the scope placed by how it moved.
 *
 * x is the year-on-year change, y the five-year change, and the bubble is
 * latest-month volume. The design's y-axis was correlation to a share price;
 * this is the same "two independent moves, sized by how much is at stake"
 * reading, using two measures the series actually publish.
 *
 * A 200-vacancy floor applies, the same one moversInScope uses: a category
 * going from 6 to 12 is +100% and pure noise, and on a scatter it would sit at
 * the far right where the eye goes first.
 */
export function scatterChart(keys: string[], only?: Set<string>): AnalystChartScatter | null {
  const points: ScatterPoint[] = [];
  for (const skill of ALL_SKILLS) {
    if (only && !only.has(skill)) continue;
    const h = skillHistory(skill, keys);
    if (!h || h.latest < 200 || h.yoy === null || h.fiveYear === null) continue;
    points.push({ label: skill, x: h.yoy, y: h.fiveYear, w: h.latest });
  }
  if (points.length < 4) return null;
  // Biggest first, so the labelled ones are the ones that matter.
  points.sort((a, b) => b.w - a.w);
  return {
    kind: "scatter",
    points: points.slice(0, 10),
    xLabel: "YEAR ON YEAR →",
    yLabel: "5-year",
  };
}

/**
 * 1d — the same skill across each area of the scope, as small multiples.
 *
 * The design compares four peer COMPANIES. These series carry no employer —
 * they are published per occupation and area — so the panels are the areas the
 * scope covers, which is the comparison the data supports. Each panel is that
 * area's own series, rebased, with its own year-on-year.
 */
export function multiplesChart(skill: string, keys: string[]): AnalystChartMultiples | null {
  const byCity = seriesFor(skill);
  if (!byCity) return null;
  const scope = keys.length ? keys : Object.keys(byCity);

  const panels = [];
  for (const key of scope) {
    const arr = byCity[key];
    if (!Array.isArray(arr)) continue;
    const from = arr.findIndex((v) => v > 0);
    if (from < 0) continue;
    const { start, end } = windowOf(arr, from);
    if (end - start < 24) continue;
    const points = rebase(arr.slice(start, end + 1));
    if (!points) continue;
    const latest = arr[end];
    if (latest < 100) continue; // too small to be worth a panel of its own
    const prior = end - 12 >= start ? arr[end - 12] : 0;
    const yoy = prior ? ((latest - prior) / prior) * 100 : null;
    panels.push({
      name: labelFor(key),
      points,
      latest,
      note:
        yoy === null
          ? "No year-earlier reading"
          : `${Math.round(latest).toLocaleString("en-US")} latest`,
      delta: yoy === null ? "—" : `${yoy >= 0 ? "+" : "−"}${Math.abs(yoy).toFixed(0)}%`,
      down: yoy !== null && yoy < 0,
    });
  }
  if (panels.length < 2) return null;
  panels.sort((a, b) => b.latest - a.latest);
  return {
    kind: "multiples",
    panels: panels.slice(0, 4).map(({ name, points, note, delta, down }) => ({
      name,
      points,
      note,
      delta,
      down,
    })),
  };
}

/** The agencies behind a scope, for a chart's source line. */
export function sourcesFor(keys: string[]): string[] {
  const scope = keys.length ? keys : Object.keys(seriesFor(ALL_SKILLS[0]) ?? {});
  return [...new Set(scope.map(sourceForKey).filter(Boolean) as string[])];
}
