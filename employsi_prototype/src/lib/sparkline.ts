export interface Spark {
  line: string;
  area: string;
}

export function spark(arr: number[]): Spark {
  const w = 188;
  const h = 52;
  const pad = 5;
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  const pts = arr.map((v, i) => [
    pad + (i * (w - 2 * pad)) / (arr.length - 1),
    h - pad - ((v - mn) / ((mx - mn) || 1)) * (h - 2 * pad),
  ]);
  const line = 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L ');
  const area = line + ` L ${pts[pts.length - 1][0].toFixed(1)} ${h} L ${pts[0][0].toFixed(1)} ${h} Z`;
  return { line, area };
}
