import { STATE_STATS, GLOBAL_STATS } from '../data/geo';
import { COMPANIES } from '../data/companies';
import { heatDisc, type HeatDisc } from './color';

export type HeatMetric = 'salary' | 'growth' | 'turnover';

function metricKey(heat: HeatMetric): 'salary' | 'growth' | 'turnover' {
  return heat;
}

export interface HeatLegend {
  title: string;
  lo: string;
  hi: string;
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
