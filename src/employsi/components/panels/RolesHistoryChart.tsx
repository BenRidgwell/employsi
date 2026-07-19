import { useMemo } from 'react';
import { smoothPath, scaler } from '../../lib/chart';
import type { RolePoint } from '../../lib/openRolesFn';

// Compact "live vacancies" sparkline. Plots the real daily vacancy snapshots
// recorded from the live feed. History builds forward from the first time a
// company is queried, so with only a point or two it shows a "tracking started"
// note instead of a misleadingly flat line. Today's point carries a flashing
// marker labelled with the current vacancy count.

const W = 340;
const H = 96;
const PADX = 10;
const PADT = 16;
const PADB = 10;
const PLOTW = W - PADX * 2;
const PLOTH = H - PADT - PADB;

const fmtDate = (d: string) => {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};
const num = (v: number) => Math.round(v).toLocaleString('en-US');

export function RolesHistoryChart({ points, current }: { points: RolePoint[]; current?: number }) {
  const pts = useMemo(() => points.slice().sort((a, b) => a.d.localeCompare(b.d)), [points]);
  const counts = pts.map((p) => p.c);
  const n = counts.length;
  // The number shown on the flashing "today" marker: prefer the live count.
  const latest = current ?? counts[n - 1] ?? 0;

  const geom = useMemo(() => {
    if (n < 2) return null;
    const x = (i: number) => PADX + (i * PLOTW) / (n - 1);
    const y = scaler(counts, PADT, PLOTH);
    const line = smoothPath(counts.map((v, i) => [x(i), y(v)]));
    const area = line + ` L ${x(n - 1).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} L ${x(0).toFixed(2)} ${(PADT + PLOTH).toFixed(2)} Z`;
    const lastX = (x(n - 1) / W) * 100;
    const lastY = (y(counts[n - 1]) / H) * 100;
    return { line, area, lastX, lastY };
  }, [counts, n]);

  const first = counts[0] ?? 0;
  const delta = (counts[n - 1] ?? 0) - first;
  const pct = first ? (delta / first) * 100 : 0;

  return (
    <>
      <div className="secth">Live vacancies</div>

      {geom ? (
        <>
          <div className="rhbox">
            <svg className="rhsvg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id="rhFade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(28,28,30,0.16)" />
                  <stop offset="65%" stopColor="rgba(28,28,30,0.05)" />
                  <stop offset="100%" stopColor="rgba(28,28,30,0)" />
                </linearGradient>
              </defs>
              <path className="rharea" d={geom.area} />
              <path className="rhline" d={geom.line} vectorEffect="non-scaling-stroke" />
            </svg>
            {/* Current count callout, pinned to the left; flashing dot sits on
                the line's endpoint. */}
            <div className="gcallout">
              <b>{num(latest)}</b>
              <span>live now</span>
            </div>
            <span className="rhpulse" style={{ left: `${geom.lastX}%`, top: `${geom.lastY}%` }} />
          </div>
          <div className="rhaxis">
            <span>{fmtDate(pts[0].d)}</span>
            <span className={`rhtrend ${delta >= 0 ? 'up' : 'down'}`}>
              {delta === 0 ? 'no change' : `${delta >= 0 ? '+' : '−'}${num(Math.abs(delta))} (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%)`}
            </span>
            <span>{fmtDate(pts[n - 1].d)}</span>
          </div>
        </>
      ) : (
        <div className="rhempty">
          {n === 1 ? (
            <>Tracking started at <b>{num(latest)}</b> vacancies — the trend line fills in as daily snapshots are recorded.</>
          ) : (
            <>Vacancy tracking begins the first time this company's live feed loads, then builds a daily history here.</>
          )}
        </div>
      )}
    </>
  );
}
