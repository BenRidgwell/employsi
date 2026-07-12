import { useMemo, useRef, useState } from 'react';
import { quarterLabels, smoothPath, scaler, signed, pctStr } from '../../lib/chart';
import type { CommodityBasket } from '../../data/finance';

// Dual-line "Financial trends" chart. The share price is always plotted (fixed);
// the second line is a commodity basket the user chooses — base metals,
// precious metals, or oil & LNG — so the price can be read against a sector
// benchmark. Mirrors the workforce TrendChart: hover scrubs a callout reading
// both series; dragging across the chart selects a period and calculates the
// change.

const BASKETS: { id: CommodityBasket; label: string; short: string }[] = [
  { id: 'base', label: 'Base', short: 'Base metals' },
  { id: 'precious', label: 'Precious', short: 'Precious metals' },
  { id: 'oilLng', label: 'Oil & LNG', short: 'Oil & LNG' },
];

interface Props {
  ticker: string;
  prices: number[];
  commodities: Record<CommodityBasket, number[]>;
}

const W = 340;
const H = 156;
const PADX = 10;
const PADT = 18;
const PADB = 12;
const PLOTW = W - PADX * 2;
const PLOTH = H - PADT - PADB;

const money = (v: number) => '$' + v.toFixed(2);
const idx = (v: number) => v.toFixed(1);

export function ShareChart({ ticker, prices, commodities }: Props) {
  const labels = useMemo(() => quarterLabels(prices.length), [prices.length]);
  const n = prices.length;
  const [basket, setBasket] = useState<CommodityBasket>('base');
  const [sel, setSel] = useState<number | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState(false);
  const dragStart = useRef<number | null>(null);

  const commodity = commodities[basket];
  const basketShort = BASKETS.find((x) => x.id === basket)!.short;

  const x = (i: number) => PADX + (i * PLOTW) / (n - 1);
  const yP = scaler(prices, PADT, PLOTH);
  const yC = scaler(commodity, PADT, PLOTH);
  const priceLine = smoothPath(prices.map((v, i) => [x(i), yP(v)]));
  const commLine = smoothPath(commodity.map((v, i) => [x(i), yC(v)]));
  const priceArea = priceLine + ` L ${x(n - 1).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} L ${x(0).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} Z`;

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

  const priceDelta = prices[b] - prices[a];
  const commDelta = commodity[b] - commodity[a];
  const pricePct = prices[a] ? (priceDelta / prices[a]) * 100 : 0;
  const commPct = commodity[a] ? (commDelta / commodity[a]) * 100 : 0;

  // Header badge shows the full-window share-price change.
  const winDelta = prices[n - 1] - prices[0];
  const winPct = prices[0] ? (winDelta / prices[0]) * 100 : 0;

  return (
    <>
      <div className="secth">
        Financial trends
        <div className="wtseg">
          {BASKETS.map((m) => (
            <button key={m.id} className={`wtsegbtn ${basket === m.id ? 'on' : ''}`} onClick={() => setBasket(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="wtlegend">
        <span className="wtlgi">
          <i className="wtsw ink" />
          {ticker} share price
          <b className={`wtlgd ${winDelta >= 0 ? 'up' : 'down'}`}>{pctStr(winPct)}</b>
        </span>
        <span className="wtlgi">
          <i className="wtsw acc" />
          {basketShort}
        </span>
      </div>

      <div className="wtbox" onMouseDown={onDown} onMouseMove={onMove} onMouseUp={finishDrag} onMouseLeave={onLeave}>
        <svg className="wtsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Reuses the #wtAreaFade gradient defined by the workforce TrendChart
              rendered above it in the same panel. */}
          {hasRange && <rect className="wtband" x={x(a)} y={PADT} width={x(b) - x(a)} height={PLOTH} />}
          <path className="wtarea" d={priceArea} />
          <path className="wtline2" d={commLine} vectorEffect="non-scaling-stroke" />
          <path className="wtline" d={priceLine} vectorEffect="non-scaling-stroke" />
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
            <div className="wtdot acc" style={{ left: `${(x(a) / W) * 100}%`, top: `${(yC(commodity[a]) / H) * 100}%` }} />
            <div className="wtdot acc" style={{ left: `${(x(b) / W) * 100}%`, top: `${(yC(commodity[b]) / H) * 100}%` }} />
            <div className="wtdot ink" style={{ left: `${(x(a) / W) * 100}%`, top: `${(yP(prices[a]) / H) * 100}%` }} />
            <div className="wtdot ink" style={{ left: `${(x(b) / W) * 100}%`, top: `${(yP(prices[b]) / H) * 100}%` }} />
          </>
        ) : hover ? (
          <>
            <div className="wtdot acc" style={{ left: `${scrubLeft}%`, top: `${(yC(commodity[active]) / H) * 100}%` }} />
            <div className="wtdot ink" style={{ left: `${scrubLeft}%`, top: `${(yP(prices[active]) / H) * 100}%` }} />
            <div className="wttip" style={{ left: `${scrubLeft}%`, top: `${(Math.min(yP(prices[active]), yC(commodity[active])) / H) * 100}%` }}>
              <div className="wttiplabel">{labels[active]}</div>
              <div className="wttiprow">
                <i className="wtsw ink" />
                <b>{money(prices[active])}</b>
                <span>{ticker}</span>
              </div>
              <div className="wttiprow">
                <i className="wtsw acc" />
                <b>{idx(commodity[active])}</b>
                <span>{basketShort}</span>
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
            <span className="wtrlbl"><i className="wtsw ink" />{ticker} share price</span>
            <span className={`wtrval ${priceDelta >= 0 ? 'up' : 'down'}`}>{signed(priceDelta, money)} ({pctStr(pricePct)})</span>
          </div>
          <div className="wtrangerow">
            <span className="wtrlbl"><i className="wtsw acc" />{basketShort}</span>
            <span className={`wtrval ${commDelta >= 0 ? 'up' : 'down'}`}>{signed(commDelta, idx)} ({pctStr(commPct)})</span>
          </div>
        </div>
      )}
    </>
  );
}
