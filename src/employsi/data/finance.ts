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
