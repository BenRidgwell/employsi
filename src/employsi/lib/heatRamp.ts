/**
 * The demand heat ramp: green (low) → lime → amber → red (high).
 *
 * ONE definition, read by the globe's skill heat layer (WorldMapbox's
 * `heatmap-color`) and by the career pathway map's role cards, so a card
 * glowing amber means what an amber blob on the globe means. It was written
 * inline in WorldMapbox until 2026-09-27; lifting it here is what lets a
 * second surface use the legend without a copy that could drift.
 *
 * Stops are [position 0–1, r, g, b, alpha]. The alpha is the heat layer's own
 * (the blobs are translucent over the basemap); surfaces that draw a solid
 * colour read `heatRgb` and set their own opacity.
 */
export const HEAT_RAMP: readonly (readonly [number, number, number, number, number])[] = [
  [0, 21, 157, 103, 0],
  [0.12, 21, 157, 103, 0.42],
  [0.35, 120, 190, 60, 0.55],
  [0.55, 245, 166, 35, 0.68],
  [0.78, 224, 82, 74, 0.8],
  [1, 214, 54, 46, 0.88],
];

/** Where the ramp's visible colour begins — below it the heat layer is clear. */
export const HEAT_RAMP_FLOOR = HEAT_RAMP[1][0];

/** The Mapbox `heatmap-color` expression for the ramp. */
export function heatmapColorExpression(): (string | number | string[])[] {
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    ...HEAT_RAMP.flatMap(([p, r, g, b, a]) => [p, `rgba(${r},${g},${b},${a})`]),
  ];
}

/** The ramp's colour at position `p` (0–1), linearly interpolated, as [r, g, b]. */
export function heatRgb(p: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, p));
  for (let i = 1; i < HEAT_RAMP.length; i++) {
    const [p1, r1, g1, b1] = HEAT_RAMP[i];
    if (x > p1) continue;
    const [p0, r0, g0, b0] = HEAT_RAMP[i - 1];
    const f = p1 === p0 ? 0 : (x - p0) / (p1 - p0);
    return [
      Math.round(r0 + (r1 - r0) * f),
      Math.round(g0 + (g1 - g0) * f),
      Math.round(b0 + (b1 - b0) * f),
    ];
  }
  const [, r, g, b] = HEAT_RAMP[HEAT_RAMP.length - 1];
  return [r, g, b];
}

/** The ramp as a CSS gradient over its visible part, for a LOW → HIGH key. */
export function heatGradientCss(direction = "90deg"): string {
  const visible = HEAT_RAMP.slice(1);
  const span = 1 - HEAT_RAMP_FLOOR;
  const stops = visible.map(
    ([p, r, g, b]) => `rgb(${r},${g},${b}) ${Math.round(((p - HEAT_RAMP_FLOOR) / span) * 100)}%`,
  );
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}
