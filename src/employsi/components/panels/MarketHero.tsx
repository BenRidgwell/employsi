import { useMemo } from "react";
import { smoothPath } from "../../lib/chart";
import type { SkillMarket } from "../../lib/jobHistoryFn";

const W = 320;
const TOP = 26;
const BOT = 104;
const BASE = 118;

function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}b`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

/**
 * Where a tag sits, and how it aligns.
 *
 * An extreme on the first or last day is the common case — a series that ends
 * on its high or low is exactly what a reader looks for — and a centred tag
 * there hangs half of itself outside the pane. Those two align to their edge
 * instead, which is the same rule the timeline scrubber's end labels follow.
 */
function edge(i: number, n: number): string {
  if (i === 0) return "first";
  if (i === n - 1) return "last";
  return "";
}
function pos(i: number, n: number): { left: string } {
  return { left: `${(i / Math.max(1, n - 1)) * 100}%` };
}

/** "2026-08-11" → "11 Aug". */
function shortDay(iso: string): string {
  const t = Date.parse((iso || "") + "T00:00:00Z");
  if (Number.isNaN(t)) return iso || "";
  return new Date(t).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Advertised value over the window: the market's own line, or one skill's when
 * a row below is selected.
 *
 * The high and low are marked and labelled rather than an axis being drawn. A
 * y-axis on nine days of data implies a precision the series does not have, and
 * the two points a reader actually wants from a shape like this are where it
 * peaked and where it bottomed — which is what the reference design does too.
 *
 * A SELECTED SKILL'S LINE IS DERIVED, NOT REFETCHED. Value is price times
 * volume and the price is static across the window, so the skill's series is
 * its own daily counts scaled by its median. That keeps the hero and the row
 * arithmetically identical — a chart that disagreed with the row beneath it
 * would be worse than no chart.
 */
export function MarketHero({
  market,
  skill,
  onClear,
}: {
  market: SkillMarket;
  skill: string | null;
  onClear: () => void;
}) {
  const picked = skill ? (market.rows.find((r) => r.skill === skill) ?? null) : null;

  const series = useMemo(() => {
    if (!picked) return market.valueSeries;
    // An unpriced skill has no value line; its demand is still a series, but
    // plotting counts on an axis labelled in dollars would be a lie.
    if (picked.pay === null || !picked.spark) return [];
    return picked.spark.map((v) => v * picked.pay!);
  }, [picked, market.valueSeries]);

  const geom = useMemo(() => {
    if (series.length < 2) return null;
    const lo = Math.min(...series);
    const hi = Math.max(...series);
    const pad = (hi - lo || Math.max(1, hi * 0.1)) * 0.25;
    const a = lo - pad;
    const b = hi + pad;
    const x = (i: number) => (i / (series.length - 1)) * W;
    const y = (v: number) => BOT - ((v - a) / (b - a)) * (BOT - TOP);
    const pts: [number, number][] = series.map((v, i) => [x(i), y(v)]);
    const line = smoothPath(pts);
    return {
      line,
      area: `${line} L ${W} ${BASE} L 0 ${BASE} Z`,
      hiAt: series.indexOf(hi),
      loAt: series.indexOf(lo),
      hi,
      lo,
      x,
      y,
    };
  }, [series]);

  const latest = series.length ? series[series.length - 1] : 0;
  const first = series.length ? series[0] : 0;
  const pct = first > 0 ? ((latest - first) / first) * 100 : null;
  const days = market.days;

  return (
    <div className={`mkhero ${picked ? "picked" : ""}`}>
      <div className="mkherohd">
        <div className="mkherottl">
          <span className="cceyebrow">
            {picked ? "Skill" : "Advertised value"}
            {days.length > 1 && ` · ${shortDay(days[0])} – ${shortDay(days[days.length - 1])}`}
          </span>
          <span className="mkheroname">{picked ? picked.skill : market.scope}</span>
        </div>
        {picked && (
          <button type="button" className="mkheroclear" onClick={onClear}>
            Whole market
          </button>
        )}
      </div>

      {geom ? (
        <div className="mkheroplot">
          <svg viewBox={`0 0 ${W} ${BASE}`} preserveAspectRatio="none" aria-hidden="true">
            <path className="mkheroarea" d={geom.area} />
            <path className="mkheroline" d={geom.line} />
            <circle className="mkheropt" cx={geom.x(geom.hiAt)} cy={geom.y(geom.hi)} r={3} />
            <circle className="mkheropt" cx={geom.x(geom.loAt)} cy={geom.y(geom.lo)} r={3} />
          </svg>
          {/* Labels are HTML over the SVG, not text inside it: the viewBox is
              stretched to the pane's width and text in it would stretch too. */}
          <span
            className={`mkherotag hi ${edge(geom.hiAt, series.length)}`}
            style={pos(geom.hiAt, series.length)}
          >
            {money(geom.hi)}
          </span>
          <span
            className={`mkherotag lo ${edge(geom.loAt, series.length)}`}
            style={pos(geom.loAt, series.length)}
          >
            {money(geom.lo)}
          </span>
        </div>
      ) : (
        <div className="mkheronone">
          {picked && picked.pay === null
            ? "No pay disclosed for this skill, so it has no value line — its demand is in the row below."
            : "Not enough collected days to draw a line."}
        </div>
      )}

      {geom && (
        <div className="mkherofoot">
          <span>
            <b>{money(latest)}</b> {picked ? "advertised for this skill" : "across the market"}
          </span>
          {pct !== null && (
            <span className={pct >= 0 ? "up" : "down"}>
              {pct >= 0 ? "+" : "−"}
              {Math.abs(pct).toFixed(1)}% over {days.length} days
            </span>
          )}
        </div>
      )}
    </div>
  );
}
