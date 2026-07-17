export type RGB = [number, number, number];

const RED: RGB = [224, 82, 74];
const AMBER: RGB = [245, 166, 35];
const GREEN: RGB = [21, 157, 103];

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function heatColor(t: number): RGB {
  // Scale runs green (low activity) → amber → red (high activity), so a higher
  // metric value / more demand reads hotter.
  const u = 1 - t;
  return u < 0.5 ? lerpRGB(RED, AMBER, u / 0.5) : lerpRGB(AMBER, GREEN, (u - 0.5) / 0.5);
}

export function rgbCss(rgb: RGB): string {
  return `rgb(${rgb.join(',')})`;
}

export interface HeatDisc {
  color: string;
  r: string;
  haloR: string;
}

export function heatDisc(t: number): HeatDisc {
  const rgb = heatColor(t);
  const core = 2.6 + 3.4 * t;
  return { color: rgbCss(rgb), r: core.toFixed(1), haloR: (core * 2.1).toFixed(1) };
}
