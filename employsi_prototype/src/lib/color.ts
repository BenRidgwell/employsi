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
  return t < 0.5 ? lerpRGB(RED, AMBER, t / 0.5) : lerpRGB(AMBER, GREEN, (t - 0.5) / 0.5);
}

export function rgbCss(rgb: RGB): string {
  return `rgb(${rgb.join(',')})`;
}

/** Same red->amber->green ramp used for skill-demand spikes (skillColorAt in the prototype). */
export function skillColorAt(t: number): RGB {
  const stops: RGB[] = [RED, AMBER, GREEN];
  const seg = Math.min(1, Math.floor(t * 2));
  const lt = t * 2 - seg;
  const a = stops[seg];
  const b = stops[seg + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * lt),
    Math.round(a[1] + (b[1] - a[1]) * lt),
    Math.round(a[2] + (b[2] - a[2]) * lt),
  ];
}

export function spikeGradient(rgb: RGB): string {
  const top = rgbCss(rgb.map((c) => Math.min(255, Math.round(c + (255 - c) * 0.35))) as RGB);
  const bot = rgbCss(rgb.map((c) => Math.round(c * 0.75)) as RGB);
  return `linear-gradient(to bottom,${top},${bot})`;
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
