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

export function shareTrend(ticker: string, headcountTrend: number[]): number[] {
  if (ticker === 'BHP') {
    const n = headcountTrend.length;
    return n === BHP_SHARE_PRICE_AUD.length ? BHP_SHARE_PRICE_AUD.slice() : BHP_SHARE_PRICE_AUD.slice(-n);
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

export function commodityBaskets(n: number): Record<CommodityBasket, number[]> {
  const base: number[] = [];
  const precious: number[] = [];
  const oilLng: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / Math.max(1, n - 1);
    base.push(+(100 * (1 + 0.14 * Math.sin(f * 5.2 + 0.4) + 0.06 * f)).toFixed(1));
    precious.push(+(100 * (1 + 0.10 * Math.sin(f * 3.1 + 1.8) + 0.12 * f)).toFixed(1));
    oilLng.push(+(100 * (1 + 0.18 * Math.sin(f * 6.4 + 3.0) + 0.02 * f)).toFixed(1));
  }
  return { base, precious, oilLng };
}
