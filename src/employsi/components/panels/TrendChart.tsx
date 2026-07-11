import { useMemo, useRef, useState } from 'react';
import { quarterLabels, smoothPath, scaler, signed, pctStr } from '../../lib/chart';

// Dual-line workforce chart. Headcount is always plotted (fixed); the user
// selects a second line — revenue or EBITDA per employee — shown on its own
// scale against headcount. Hovering scrubs a callout reading both series;
// dragging across the chart selects a period and auto-calculates the change.

type MetricId = 'revenue' | 'ebitda';

const METRICS: { id: MetricId; label: string; short: string }[] = [
  { id: 'revenue', label: 'Revenue / emp', short: 'Revenue/emp' },
  { id: 'ebitda', label: 'EBITDA / emp', short: 'EBITDA/emp' },
];

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

const W = 340;
const H = 156;
const PADX = 10;
const PADT = 18;
const PADB = 12;
const PLOTW = W - PADX * 2;
const PLOTH = H - PADT - PADB;

const money = (v: number) => '$' + v.toFixed(2) + 'M';
const people = (v: number) => Math.round(v).toLocaleString('en-US');

export function TrendChart(props: Props) {
  const [metric, setMetric] = useState<MetricId>('revenue');
  const labels = useMemo(() => quarterLabels(props.trend.length), [props.trend.length]);
  const head = useMemo(() => headSeries(props), [props]);
  const fin = useMemo(() => financialSeries(metric, props), [metric, props]);
  const n = head.length;
  const [sel, setSel] = useState<number | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState(false);
  const dragStart = useRef<number | null>(null);

  const x = (i: number) => PADX + (i * PLOTW) / (n - 1);
  const yH = scaler(head, PADT, PLOTH);
  const yF = scaler(fin, PADT, PLOTH);
  const headLine = smoothPath(head.map((v, i) => [x(i), yH(v)]));
  const finLine = smoothPath(fin.map((v, i) => [x(i), yF(v)]));
  const headArea = headLine + ` L ${x(n - 1).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} L ${x(0).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} Z`;

  const metricShort = METRICS.find((m) => m.id === metric)!.short;
  const idxAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round((rel - PADX) / (PLOTW / (n - 1)))));
  };
  const onDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const i = idxAt(e);
    dragStart.current = i;
    setRange([i, i]);
    setSel(null);
  };
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const i = idxAt(e);
    setHover(true);
    if (dragStart.current != null) setRange([dragStart.current, i]);
    else if (!range) setSel(i);
  };
  const finishDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragStart.current == null) return;
    const s = dragStart.current;
    const i = idxAt(e);
    dragStart.current = null;
    if (i === s) {
      setRange(null);
      setSel(i);
    } else {
      setRange([Math.min(s, i), Math.max(s, i)]);
    }
  };
  const onLeave = () => {
    dragStart.current = null;
    setSel(null);
    setHover(false);
  };

  const hasRange = !!range && range[0] !== range[1];
  const a = range ? range[0] : 0;
  const b = range ? range[1] : 0;

  const active = sel == null ? n - 1 : sel;
  const scrubLeft = (x(active) / W) * 100;

  const headDelta = head[b] - head[a];
  const finDelta = fin[b] - fin[a];
  const headPct = head[a] ? (headDelta / head[a]) * 100 : 0;
  const finPct = fin[a] ? (finDelta / fin[a]) * 100 : 0;

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
        <span className="wthint">Drag across to compare a period</span>
      </div>

      <div className="wtbox" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={finishDrag} onMouseLeave={onLeave}>
        <svg className="wtsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="wtAreaFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(28,28,30,0.16)" />
              <stop offset="65%" stopColor="rgba(28,28,30,0.05)" />
              <stop offset="100%" stopColor="rgba(28,28,30,0)" />
            </linearGradient>
          </defs>
          {hasRange && <rect className="wtband" x={x(a)} y={PADT} width={x(b) - x(a)} height={PLOTH} />}
          <path className="wtarea" d={headArea} />
          <path className="wtline2" d={finLine} vectorEffect="non-scaling-stroke" />
          <path className="wtline" d={headLine} vectorEffect="non-scaling-stroke" />
          {hasRange ? (
            <>
              <line className="wtguide" x1={x(a)} x2={x(a)} y1={PADT} y2={PADT + PLOTH} vectorEffect="non-scaling-stroke" />
              <line className="wtguide" x1={x(b)} x2={x(b)} y1={PADT} y2={PADT + PLOTH} vectorEffect="non-scaling-stroke" />
            </>
          ) : hover ? (
            <line className="wtguide" x1={x(active)} x2={x(active)} y1={PADT} y2={PADT + PLOTH} vectorEffect="non-scaling-stroke" />
          ) : null}
        </svg>

        {hasRange ? (
          <>
            <div className="wtdot acc" style={{ left: `${(x(a) / W) * 100}%`, top: `${(yF(fin[a]) / H) * 100}%` }} />
            <div className="wtdot acc" style={{ left: `${(x(b) / W) * 100}%`, top: `${(yF(fin[b]) / H) * 100}%` }} />
            <div className="wtdot ink" style={{ left: `${(x(a) / W) * 100}%`, top: `${(yH(head[a]) / H) * 100}%` }} />
            <div className="wtdot ink" style={{ left: `${(x(b) / W) * 100}%`, top: `${(yH(head[b]) / H) * 100}%` }} />
          </>
        ) : hover ? (
          <>
            <div className="wtdot acc" style={{ left: `${scrubLeft}%`, top: `${(yF(fin[active]) / H) * 100}%` }} />
            <div className="wtdot ink" style={{ left: `${scrubLeft}%`, top: `${(yH(head[active]) / H) * 100}%` }} />
            <div className="wttip" style={{ left: `${scrubLeft}%`, top: `${(Math.min(yH(head[active]), yF(fin[active])) / H) * 100}%` }}>
              <div className="wttiplabel">{labels[active]}</div>
              <div className="wttiprow">
                <i className="wtsw ink" />
                <b>{people(head[active])}</b>
                <span>Headcount</span>
              </div>
              <div className="wttiprow">
                <i className="wtsw acc" />
                <b>{money(fin[active])}</b>
                <span>{metricShort}</span>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="wtaxis">
        {labels.map((l, i) => (
          <span key={l} className="wtaxislbl" style={{ left: `${(x(i) / W) * 100}%` }}>
            {l}
          </span>
        ))}
      </div>

      {hasRange && (
        <div className="wtrange">
          <div className="wtrangehd">
            <span className="wtrangeperiod">{labels[a]} → {labels[b]}</span>
            <button className="wtrangex" onClick={() => setRange(null)}>Clear</button>
          </div>
          <div className="wtrangerow">
            <span className="wtrlbl"><i className="wtsw ink" />Headcount</span>
            <span className={`wtrval ${headDelta >= 0 ? 'up' : 'down'}`}>{signed(headDelta, people)} ({pctStr(headPct)})</span>
          </div>
          <div className="wtrangerow">
            <span className="wtrlbl"><i className="wtsw acc" />{metricShort}</span>
            <span className={`wtrval ${finDelta >= 0 ? 'up' : 'down'}`}>{signed(finDelta, money)} ({pctStr(finPct)})</span>
          </div>
        </div>
      )}
    </>
  );
}
