import { useState } from "react";
import { exportChart, type ExportFormat } from "../../lib/chartExport";
import type {
  AnalystChart as Chart,
  AnalystChartBars,
  AnalystChartLine,
  AnalystChartMultiples,
  AnalystChartScatter,
  BarDatum,
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

/**
 * The D1 answers' bar chart, set as a Bain exhibit — see AnalystChartBars.
 *
 * HTML rather than SVG: the pane is narrow and its width varies, and a row's
 * label has to wrap or truncate as text does, which an SVG with a fixed view
 * box cannot. Bars are proportional FROM ZERO in both orientations, so a bar
 * twice as long is twice the value; a reference line shares the same scale.
 * Every bar carries its value, which is the exhibit's convention and also
 * what makes the grey (under 3:1 against the card) safe to use for marks.
 */
function barTip(b: BarDatum): string {
  return `${b.label}: ${b.display}${b.note ? ` (${b.note})` : ""}`;
}

function BarsChart({ chart }: { chart: AnalystChartBars }) {
  const max = Math.max(1, ...chart.bars.map((b) => b.value), chart.reference?.value ?? 0);
  // Rows print the value just past the bar's end, so the scale runs over the
  // track less a gutter the widest label fits in; the reference uses the
  // same, or it would sit on a different axis from the bars it is read with.
  const along = (v: number) => `calc(${Math.max(0, v / max).toFixed(4)} * (100% - 54px))`;

  return (
    <figure className={`anbain ${chart.orient}`}>
      <figcaption className="anbainhd">
        <span className="anbaintitle">{chart.title}</span>
        <span className="anbainmeasure">{chart.measure}</span>
      </figcaption>

      {chart.orient === "column" ? (
        <div className="anbaincols" aria-hidden>
          {chart.change && chart.bars.length >= 2 && (
            // Bain's bracket: spans the first column's centre to the last's,
            // riding above the taller of the two, with the change on it.
            <div
              className="anbainbracket"
              style={{
                left: `${50 / chart.bars.length}%`,
                right: `${50 / chart.bars.length}%`,
              }}
            >
              <span className={`anbainchange${chart.change.down ? " down" : ""}`}>
                {chart.change.text}
              </span>
            </div>
          )}
          {chart.bars.map((b) => (
            <div key={b.label} className="anbaincol" title={barTip(b)}>
              <div className="anbaincolplot">
                <span className="anbainval">{b.display}</span>
                <span
                  className={`anbaincolbar${b.emphasis ? " em" : ""}`}
                  // Over the plot less the value label above it, so the
                  // tallest column's figure stays inside the plot.
                  style={{
                    height: `calc(${Math.max(0, b.value / max).toFixed(4)} * (100% - 22px))`,
                  }}
                />
              </div>
              <span className="anbaincollbl">{b.label}</span>
              {b.note && <span className={`anbainnote${b.down ? " down" : ""}`}>{b.note}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="anbainrows" aria-hidden>
          {chart.bars.map((b) => (
            // The row is display:contents (one shared grid), so it has no box
            // to hover: the tooltip rides on the label and the track instead.
            <div key={b.label} className="anbainrow">
              <span className="anbainrowlbl" title={barTip(b)}>
                {b.label}
              </span>
              <span className="anbaintrack" title={barTip(b)}>
                <span
                  className={`anbainrowbar${b.emphasis ? " em" : ""}`}
                  style={{ width: along(b.value) }}
                />
                <span className="anbainval">{b.display}</span>
                {/* The reference is drawn inside every track rather than as
                    one overlay, so it shares the bars' x-scale exactly
                    whatever width the label column takes. */}
                {chart.reference && (
                  <span className="anbainrefseg" style={{ left: along(chart.reference.value) }} />
                )}
              </span>
              <span className={`anbainnote${b.down ? " down" : ""}`}>{b.note ?? ""}</span>
            </div>
          ))}
          {chart.reference && (
            <div className="anbainrow anbainreflbl">
              <span />
              <span className="anbaintrack">
                <span
                  className="anbainrefseg tail"
                  style={{ left: along(chart.reference.value) }}
                />
                <span
                  className="anbainreftext"
                  style={{
                    left: along(chart.reference.value),
                    // Anchored right of the line in the left half, left of it
                    // in the right half, so the label never runs off the card.
                    transform: chart.reference.value / max > 0.55 ? "translateX(-100%)" : undefined,
                  }}
                >
                  {chart.reference.label}
                </span>
              </span>
              <span />
            </div>
          )}
        </div>
      )}

      {/* The same figures as a table, for a screen reader: the drawn bars are
          aria-hidden, and a chart whose numbers only exist as geometry is one
          a reader without sight cannot check. */}
      <table className="anbainsr">
        <caption>
          {chart.title}. {chart.measure}.
        </caption>
        <tbody>
          {chart.bars.map((b) => (
            <tr key={b.label}>
              <th scope="row">{b.label}</th>
              <td>{b.display}</td>
              {b.note !== undefined && <td>{b.note}</td>}
            </tr>
          ))}
          {chart.reference && (
            <tr>
              <th scope="row">Reference</th>
              <td>{chart.reference.label}</td>
            </tr>
          )}
          {chart.change && (
            <tr>
              <th scope="row">Change</th>
              <td>{chart.change.text}</td>
            </tr>
          )}
        </tbody>
      </table>
    </figure>
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
          <span className="anchartnote">{chart.note}</span>
        </>
      )}
      {chart.kind === "scatter" && <ScatterChart chart={chart} />}
      {chart.kind === "multiples" && <Multiples chart={chart} />}
      {chart.kind === "bars" && <BarsChart chart={chart} />}
      <ExportMenu chart={chart} title={title} source={source} />
    </div>
  );
}
