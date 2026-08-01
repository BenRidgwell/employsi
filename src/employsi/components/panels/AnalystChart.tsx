import type {
  AnalystChart as Chart,
  AnalystChartLine,
  AnalystChartMultiples,
  AnalystChartScatter,
} from "../../lib/analystFn";

/**
 * The analyst's charts, drawn to `Analyst_Chart_Outputs`.
 *
 * Plain SVG with no charting library: the shapes are fixed, the data is small,
 * and a dependency would be a lot of bytes for four polylines. Geometry matches
 * the design's own view boxes so the proportions carry over.
 *
 * One chart language throughout, exactly as the design states it: SOLID INK is
 * the series being asked about, DASHED GREY is what it is being read against.
 * Every chart is followed by the caption and source line the answer already
 * carries — see AnalystPane — because a chart without provenance is the same
 * fault as a number without it.
 */

const INK = "#1c1c1e";
const MUTED = "#aeaeb2";

function monthTick(iso: string): string {
  const [y, m] = iso.split("-");
  const names = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  return `${names[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

/** 1a — two indexed series over time. */
function LineChart({ chart }: { chart: AnalystChartLine }) {
  const W = 640;
  const H = 244;
  const L = 46; // left gutter for the value axis
  const R = 592;
  const TOP = 30;
  const BOT = 200;

  const all = chart.series.flatMap((s) => s.points);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // Pad the band so the extremes are not drawn on the frame itself.
  const pad = (hi - lo) * 0.12 || 10;
  const min = lo - pad;
  const max = hi + pad;

  const n = chart.months.length;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (R - L);
  const y = (v: number) => BOT - ((v - min) / (max - min || 1)) * (BOT - TOP);

  // Five gridlines, labelled with the index value they sit at.
  const rows = [0, 1, 2, 3, 4].map((k) => {
    const v = min + ((max - min) * k) / 4;
    return { v, y: y(v) };
  });

  // Six ticks at most, always including both ends.
  const step = Math.max(1, Math.floor((n - 1) / 5));
  const ticks: number[] = [];
  for (let i = 0; i < n; i += step) ticks.push(i);
  if (ticks[ticks.length - 1] !== n - 1) ticks.push(n - 1);

  return (
    <svg className="anchartsvg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      <g stroke="#f4f4f5" strokeWidth={1}>
        {rows.map((r) => (
          <line key={r.v} x1={L} y1={r.y} x2={R} y2={r.y} />
        ))}
      </g>
      {chart.series.map((s) => (
        <polyline
          key={s.label}
          points={s.points.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
          fill="none"
          stroke={s.tone === "ink" ? INK : MUTED}
          strokeWidth={s.tone === "ink" ? 2.2 : 1.8}
          strokeDasharray={s.tone === "ink" ? undefined : "5 4"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {chart.series.map((s) =>
        s.tone === "ink" ? (
          <circle key={s.label} cx={x(n - 1)} cy={y(s.points[n - 1])} r={3.4} fill={INK} />
        ) : (
          <circle
            key={s.label}
            cx={x(n - 1)}
            cy={y(s.points[n - 1])}
            r={3}
            fill="#fff"
            stroke={MUTED}
            strokeWidth={1.8}
          />
        ),
      )}
      <g className="anchartaxis">
        {rows.map((r) => (
          <text key={r.v} x={L - 8} y={r.y + 3} textAnchor="end">
            {Math.round(r.v)}
          </text>
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={BOT + 26} textAnchor="middle">
            {monthTick(chart.months[i])}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** 1c — categories placed by how they moved, sized by volume. */
function ScatterChart({ chart }: { chart: AnalystChartScatter }) {
  const W = 520;
  const H = 292;
  const L = 60;
  const R = 500;
  const TOP = 30;
  const BOT = 250;

  const xs = chart.points.map((p) => p.x);
  const ys = chart.points.map((p) => p.y);
  // Always include zero on both axes: the quadrant boundary is the reading.
  const xlo = Math.min(0, ...xs);
  const xhi = Math.max(0, ...xs);
  const ylo = Math.min(0, ...ys);
  const yhi = Math.max(0, ...ys);
  const xpad = (xhi - xlo) * 0.18 || 5;
  const ypad = (yhi - ylo) * 0.18 || 5;
  const x0 = xlo - xpad;
  const x1 = xhi + xpad;
  const y0 = ylo - ypad;
  const y1 = yhi + ypad;

  const px = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * (R - L);
  const py = (v: number) => BOT - ((v - y0) / (y1 - y0 || 1)) * (BOT - TOP);

  const wMax = Math.max(...chart.points.map((p) => p.w));
  // Area-proportional, so a bubble twice as wide is not read as twice the volume.
  const radius = (w: number) => 6 + Math.sqrt(w / wMax) * 16;

  return (
    <svg className="anchartsvg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      <line x1={L} y1={py(0)} x2={R} y2={py(0)} stroke="#d8d8dc" strokeWidth={1} />
      <line x1={px(0)} y1={TOP} x2={px(0)} y2={BOT} stroke="#d8d8dc" strokeWidth={1} />
      {chart.points.map((p) => {
        const cx = px(p.x);
        const cy = py(p.y);
        const r = radius(p.w);
        const grew = p.x >= 0;
        return (
          <g key={p.label}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={grew ? INK : "#8e8e93"}
              opacity={grew ? 0.12 : 0.14}
            />
            <circle cx={cx} cy={cy} r={3.4} fill={grew ? INK : "#8e8e93"} />
            <text
              className="anscatterlbl"
              x={cx}
              y={cy - r - 7}
              textAnchor="middle"
              fill={grew ? INK : "#48484a"}
            >
              {p.label}
            </text>
          </g>
        );
      })}
      {/* Its own class: this view box is 520 wide against the line chart's 640,
          so the same px size would render noticeably larger here. */}
      <g className="anchartaxis anscatteraxis">
        <text x={L - 8} y={py(y1) + 10} textAnchor="end">
          {Math.round(y1)}%
        </text>
        <text x={L - 8} y={py(0) + 3} textAnchor="end">
          0%
        </text>
        <text x={L - 8} y={py(y0) - 4} textAnchor="end">
          {Math.round(y0)}%
        </text>
        <text x={(L + R) / 2} y={H - 6} textAnchor="middle" letterSpacing=".1em">
          {chart.xLabel}
        </text>
        <text x={R} y={py(0) - 8} textAnchor="end" fill="#aeaeb2">
          {chart.yLabel} ↑
        </text>
      </g>
    </svg>
  );
}

/** 1d — the same series per area, as sparkline panels. */
function Multiples({ chart }: { chart: AnalystChartMultiples }) {
  return (
    <div className="anmultiples">
      {chart.panels.map((p) => {
        const lo = Math.min(...p.points);
        const hi = Math.max(...p.points);
        const y = (v: number) => 58 - ((v - lo) / (hi - lo || 1)) * 50;
        const x = (i: number) => (i / Math.max(1, p.points.length - 1)) * 196 + 2;
        return (
          <div key={p.name} className="anmultiple">
            <div className="anmultihd">
              <span className="anmultiname">{p.name}</span>
              <span className={`anmultidelta${p.down ? " down" : ""}`}>{p.delta}</span>
            </div>
            <svg viewBox="0 0 200 66" width="100%" role="img" aria-label={p.name}>
              <line x1={0} y1={60} x2={200} y2={60} stroke="#f4f4f5" strokeWidth={1} />
              <polyline
                points={p.points.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={INK}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="anmultinote">{p.note}</span>
          </div>
        );
      })}
    </div>
  );
}

export function AnalystChartView({ chart }: { chart: Chart }) {
  return (
    <div className="anchart">
      {chart.kind === "line" && (
        <>
          <div className="anchartkey">
            {chart.series.map((s) => (
              <span key={s.label} className="anchartkeyitem">
                <span className={`anchartswatch${s.tone === "muted" ? " muted" : ""}`} />
                {s.label}
              </span>
            ))}
          </div>
          <LineChart chart={chart} />
          <span className="anchartnote">{chart.note}</span>
        </>
      )}
      {chart.kind === "scatter" && <ScatterChart chart={chart} />}
      {chart.kind === "multiples" && <Multiples chart={chart} />}
    </div>
  );
}
