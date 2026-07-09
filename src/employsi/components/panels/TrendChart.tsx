import { useMemo, useState } from 'react';

// Smooth workforce-trend chart. Plots headcount movement, or a financial
// productivity metric the user selects (revenue / EBITDA per employee), across
// the last eight financial quarters. Hovering scrubs a callout across points.

type MetricId = 'headcount' | 'revenue' | 'ebitda';

const METRICS: { id: MetricId; label: string }[] = [
  { id: 'headcount', label: 'Headcount' },
  { id: 'revenue', label: 'Revenue / emp' },
  { id: 'ebitda', label: 'EBITDA / emp' },
];

function quarterLabels(n: number): string[] {
  const now = new Date();
  let q = Math.floor(now.getMonth() / 3) + 1;
  let y = now.getFullYear();
  q -= 1;
  if (q < 1) {
    q = 4;
    y -= 1;
  }
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`Q${q} '${String(y).slice(2)}`);
    q -= 1;
    if (q < 1) {
      q = 4;
      y -= 1;
    }
  }
  return out;
}

interface Props {
  trend: number[];
  headcount: number;
  revPerEmp: number;
  ebitdaPerEmp: number;
}

function buildSeries(metric: MetricId, p: Props): number[] {
  const n = p.trend.length;
  if (metric === 'headcount') return p.trend.map((t) => Math.round((p.headcount * t) / 100));
  const base = metric === 'revenue' ? p.revPerEmp : p.ebitdaPerEmp;
  const start = metric === 'revenue' ? 0.84 : 0.74;
  const amp = metric === 'revenue' ? 0.03 : 0.05;
  const seed = metric === 'revenue' ? 1.7 : 2.9;
  return p.trend.map((_, i) => {
    const lin = start + (1 - start) * (i / (n - 1));
    const w = i === n - 1 ? 0 : amp * Math.sin((i + 1) * seed + p.headcount);
    return base * (lin + w);
  });
}

function fmtValue(metric: MetricId, v: number): string {
  if (metric === 'headcount') return Math.round(v).toLocaleString('en-US');
  return '$' + v.toFixed(2) + 'M';
}

// Catmull-Rom → cubic Bézier for a smooth curve through the points.
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

const W = 340;
const H = 156;
const PADX = 10;
const PADT = 16;
const PADB = 12;
const PLOTW = W - PADX * 2;
const PLOTH = H - PADT - PADB;

export function TrendChart(props: Props) {
  const [metric, setMetric] = useState<MetricId>('headcount');
  const labels = useMemo(() => quarterLabels(props.trend.length), [props.trend.length]);
  const values = useMemo(() => buildSeries(metric, props), [metric, props]);
  const n = values.length;
  const [sel, setSel] = useState<number | null>(null);

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pad = span * 0.18;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (i: number) => PADX + (i * PLOTW) / (n - 1);
  const y = (v: number) => PADT + PLOTH * (1 - (v - yMin) / (yMax - yMin));
  const pts: [number, number][] = values.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = line + ` L ${x(n - 1).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} L ${x(0).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} Z`;

  const active = sel == null ? n - 1 : sel;
  const leftPct = (x(active) / W) * 100;
  const topPct = (y(values[active]) / H) * 100;

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((rel - PADX) / (PLOTW / (n - 1)))));
    setSel(i);
  };

  return (
    <>
      <div className="secth">
        Workforce trend
        <div className="wtseg">
          {METRICS.map((m) => (
            <button key={m.id} className={`wtsegbtn ${metric === m.id ? 'on' : ''}`} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="wtbox" onMouseMove={onMove} onMouseLeave={() => setSel(null)}>
        <svg className="wtsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} className="wtgrid" x1={PADX} x2={W - PADX} y1={PADT + PLOTH * f} y2={PADT + PLOTH * f} />
          ))}
          <path className="wtarea" d={area} />
          <path className="wtline" d={line} vectorEffect="non-scaling-stroke" />
          <line className="wtguide" x1={x(active)} x2={x(active)} y1={PADT} y2={PADT + PLOTH} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="wtdot" style={{ left: `${leftPct}%`, top: `${topPct}%` }} />
        <div className="wttip" style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
          <div className="wttiplabel">{labels[active]}</div>
          <div className="wttipval">{fmtValue(metric, values[active])}</div>
        </div>
      </div>

      <div className="wtaxis">
        {labels.map((l, i) => (
          <span key={l} className="wtaxislbl" style={{ left: `${(x(i) / W) * 100}%` }}>
            {l}
          </span>
        ))}
      </div>
    </>
  );
}
