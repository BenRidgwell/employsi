// Shared SVG line-chart math used by TrendChart and ShareChart, so every
// company chart in the panel shares the same visual language.

export function quarterLabels(n: number): string[] {
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

export function smoothPath(pts: [number, number][]): string {
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

export function scaler(vals: number[], plotTop: number, plotH: number) {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo || 1) * 0.2;
  const yMin = lo - pad;
  const yMax = hi + pad;
  return (v: number) => plotTop + plotH * (1 - (v - yMin) / (yMax - yMin));
}

export const signed = (v: number, fmt: (n: number) => string) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v));
export const pctStr = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
