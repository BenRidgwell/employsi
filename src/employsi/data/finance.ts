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

export function shareTrend(ticker: string, headcountTrend: number[]): number[] {
  const seed = hash01(ticker);
  const base = 6 + seed * 140; // spread tickers across roughly $6-$146
  return headcountTrend.map((t, i) => {
    const growthLift = 1 + ((t - 100) / 100) * 0.7;
    const wobble = Math.sin((i + 1) * (2.1 + seed * 5) + seed * 12) * 0.05;
    return +(base * growthLift * (1 + wobble)).toFixed(2);
  });
}

// Aggregated commodity price index (rebased to 100 at the start of the window):
// the blended movement of base metals, precious metals and oil & LNG. This is a
// macro series, identical for every company — resources prices are set by the
// market, not the firm — so it gives the share-price line a sector benchmark to
// read against.
export function commodityIndex(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / Math.max(1, n - 1);
    // Three sub-baskets with different cycles, then averaged.
    const baseMetals = 100 * (1 + 0.14 * Math.sin(f * 5.2 + 0.4) + 0.06 * f);
    const preciousMetals = 100 * (1 + 0.10 * Math.sin(f * 3.1 + 1.8) + 0.12 * f);
    const oilLng = 100 * (1 + 0.18 * Math.sin(f * 6.4 + 3.0) + 0.02 * f);
    out.push(+((baseMetals + preciousMetals + oilLng) / 3).toFixed(1));
  }
  return out;
}
