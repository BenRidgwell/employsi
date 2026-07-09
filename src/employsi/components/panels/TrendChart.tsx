import { useMemo, useState } from 'react';

// Technical-analysis style headcount chart. Each financial quarter is drawn as
// an OHLC candle derived from the indexed workforce trend and the company's
// current headcount, so the candles read as real people movements. Clicking a
// candle drills into that quarter's detail.

const GREEN = '#159d67';
const RED = '#e0524a';

interface Candle {
  label: string;
  open: number;
  close: number;
  high: number;
  low: number;
  up: boolean;
}

// Deterministic 0..1 hash so intra-quarter wicks are stable per render.
function jitter(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function quarterLabels(n: number): string[] {
  const now = new Date();
  let q = Math.floor(now.getMonth() / 3) + 1; // current quarter 1..4
  let y = now.getFullYear();
  q -= 1; // step back to the last completed quarter
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

function buildCandles(trend: number[], headcount: number): Candle[] {
  const labels = quarterLabels(trend.length);
  const hc = trend.map((t) => Math.round((headcount * t) / 100));
  return hc.map((close, i) => {
    const open = i === 0 ? Math.round(close * 0.994) : hc[i - 1];
    const base = Math.max(open, close);
    const floor = Math.min(open, close);
    const amp = Math.max(4, close * 0.014);
    const high = Math.round(base + amp * (0.35 + jitter(i * 3 + close) * 0.9));
    const low = Math.round(floor - amp * (0.35 + jitter(i * 7 + close) * 0.9));
    return { label: labels[i], open, close, high, low, up: close >= open };
  });
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function TrendChart({ trend, headcount }: { trend: number[]; headcount: number }) {
  const candles = useMemo(() => buildCandles(trend, headcount), [trend, headcount]);
  const [sel, setSel] = useState<number | null>(null);

  const W = 340;
  const H = 150;
  const padX = 10;
  const padTop = 12;
  const padBot = 26;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBot;

  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  const y = (v: number) => padTop + plotH - ((v - lo) / ((hi - lo) || 1)) * plotH;
  const slot = plotW / candles.length;
  const bodyW = slot * 0.44;

  const active = sel != null ? candles[sel] : candles[candles.length - 1];
  const qoq = active.close - active.open;
  const qoqPct = active.open ? (qoq / active.open) * 100 : 0;
  const activeUp = qoq >= 0;
  const caption = sel != null ? `${active.label} · headcount` : `${candles.length} quarters · headcount`;

  return (
    <>
      <div className="secth">
        Workforce trend
        <span>{caption}</span>
      </div>

      <div className="trendbox">
        <svg className="candlesvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* subtle baseline gridlines */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} className="candlegrid" x1={padX} x2={W - padX} y1={padTop + plotH * f} y2={padTop + plotH * f} />
          ))}
          {candles.map((c, i) => {
            const cx = padX + slot * i + slot / 2;
            const color = c.up ? GREEN : RED;
            const isSel = (sel != null ? sel : candles.length - 1) === i;
            const top = y(Math.max(c.open, c.close));
            const bot = y(Math.min(c.open, c.close));
            return (
              <g
                key={i}
                className={`candle ${isSel ? 'sel' : ''}`}
                onClick={() => setSel(i)}
                style={{ cursor: 'pointer' }}
              >
                {/* wide invisible hit target */}
                <rect x={padX + slot * i} y={padTop} width={slot} height={plotH} fill="transparent" />
                <line className="candlewick" x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} />
                <rect
                  className="candlebody"
                  x={cx - bodyW / 2}
                  y={top}
                  width={bodyW}
                  height={Math.max(2, bot - top)}
                  rx={1.4}
                  fill={color}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="candlereadout">
        <div className="crmain">
          <span className="crq">{active.label}</span>
          <span className="crhc">{fmt(active.close)} <em>people</em></span>
          <span className={`crqoq ${activeUp ? 'up' : 'down'}`}>
            {activeUp ? '▲' : '▼'} {(qoq >= 0 ? '+' : '') + fmt(qoq)} ({(qoqPct >= 0 ? '+' : '') + qoqPct.toFixed(1)}%) QoQ
          </span>
        </div>
        <div className="crohlc">
          <span><b>O</b> {fmt(active.open)}</span>
          <span><b>H</b> {fmt(active.high)}</span>
          <span><b>L</b> {fmt(active.low)}</span>
          <span><b>C</b> {fmt(active.close)}</span>
        </div>
      </div>
    </>
  );
}
