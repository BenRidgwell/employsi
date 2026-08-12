import { useMemo } from "react";
import { smoothPath } from "../../lib/chart";
import { MARKET_WINDOWS, type SkillMarket } from "../../lib/jobHistoryFn";

const W = 320;
/** The line's band. The viewBox runs to BASE so the fill carries on below the
 *  lowest point and out of the card, leaving the strip the period tabs sit on. */
const TOP = 30;
const BOT = 100;
/** The plot is exactly BASE pixels tall (.mkheroplot in global.css), so an SVG
 *  y IS a pixel offset and the HTML overlays can be positioned from the same
 *  numbers the path uses. Change one and change the other. */
const BASE = 150;

function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}b`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}m`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

/**
 * "$195.6m" → ["$195", ".6m"].
 *
 * The reference sets the dollars large and the tail small and dim, which is
 * worth copying for a reason beyond looks: at this scale the leading digits are
 * the only part a median-of-medians actually supports. Dimming the tail says so
 * without a caveat.
 */
function moneyParts(v: number): [string, string] {
  const m = /^(\$[\d,]+)(\.\d+)?([a-z]?)$/.exec(money(v));
  if (!m) return [money(v), ""];
  return [m[1], `${m[2] ?? ""}${m[3]}`];
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
 * One extreme: an open ring on the point it fell on.
 *
 * The figures live in the line under the headline, not on the plot. Chipped
 * onto the chart they read better in isolation but the high sat under the
 * callout about as often as not — the callout is anchored above the last point
 * and a peak late in the window lands squarely behind it. A label that
 * disappears at certain shapes is worse than one placed somewhere dull.
 */
function Extreme({
  geom,
  at,
  v,
}: {
  geom: { px: (i: number) => string; y: (v: number) => number };
  at: number;
  v: number;
}) {
  return <span className="mkheropt" style={{ left: geom.px(at), top: `${geom.y(v)}px` }} />;
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
 * THE EXTREMES ARE LABELLED ON THEIR OWN MARKERS, with no rule drawn across the
 * card to them. Chipped, because the stroke crosses that band elsewhere in the
 * window and a bare label collides with it about as often as not.
 *
 * DIRECTION IS THE ONE THING ON THIS CARD THAT CARRIES COLOUR, and it is the
 * same green and red the rows below already use — the ramp in tokens.css,
 * lightened for an ink ground rather than a second palette invented for it.
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
  days: windowDays,
  onDays,
}: {
  market: SkillMarket;
  skill: string | null;
  onClear: () => void;
  days: number;
  onDays: (d: number) => void;
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
    const n = series.length;
    const x = (i: number) => (i / (n - 1)) * W;
    const y = (v: number) => BOT - ((v - a) / (b - a)) * (BOT - TOP);
    const pts: [number, number][] = series.map((v, i) => [x(i), y(v)]);
    const line = smoothPath(pts);
    const hiAt = series.indexOf(hi);
    const loAt = series.indexOf(lo);
    // Percentages, because the SVG is stretched to the card's width and the
    // overlays are HTML sitting on top of it — and clamped, because the plot
    // bleeds to the card's edges and a ring centred on day one or on the last
    // day would otherwise be sliced in half by overflow:hidden.
    const px = (i: number) =>
      `min(calc(100% - 10px), max(10px, ${(i / Math.max(1, n - 1)) * 100}%))`;
    return {
      line,
      area: `${line} L ${W} ${BASE} L 0 ${BASE} Z`,
      hiAt,
      loAt,
      hi,
      lo,
      lastVal: series[n - 1],
      px,
      y,
      flat: hi === lo,
    };
  }, [series]);

  const latest = series.length ? series[series.length - 1] : 0;
  const first = series.length ? series[0] : 0;
  const pct = first > 0 ? ((latest - first) / first) * 100 : null;
  const delta = first > 0 ? latest - first : null;
  const days = market.days;
  // An em-dash, not $0. A skill with no disclosed pay has no value, and a
  // headline of "$0" says it is worth nothing rather than that it is unpriced.
  const [head, tail] = series.length ? moneyParts(latest) : ["—", ""];

  // No series, no direction: the card stays white rather than guessing one.
  const dir = pct === null ? "" : pct > 0 ? "up" : pct < 0 ? "down" : "flat";

  return (
    <div className={`mkhero ${dir} ${picked ? "picked" : ""}`}>
      <div className="mkherohd">
        <span className="mkherottl">{picked ? picked.skill : market.scope}</span>
        {picked && (
          <button type="button" className="mkheroclear" onClick={onClear}>
            Whole market
          </button>
        )}
      </div>

      <span className="mkherolbl">
        {picked ? "Advertised value · this skill" : "Advertised value"}
        {days.length > 1 && ` · ${shortDay(days[0])} – ${shortDay(days[days.length - 1])}`}
      </span>

      {/* The headline sits INSIDE the card with the line it describes. Split
          apart — a figure in one panel, its chart in the next — a reader has to
          take on trust that they are the same quantity. */}
      <div className="mkherobig">
        <span className="mkherovalue">
          {head}
          {tail && <span className="mkherotail">{tail}</span>}
        </span>
        {pct !== null && (
          <span className={`mkherochg ${pct >= 0 ? "up" : "down"}`}>
            <span aria-hidden="true" className="mkherotri">
              {pct >= 0 ? "▲" : "▼"}
            </span>
            {Math.abs(pct).toFixed(1)}%
          </span>
        )}
      </div>
      {/* The movement, then the two levels the rings on the plot mark. Off the
          chart deliberately: see Extreme. */}
      {(delta !== null || geom) && (
        <span className="mkherodelta">
          {delta !== null && (
            <>
              {delta >= 0 ? "+" : "−"}
              {money(Math.abs(delta))} over {days.length} days
            </>
          )}
          {geom && !geom.flat && (
            <>
              {delta !== null && " · "}
              high {money(geom.hi)} · low {money(geom.lo)}
            </>
          )}
        </span>
      )}

      {geom ? (
        <div className="mkheroplot">
          <svg viewBox={`0 0 ${W} ${BASE}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="mkheroFill" x1="0" y1="0" x2="0" y2="1">
                {/* currentColor, set on the svg by .mkhero.up / .mkhero.down,
                    so the wash is the same colour as the line above it. */}
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
                <stop offset="45%" stopColor="currentColor" stopOpacity="0.13" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="mkheroarea" d={geom.area} />
            <path className="mkheroline" d={geom.line} />
          </svg>

          {/* Markers are HTML, not <circle>. The viewBox is stretched to the
              card's width with preserveAspectRatio="none", which turns a circle
              into an ellipse — the reference's markers are round. */}
          <Extreme geom={geom} at={geom.hiAt} v={geom.hi} />
          {!geom.flat && <Extreme geom={geom} at={geom.loAt} v={geom.lo} />}

          {/* The reference's callout: the latest reading, named and dated, on
              the point that carries it. It is the same figure as the headline —
              which is the point of putting it on the line. */}
          <span
            className="mkheroglow"
            style={{ left: geom.px(series.length - 1), top: `${geom.y(geom.lastVal)}px` }}
          />
          <span
            className="mkheroend"
            style={{ left: geom.px(series.length - 1), top: `${geom.y(geom.lastVal)}px` }}
          />
          <span
            className="mkherocall"
            style={{ top: `${Math.max(2, geom.y(geom.lastVal) - 52)}px` }}
          >
            <span className="mkherocallk">{shortDay(days[days.length - 1] ?? "")}</span>
            <span className="mkherocallv">{money(geom.lastVal)}</span>
          </span>
        </div>
      ) : (
        <div className="mkheronone">
          {picked && picked.pay === null
            ? "No pay disclosed for this skill, so it has no value line — its demand is in the row below."
            : "Not enough collected days to draw a line."}
        </div>
      )}

      {/* The period belongs with the chart it resizes, not in a toolbar two
          sections away. */}
      <div className="mkherowins" role="tablist" aria-label="Period">
        {MARKET_WINDOWS.map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={w === windowDays}
            className={`mkherowin ${w === windowDays ? "on" : ""}`}
            onClick={() => onDays(w)}
          >
            {w}d
          </button>
        ))}
      </div>
    </div>
  );
}
