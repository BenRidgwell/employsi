import { COMPANIES, type Company } from '../data/companies';

export interface RadarAxis {
  line: string;
  leftPct: string;
  topPct: string;
  label: string;
}

export interface RadarPoint {
  cx: string;
  cy: string;
  leftPct: string;
  topPct: string;
  val: string;
}

export interface RadarRow {
  label: string;
  a: string;
  b: string;
}

export interface CompareData {
  axes: RadarAxis[];
  aPoly: string;
  bPoly: string;
  pointsA: RadarPoint[];
  pointsB: RadarPoint[];
  rows: RadarRow[];
  aName: string;
  bName: string;
  aTicker: string;
  bTicker: string;
}

interface WithTurnoverInv extends Company {
  turnoverInv: number;
}

const metrics: { key: keyof WithTurnoverInv; label: string; fmt: (v: number, c: WithTurnoverInv) => string | number }[] = [
  { key: 'salaryNum', label: 'Salary', fmt: (v) => '$' + Math.round((v as number) / 1000) + 'K' },
  { key: 'growth', label: 'Headcount growth', fmt: (v) => (v >= 0 ? '+' : '') + (v as number).toFixed(1) + '%' },
  { key: 'openRoles', label: 'Open roles', fmt: (v) => Math.round(v as number) },
  { key: 'headcount', label: 'Perth headcount', fmt: (v) => Math.round(v as number).toLocaleString('en-US') },
  { key: 'turnoverInv', label: 'Retention', fmt: (_v, c) => (20 - c.turnover).toFixed(1) + '%' },
];

export function buildCompareRadar(idA: string | null, idB: string | null): CompareData | null {
  const A = COMPANIES.find((c) => c.id === idA);
  const B = COMPANIES.find((c) => c.id === idB);
  if (!A || !B) return null;

  const withVal = (c: Company): WithTurnoverInv => ({ ...c, turnoverInv: 20 - c.turnover });
  const all = COMPANIES.map(withVal);
  const a = withVal(A);
  const b = withVal(B);
  const n = metrics.length;
  const R = 78;
  const cx = 100;
  const cy = 104;

  const pt = (i: number, t: number): [number, number] => {
    const ang = -Math.PI / 2 + i * ((2 * Math.PI) / n);
    const r = 14 + t * R;
    return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
  };

  const norm = (key: keyof WithTurnoverInv, val: number) => {
    const vals = all.map((c) => c[key] as number);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    return mx === mn ? 0.5 : (val - mn) / (mx - mn);
  };

  const axes: RadarAxis[] = metrics.map((m, i) => {
    const [lx, ly] = pt(i, 1.14);
    const [ox, oy] = pt(i, 0);
    const [ex, ey] = pt(i, 1);
    return {
      line: `M${ox.toFixed(1)},${oy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`,
      leftPct: ((lx / 200) * 100).toFixed(2),
      topPct: ((ly / 208) * 100).toFixed(2),
      label: m.label,
    };
  });

  const ptsFor = (c: WithTurnoverInv) =>
    metrics
      .map((m, i) => pt(i, norm(m.key, c[m.key] as number)))
      .map((p) => p.map((v) => v.toFixed(1)).join(','))
      .join(' ');

  const rows: RadarRow[] = metrics.map((m) => ({
    label: m.label,
    a: String(m.fmt(a[m.key] as number, a)),
    b: String(m.fmt(b[m.key] as number, b)),
  }));

  const labelPt = (i: number, t: number, side: number): [string, string] => {
    const ang = -Math.PI / 2 + i * ((2 * Math.PI) / n);
    const r = 14 + t * R + 11;
    const perpX = -Math.sin(ang);
    const perpY = Math.cos(ang);
    const bx = cx + Math.cos(ang) * r + perpX * side * 8;
    const by = cy + Math.sin(ang) * r + perpY * side * 8;
    return [bx.toFixed(1), by.toFixed(1)];
  };

  const pointsA: RadarPoint[] = metrics.map((m, i) => {
    const t = norm(m.key, a[m.key] as number);
    const [px, py] = pt(i, t);
    const [lx, ly] = labelPt(i, t, -1);
    return { cx: px.toFixed(1), cy: py.toFixed(1), leftPct: ((Number(lx) / 200) * 100).toFixed(2), topPct: ((Number(ly) / 208) * 100).toFixed(2), val: String(m.fmt(a[m.key] as number, a)) };
  });
  const pointsB: RadarPoint[] = metrics.map((m, i) => {
    const t = norm(m.key, b[m.key] as number);
    const [px, py] = pt(i, t);
    const [lx, ly] = labelPt(i, t, 1);
    return { cx: px.toFixed(1), cy: py.toFixed(1), leftPct: ((Number(lx) / 200) * 100).toFixed(2), topPct: ((Number(ly) / 208) * 100).toFixed(2), val: String(m.fmt(b[m.key] as number, b)) };
  });

  return { axes, aPoly: ptsFor(a), bPoly: ptsFor(b), pointsA, pointsB, rows, aName: A.name, bName: B.name, aTicker: A.ticker, bTicker: B.ticker };
}
