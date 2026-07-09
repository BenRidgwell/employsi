import { STATE_STATS, CITY_STATE, CITY_XY, CITY_LABEL, GLOBAL_STATS, GLOBAL_HUB_XY, GLOBAL_HUB_LABEL, SKILL_DEMAND, GLOBAL_SKILL_DEMAND } from '../data/geo';
import { COMPANIES } from '../data/companies';
import { heatDisc, skillColorAt, type HeatDisc } from './color';

export type HeatMetric = 'salary' | 'growth' | 'turnover';

function metricKey(heat: HeatMetric): 'salary' | 'growth' | 'turnover' {
  return heat;
}

export interface HeatLegend {
  title: string;
  lo: string;
  hi: string;
}

export function computeCityHeat(heat: HeatMetric): Record<string, HeatDisc> {
  const key = metricKey(heat);
  const vals = Object.values(STATE_STATS).map((s) => s[key]);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const out: Record<string, HeatDisc> = {};
  Object.entries(CITY_STATE).forEach(([city, state]) => {
    const t = (STATE_STATS[state][key] - mn) / ((mx - mn) || 1);
    out[city] = heatDisc(t);
  });
  return out;
}

export function auHeatLegend(heat: HeatMetric): HeatLegend {
  const key = metricKey(heat);
  const vals = Object.values(STATE_STATS).map((s) => s[key]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (heat === 'salary') return { title: 'Median salary · by city', lo: '$' + lo + 'K', hi: '$' + hi + 'K' };
  if (heat === 'growth') return { title: 'Employment growth · by city', lo: '+' + lo.toFixed(1) + '%', hi: '+' + hi.toFixed(1) + '%' };
  return { title: 'Turnover rate · by city', lo: lo.toFixed(1) + '%', hi: hi.toFixed(1) + '%' };
}

export function computeGlobalHeat(heat: HeatMetric): Record<string, HeatDisc> {
  const key = metricKey(heat);
  const vals = Object.values(GLOBAL_STATS).map((s) => s[key]);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const out: Record<string, HeatDisc> = {};
  Object.entries(GLOBAL_STATS).forEach(([hub, s]) => {
    const t = (s[key] - mn) / ((mx - mn) || 1);
    out[hub] = heatDisc(t);
  });
  return out;
}

export function globalHeatLegend(heat: HeatMetric): HeatLegend {
  const key = metricKey(heat);
  const vals = Object.values(GLOBAL_STATS).map((s) => s[key]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (heat === 'salary') return { title: 'Median salary · by hub', lo: '$' + lo + 'K', hi: '$' + hi + 'K' };
  if (heat === 'growth') return { title: 'Employment growth · by hub', lo: '+' + lo.toFixed(1) + '%', hi: '+' + hi.toFixed(1) + '%' };
  return { title: 'Turnover rate · by hub', lo: lo.toFixed(1) + '%', hi: hi.toFixed(1) + '%' };
}

export function heatLegend(heat: HeatMetric): HeatLegend {
  const cs = COMPANIES;
  if (heat === 'salary') {
    const v = cs.map((c) => c.salaryNum);
    return { title: 'Median salary', lo: '$' + Math.round(Math.min(...v) / 1000) + 'K', hi: '$' + Math.round(Math.max(...v) / 1000) + 'K' };
  }
  if (heat === 'growth') {
    const v = cs.map((c) => c.growth);
    return { title: 'Employment growth', lo: '+' + Math.min(...v).toFixed(1) + '%', hi: '+' + Math.max(...v).toFixed(1) + '%' };
  }
  const v = cs.map((c) => c.turnover);
  return { title: 'Turnover rate', lo: Math.min(...v).toFixed(1) + '%', hi: Math.max(...v).toFixed(1) + '%' };
}

export function chipMetric(c: (typeof COMPANIES)[number], heat: HeatMetric): string {
  if (heat === 'salary') return c.salaryShort + ' median';
  if (heat === 'growth') return (c.growth >= 0 ? '+' : '') + c.growth.toFixed(1) + '% growth';
  return c.turnover.toFixed(1) + '% turnover';
}

export function skillLegend(skill: string): HeatLegend {
  return { title: skill + ' demand by city', lo: 'Lower', hi: 'Higher' };
}

export interface SpikePoint {
  id?: string;
  label?: string;
  /** Position + radius in the host map's SVG viewBox units. */
  cx: number;
  cy: number;
  r: number;
  /** Raw "r,g,b" channels for building rgba() heat-blob fills. */
  color: string;
  tooltip?: string;
}

export function computeSkillSpikes(skill: string): SpikePoint[] {
  const D = SKILL_DEMAND[skill];
  if (!D) return [];
  const vals = Object.values(D);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  return Object.keys(CITY_XY).map((id) => {
    const [cx, cy] = CITY_XY[id];
    const v = D[id];
    const t = (v - mn) / ((mx - mn) || 1);
    const rgb = skillColorAt(t);
    return {
      id,
      label: CITY_LABEL[id],
      cx,
      cy,
      r: 7 + t * 16,
      color: rgb.join(','),
      tooltip: `${CITY_LABEL[id]}: ${Math.round(v)} relative demand`,
    };
  });
}

export function computeAmbientSpikes(skill: string, scatter: [number, number][]): SpikePoint[] {
  const D = SKILL_DEMAND[skill];
  if (!D) return [];
  const vals = Object.values(D);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const cities = Object.keys(CITY_XY).map((id) => ({ x: CITY_XY[id][0], y: CITY_XY[id][1], v: D[id] }));
  let seed = 42;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return scatter.map(([x, y]) => {
    let wsum = 0;
    let vsum = 0;
    cities.forEach((c) => {
      const d2 = (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y);
      const w = 1 / (d2 + 90);
      wsum += w;
      vsum += w * c.v;
    });
    const v = vsum / wsum;
    const t0 = (v - mn) / ((mx - mn) || 1);
    const t = Math.max(0, Math.min(1, Math.pow(Math.max(0, t0), 1.8) * (0.7 + rnd() * 0.5)));
    const rgb = skillColorAt(Math.min(1, t0));
    return {
      cx: x,
      cy: y,
      r: 3 + t * 9,
      color: rgb.join(','),
    };
  });
}

export function computeGlobalSpikes(skill: string): SpikePoint[] {
  const D = GLOBAL_SKILL_DEMAND[skill];
  if (!D) return [];
  const vals = Object.values(D);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  return Object.keys(GLOBAL_HUB_XY).map((id) => {
    const [cx, cy] = GLOBAL_HUB_XY[id];
    const v = D[id];
    const t = (v - mn) / ((mx - mn) || 1);
    const rgb = skillColorAt(t);
    return {
      id,
      label: GLOBAL_HUB_LABEL[id],
      cx,
      cy,
      r: 9 + t * 20,
      color: rgb.join(','),
      tooltip: `${GLOBAL_HUB_LABEL[id]}: ${Math.round(v)} relative demand`,
    };
  });
}

export function computeGlobalAmbientSpikes(skill: string, scatter: [number, number][]): SpikePoint[] {
  const D = GLOBAL_SKILL_DEMAND[skill];
  if (!D) return [];
  const vals = Object.values(D);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const hubs = Object.keys(GLOBAL_HUB_XY).map((id) => ({ x: GLOBAL_HUB_XY[id][0], y: GLOBAL_HUB_XY[id][1], v: D[id] }));
  let seed = 51;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return scatter.map(([x, y]) => {
    let wsum = 0;
    let vsum = 0;
    hubs.forEach((h) => {
      const d2 = (x - h.x) ** 2 + (y - h.y) ** 2;
      const w = 1 / (d2 + 220);
      wsum += w;
      vsum += w * h.v;
    });
    const v = vsum / wsum;
    const t0 = (v - mn) / ((mx - mn) || 1);
    const t = Math.max(0, Math.min(1, Math.pow(Math.max(0, t0), 1.8) * (0.7 + rnd() * 0.5)));
    const rgb = skillColorAt(Math.min(1, t0));
    return {
      cx: x,
      cy: y,
      r: 4 + t * 12,
      color: rgb.join(','),
    };
  });
}
