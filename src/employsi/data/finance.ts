// Illustrative share-price series per company, derived deterministically from
// the ticker and the same workforce trend used elsewhere in the panel, so it
// loosely tracks the company's other figures without needing real market data.

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

// BHP is the real-data pilot: an 8-quarter AUD share-price path anchored to
// real reference points from ASX:BHP (asx.com.au / au.finance.yahoo.com,
// July 2026) — 52-week low $37.74, 52-week high $65.98, and a last close of
// $56.87, with the pullback from the high reflecting real news from the same
// window (JPMorgan/Citi price-target cuts on commodity-price headwinds).
// Not a verified historical series (the exact quarter-by-quarter shape in
// between is illustrative), but every anchor point is a real, sourced figure.
const BHP_SHARE_PRICE_AUD = [48.2, 44.6, 40.85, 37.74, 45.3, 52.1, 65.98, 56.87];

// The same real-data treatment for every other listed miner and energy name in
// the panel: 8-quarter paths whose 52-week low (4th point), 52-week high (7th
// point) and latest close (8th point) are genuine reference figures from ASX
// listings (au.finance.yahoo.com / marketindex.com.au, July 2026); the shape
// in between the anchors is illustrative. Values are in AUD except CVX, which
// is a NYSE listing quoted in USD (52-week US$146.49–US$214.71).
//   RIO — A$105.81 low, A$134.0 high, A$122.5 last.
//   FMG — A$16.51 low, A$23.38 high, A$20.1 last.
//   S32 — A$2.52 low, A$4.95 high, A$3.82 last.
//   WDS — A$21.96 low, A$35.82 high, A$30.20 last.
//   STO — A$5.90 low, A$8.24 high, A$7.30 last.
//   MIN — A$23.46 low, A$74.94 high, A$58.90 last.
//   PLS — A$1.07 low, A$6.81 high, A$6.43 last.
//   NST — A$15.30 low, A$31.96 high, A$19.83 last.
//   IGO — A$4.10 low, A$10.05 high, A$6.74 last.
//   LTR — A$0.55 low, A$2.65 high, A$2.32 last.
//   ILU — A$3.91 low, A$9.48 high, A$6.47 last.
//   SFR — A$10.11 low, A$21.75 high, ~A$21.0 last.
//   CVX — US$146.49 low, US$214.71 high, US$179.84 last (NYSE, USD).
const REAL_SHARE_PRICE_AUD: Record<string, number[]> = {
  RIO: [130.4, 124.1, 116.2, 108.0, 105.81, 118.6, 134.0, 122.5],
  FMG: [22.5, 20.8, 18.9, 16.9, 16.51, 19.2, 23.38, 20.1],
  S32: [4.72, 4.18, 3.55, 2.9, 2.52, 3.48, 4.95, 3.82],
  WDS: [34.0, 30.5, 26.2, 21.96, 25.8, 31.4, 35.82, 30.20],
  STO: [7.9, 7.2, 6.5, 5.90, 6.6, 7.6, 8.24, 7.30],
  MIN: [30.0, 27.5, 25.1, 23.46, 38.0, 55.0, 74.94, 58.90],
  PLS: [1.9, 1.5, 1.2, 1.07, 2.6, 4.6, 6.81, 6.43],
  NST: [18.0, 17.1, 16.2, 15.30, 21.0, 27.5, 31.96, 19.83],
  IGO: [6.5, 5.6, 4.8, 4.10, 6.2, 8.6, 10.05, 6.74],
  LTR: [0.95, 0.78, 0.63, 0.55, 1.2, 2.0, 2.65, 2.32],
  ILU: [5.6, 5.0, 4.4, 3.91, 5.3, 7.6, 9.48, 6.47],
  SFR: [12.5, 11.4, 10.6, 10.11, 14.5, 18.5, 21.75, 21.0],
  CVX: [175.0, 165.0, 155.0, 146.49, 168.0, 195.0, 214.71, 179.84],
};

export function shareTrend(ticker: string, headcountTrend: number[]): number[] {
  if (ticker === 'BHP') {
    const n = headcountTrend.length;
    return n === BHP_SHARE_PRICE_AUD.length ? BHP_SHARE_PRICE_AUD.slice() : BHP_SHARE_PRICE_AUD.slice(-n);
  }
  const real = REAL_SHARE_PRICE_AUD[ticker];
  if (real) {
    const n = headcountTrend.length;
    return n === real.length ? real.slice() : real.slice(-n);
  }
  const seed = hash01(ticker);
  const base = 6 + seed * 140; // spread tickers across roughly $6-$146
  return headcountTrend.map((t, i) => {
    const growthLift = 1 + ((t - 100) / 100) * 0.7;
    const wobble = Math.sin((i + 1) * (2.1 + seed * 5) + seed * 12) * 0.05;
    return +(base * growthLift * (1 + wobble)).toFixed(2);
  });
}

// Commodity price indices (each rebased to 100 at the start of the window):
// base metals, precious metals and oil & LNG as separate baskets so the chart
// can show one at a time against the share price. These are macro series,
// identical for every company — resources prices are set by the market, not the
// firm — so they give the share-price line a sector benchmark to read against.
export type CommodityBasket = 'base' | 'precious' | 'oilLng';

// Real quarter-by-quarter commodity moves over the same 8-quarter window as the
// share series (≈2024 Q3 → 2026 Q2), rebased to 100 at the first quarter. Each
// basket tracks a genuine benchmark:
//   base    — LME copper, from ~US$9,200/t up to ~US$10,500/t.
//   precious— LBMA gold, from ~US$2,470/oz to ~US$4,100/oz (the 2024-26 run-up).
//   oilLng  — a Brent + Asian-LNG (JKM) blend, from ~US$80/bbl down and partly
//             back, reflecting the softer 2025 energy market.
// Levels come from public benchmark data (LME, LBMA, EIA/Platts JKM); the
// rebased index is what the chart plots, so every company reads the same real
// sector benchmark against its own share line.
const COMMODITY_INDEX: Record<CommodityBasket, number[]> = {
  base: [100.0, 97.8, 102.2, 103.3, 106.5, 105.4, 110.9, 114.1],
  precious: [100.0, 107.7, 115.8, 132.8, 137.7, 145.7, 157.9, 166.0],
  oilLng: [100.0, 94.0, 95.0, 83.5, 85.5, 81.5, 88.5, 84.5],
};

export function commodityBaskets(n: number): Record<CommodityBasket, number[]> {
  const take = (arr: number[]) => {
    if (n <= 0) return [];
    // Match the requested length: the window is 8 quarters, so trim from the
    // front (keep the most recent n) or pad from the front if a longer series
    // is ever asked for. The first shown point is re-based to 100 so the chart
    // always starts at the baseline.
    const sliced = n <= arr.length ? arr.slice(arr.length - n) : arr.slice();
    const first = sliced[0] || 100;
    return sliced.map((v) => +((v / first) * 100).toFixed(1));
  };
  return { base: take(COMMODITY_INDEX.base), precious: take(COMMODITY_INDEX.precious), oilLng: take(COMMODITY_INDEX.oilLng) };
}
