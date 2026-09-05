import { useState } from "react";
import { exportChart, type ExportFormat } from "../../lib/chartExport";
import { TREND_DOWN, TREND_UP } from "../../lib/companyCard";
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

/**
 * 1a — two indexed series over time, drawn in the company card's chart
 * language.
 *
 * The card is the reference for this and the shapes are now the same: a mono
 * eyebrow, the level large with its change in a pill beside it, a gradient
 * fill saturated at the curve and washing out to the floor, the direction
 * carried by the stroke colour, and a ringed marker on the latest reading.
 * A reader moving between a company card and an answer should not have to
 * re-learn what a green area under a line means.
 *
 * TWO THINGS THE CARD DOES NOT HAVE SURVIVE HERE. The dashed grey reference
 * stays — it is the comparison the chart exists to make, and dropping it to
 * match a single-series card would leave the subject rising against nothing.
 * And the y-axis stays gone rather than becoming the card's: these series are
 * REBASED, so the level is an index, not a count, and the eyebrow says which
 * month it is indexed to. Without that line the same "138" would read as 138
 * vacancies.
 */
function LineChart({ chart }: { chart: AnalystChartLine }) {
  const W = 640;
  const H = 214;
  const L = 4;
  const R = 636;
  const TOP = 16;
  const BOT = 170;

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
  const path = (pts: number[]) =>
    pts.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const subject = chart.series.find((s) => s.tone === "ink") ?? chart.series[0];
  const latest = subject.points[subject.points.length - 1];
  // A rebased series opens at 100, so its change since the base month IS its
  // level minus 100. Stated rather than recomputed, so the pill and the line
  // cannot disagree.
  const change = latest - 100;
  const up = change >= 0;
  const tone = up ? TREND_UP : TREND_DOWN;

  // Six ticks at most, always including both ends. The last stepped tick is
  // dropped when the end tick would land on top of it — 38 months steps by 7,
  // which puts a tick at 35 and the end at 37, and the two labels overprinted.
  const step = Math.max(1, Math.floor((n - 1) / 5));
  const ticks: number[] = [];
  for (let i = 0; i < n; i += step) ticks.push(i);
  if (ticks[ticks.length - 1] !== n - 1) {
    if (n - 1 - ticks[ticks.length - 1] < step * 0.6) ticks.pop();
    ticks.push(n - 1);
  }

  return (
    <div className="anchartcard">
      <div className="ccreadout">
        {/* The series is already named in the key above; the eyebrow carries
            what the level MEANS, which is the thing a bare "144" does not. */}
        <span className="cceyebrow">{chart.note}</span>
        <span className="ccreadv">
          {latest.toFixed(0)}
          <span className={`ccdelta ${up ? "up" : "down"}`}>
            {up ? "▲" : "▼"} {up ? "+" : "−"}
            {Math.abs(change).toFixed(1)}%
          </span>
        </span>
      </div>
      <svg className="anchartsvg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        <defs>
          <linearGradient id="an-fade" x1="0" y1="0" x2="0" y2="1">
            {/* The card leads with the fill, not the stroke: saturated at the
                curve and washing out to nothing at the floor. */}
            <stop offset="0" stopColor={tone} stopOpacity=".42" />
            <stop offset=".5" stopColor={tone} stopOpacity=".14" />
            <stop offset="1" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${path(subject.points)} L ${R} ${BOT} L ${L} ${BOT} Z`}
          fill="url(#an-fade)"
          stroke="none"
        />
        {chart.series.map((s) =>
          s.tone === "ink" ? null : (
            <path
              key={s.label}
              d={path(s.points)}
              fill="none"
              stroke={MUTED}
              strokeWidth={1.8}
              strokeDasharray="5 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ),
        )}
        <path
          d={path(subject.points)}
          fill="none"
          stroke={tone}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Round because this SVG keeps its aspect ratio — unlike the card's,
            which stretches and has to place its markers as HTML. */}
        <circle cx={x(n - 1)} cy={y(latest)} r={7} fill={tone} stroke="#fff" strokeWidth={3} />
        <g className="anchartaxis">
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={BOT + 26} textAnchor="middle">
              {monthTick(chart.months[i])}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}

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

const FORMATS: { key: ExportFormat; label: string }[] = [
  { key: "png", label: "PNG" },
  { key: "jpeg", label: "JPEG" },
  { key: "pdf", label: "PDF" },
];

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" aria-hidden>
      <g strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4v10" />
        <polyline points="8 11 12 15 16 11" />
        <path d="M5 18h14" />
      </g>
    </svg>
  );
}

/**
 * Export the chart as a standalone sheet.
 *
 * Not a screenshot: lib/chartExport.ts redraws from the chart DATA, so the
 * export carries the employsi mark, the question it answers, the source line
 * and the 2026 disclaimer at a fixed size regardless of the window it was
 * taken from. A chart leaving the product without its provenance is the same
 * fault as a figure without a source.
 */
function ExportMenu({ chart, title, source }: { chart: Chart; title: string; source?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const run = async (fmt: ExportFormat) => {
    setBusy(fmt);
    try {
      await exportChart(chart, title, source, fmt);
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  return (
    <div className="anexport">
      <button
        type="button"
        className={`anexportbtn${open ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Export this chart"
      >
        <DownloadIcon />
        Export
      </button>
      {open && (
        <>
          <span className="anexportscrim" onClick={() => setOpen(false)} />
          <div className="anexportmenu" role="menu">
            {FORMATS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="menuitem"
                className="anexportitem"
                disabled={!!busy}
                onClick={() => void run(f.key)}
              >
                {busy === f.key ? "Saving…" : f.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AnalystChartView({
  chart,
  title,
  source,
}: {
  chart: Chart;
  /** The answer's own sentence — becomes the export's subtitle. */
  title: string;
  source?: string;
}) {
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
        </>
      )}
      {chart.kind === "scatter" && <ScatterChart chart={chart} />}
      {chart.kind === "multiples" && <Multiples chart={chart} />}
      <ExportMenu chart={chart} title={title} source={source} />
    </div>
  );
}
