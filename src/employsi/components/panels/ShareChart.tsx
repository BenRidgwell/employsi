import { useMemo, useState } from 'react';
import { quarterLabels, smoothPath, scaler, signed, pctStr } from '../../lib/chart';

// Share-price chart for the "Financial trends" section — same visual language
// as the workforce TrendChart (smooth line, area fill, scrub tooltip) but a
// single series, since share price has no second metric to compare against.

interface Props {
  ticker: string;
  prices: number[];
}

const W = 340;
const H = 130;
const PADX = 10;
const PADT = 14;
const PADB = 12;
const PLOTW = W - PADX * 2;
const PLOTH = H - PADT - PADB;

const money = (v: number) => '$' + v.toFixed(2);

export function ShareChart({ ticker, prices }: Props) {
  const labels = useMemo(() => quarterLabels(prices.length), [prices.length]);
  const n = prices.length;
  const [hoverI, setHoverI] = useState<number | null>(null);

  const x = (i: number) => PADX + (i * PLOTW) / (n - 1);
  const y = scaler(prices, PADT, PLOTH);
  const line = smoothPath(prices.map((v, i) => [x(i), y(v)]));
  const area = line + ` L ${x(n - 1).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} L ${x(0).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} Z`;

  const idxAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round((rel - PADX) / (PLOTW / (n - 1)))));
  };

  const active = hoverI == null ? n - 1 : hoverI;
  const first = prices[0];
  const last = prices[n - 1];
  const delta = last - first;
  const pct = first ? (delta / first) * 100 : 0;
  const up = delta >= 0;

  return (
    <>
      <div className="secth">
        Financial trends
        <span className={`shdelta ${up ? 'up' : 'down'}`}>
          {signed(delta, money)} ({pctStr(pct)})
        </span>
      </div>
      <div className="wtlegend">
        <span className="wtlgi">
          <i className="wtsw ink" />
          {ticker} share price
        </span>
        <span className="wthint">Illustrative price · hover to scrub</span>
      </div>
      <div
        className="wtbox"
        onMouseMove={(e) => setHoverI(idxAt(e))}
        onMouseLeave={() => setHoverI(null)}
      >
        <svg className="wtsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Reuses the #wtAreaFade gradient defined by the workforce TrendChart
              rendered alongside it in the same panel. */}
          <path className="wtarea" d={area} />
          <path className="wtline" d={line} vectorEffect="non-scaling-stroke" />
          {hoverI != null && (
            <line className="wtguide" x1={x(active)} x2={x(active)} y1={PADT} y2={PADT + PLOTH} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hoverI != null && (
          <>
            <div className="wtdot ink" style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(prices[active]) / H) * 100}%` }} />
            <div className="wttip" style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(prices[active]) / H) * 100}%` }}>
              <div className="wttiplabel">{labels[active]}</div>
              <div className="wttiprow">
                <i className="wtsw ink" />
                <b>{money(prices[active])}</b>
                <span>{ticker}</span>
              </div>
            </div>
          </>
        )}
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
