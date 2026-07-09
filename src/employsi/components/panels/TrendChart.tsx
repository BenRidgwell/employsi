import { useMemo, useState } from 'react';

// Dual-line workforce chart. Headcount is always plotted (fixed); the user
// selects a second line — revenue or EBITDA per employee — shown on its own
// scale against headcount. Hovering scrubs a callout reading both series.

type MetricId = 'revenue' | 'ebitda';

const METRICS: { id: MetricId; label: string; short: string }[] = [
  { id: 'revenue', label: 'Revenue / emp', short: 'Revenue/emp' },
  { id: 'ebitda', label: 'EBITDA / emp', short: 'EBITDA/emp' },
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

function headSeries(p: Props): number[] {
  return p.trend.map((t) => Math.round((p.headcount * t) / 100));
}

function financialSeries(metric: MetricId, p: Props): number[] {
  const n = p.trend.length;
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
const PADT = 18;
const PADB = 12;
const PLOTW = W - PADX * 2;
const PLOTH = H - PADT - PADB;

function scaler(vals: number[]) {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.2;
  const yMin = lo - pad;
  const yMax = hi + pad;
  return (v: number) => PADT + PLOTH * (1 - (v - yMin) / (yMax - yMin));
}

export function TrendChart(props: Props) {
  const [metric, setMetric] = useState<MetricId>('revenue');
  const labels = useMemo(() => quarterLabels(props.trend.length), [props.trend.length]);
  const head = useMemo(() => headSeries(props), [props]);
  const fin = useMemo(() => financialSeries(metric, props), [metric, props]);
  const n = head.length;
  const [sel, setSel] = useState<number | null>(null);

  const x = (i: number) => PADX + (i * PLOTW) / (n - 1);
  const yH = scaler(head);
  const yF = scaler(fin);
  const headLine = smoothPath(head.map((v, i) => [x(i), yH(v)]));
  const finLine = smoothPath(fin.map((v, i) => [x(i), yF(v)]));
  const headArea = headLine + ` L ${x(n - 1).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} L ${x(0).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} Z`;

  const active = sel == null ? n - 1 : sel;
  const leftPct = (x(active) / W) * 100;
  const headTopPct = (yH(head[active]) / H) * 100;
  const finTopPct = (yF(fin[active]) / H) * 100;
  const tipTopPct = (Math.min(yH(head[active]), yF(fin[active])) / H) * 100;
  const metricShort = METRICS.find((m) => m.id === metric)!.short;

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

      <div className="wtlegend">
        <span className="wtlgi">
          <i className="wtsw ink" />Headcount
        </span>
        <span className="wtlgi">
          <i className="wtsw acc" />
          {metricShort}
        </span>
      </div>

      <div className="wtbox" onMouseMove={onMove} onMouseLeave={() => setSel(null)}>
        <svg className="wtsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} className="wtgrid" x1={PADX} x2={W - PADX} y1={PADT + PLOTH * f} y2={PADT + PLOTH * f} />
          ))}
          <path className="wtarea" d={headArea} />
          <path className="wtline2" d={finLine} vectorEffect="non-scaling-stroke" />
          <path className="wtline" d={headLine} vectorEffect="non-scaling-stroke" />
          <line className="wtguide" x1={x(active)} x2={x(active)} y1={PADT} y2={PADT + PLOTH} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="wtdot acc" style={{ left: `${leftPct}%`, top: `${finTopPct}%` }} />
        <div className="wtdot ink" style={{ left: `${leftPct}%`, top: `${headTopPct}%` }} />
        <div className="wttip" style={{ left: `${leftPct}%`, top: `${tipTopPct}%` }}>
          <div className="wttiplabel">{labels[active]}</div>
          <div className="wttiprow">
            <i className="wtsw ink" />
            <b>{Math.round(head[active]).toLocaleString('en-US')}</b>
            <span>Headcount</span>
          </div>
          <div className="wttiprow">
            <i className="wtsw acc" />
            <b>${fin[active].toFixed(2)}M</b>
            <span>{metricShort}</span>
          </div>
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
