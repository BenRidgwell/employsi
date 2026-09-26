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
  if (pts.length < 2) return "";
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

export const signed = (v: number, fmt: (n: number) => string) =>
  (v >= 0 ? "+" : "−") + fmt(Math.abs(v));
export const pctStr = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%";

// ── the market hero's x axis ────────────────────────────────────────────────
/**
 * One mapping from "day i" to "where across the plot", shared by the SVG line
 * and the HTML markers that sit on top of it.
 *
 * IT LIVES HERE RATHER THAN IN THE COMPONENT so the round trip below can be
 * asserted. The card had three x mappings — the path's viewBox coordinate, the
 * markers' clamped percentage and the scrub tooltip's raw percentage — and two
 * of them agreed. The one that did not was the markers': the last one was
 * pulled back by `calc(100% - 10px)` to keep it inside a plot that clips, while
 * its y stayed the y of the last reading, so on a series still moving at the
 * end the ring floated off the line it was marking. Reported from a Perth card
 * on 2026-09-26.
 *
 * A clamp in CSS pixels cannot line up with a path in stretched viewBox units,
 * because the two disagree by more or less with the card's width. So the inset
 * is expressed once, in the line's own units: the box is widened by HERO_PAD on
 * both sides and the line spans 0..HERO_W inside it. Every overlay is then a
 * plain percentage of the widened box, and lands on the line at every width.
 */
export const HERO_W = 320;
/** The inset at each end, in viewBox units — room for the end marker. */
export const HERO_PAD = 12;
export const HERO_VB_W = HERO_W + HERO_PAD * 2;

/** viewBox x for day `i` of `n`, inside the widened box. */
export const heroX = (i: number, n: number) => (i / Math.max(1, n - 1)) * HERO_W;
/** The same point as a percentage of the rendered plot. */
export const heroPct = (i: number, n: number) => ((HERO_PAD + heroX(i, n)) / HERO_VB_W) * 100;
/**
 * The day nearest a pointer `f` of the way across the plot — the inverse of
 * heroPct, and it has to be, or the day the reader scrubs to is not the day
 * whose marker is under the cursor.
 */
export const heroIdxAt = (f: number, n: number) =>
  Math.max(0, Math.min(n - 1, Math.round(((f * HERO_VB_W - HERO_PAD) / HERO_W) * (n - 1))));
