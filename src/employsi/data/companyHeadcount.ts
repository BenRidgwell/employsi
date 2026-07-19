// GENERATED — do not edit by hand. Run scripts/gen-headcount.py.
// Real workforce headcount for the current + prior reporting year, sourced
// from each company's annual report (via stockanalysis.com, which refreshes
// once per year after each filing). Static by design — there is no live HRIS/
// LinkedIn feed — with the year-on-year growth % computed from now vs prev.
export interface Headcount { now: number; prev: number; yoy: number; asof: string; }
export const COMPANY_HEADCOUNT: Record<string, Headcount> = {
  'asb': { now: 4633, prev: 4479, yoy: 3.4, asof: 'Dec 2025' },
  'boe': { now: 125, prev: 139, yoy: -10.1, asof: 'Jun 2025' },
  'chevron': { now: 43039, prev: 45298, yoy: -5.0, asof: 'Dec 2025' },
  'fmg': { now: 15745, prev: 16000, yoy: -1.6, asof: 'Dec 2025' },
  'gmd': { now: 603, prev: 331, yoy: 82.2, asof: 'Jun 2025' },
  'ilu': { now: 1000, prev: 1000, yoy: 0.0, asof: 'Dec 2025' },
  'mah': { now: 10220, prev: 9676, yoy: 5.6, asof: 'Jun 2025' },
  'min': { now: 8456, prev: 5687, yoy: 48.7, asof: 'Jun 2024' },
  'mnd': { now: 8389, prev: 7375, yoy: 13.7, asof: 'Dec 2025' },
  'nhc': { now: 1575, prev: 1084, yoy: 45.3, asof: 'Jul 2025' },
  'nwh': { now: 11900, prev: 8800, yoy: 35.2, asof: 'Dec 2025' },
  'pdn': { now: 500, prev: 307, yoy: 62.9, asof: 'Jun 2025' },
  'pls': { now: 950, prev: 917, yoy: 3.6, asof: 'Jun 2025' },
  'rio': { now: 56865, prev: 55561, yoy: 2.3, asof: 'Dec 2025' },
  'rms': { now: 250, prev: 300, yoy: -16.7, asof: 'Jun 2025' },
  's32': { now: 8892, prev: 9906, yoy: -10.2, asof: 'Jun 2025' },
  'sfr': { now: 1355, prev: 1236, yoy: 9.6, asof: 'Jun 2025' },
  'shell': { now: 85000, prev: 96000, yoy: -11.5, asof: 'Dec 2025' },
  'sto': { now: 4028, prev: 3958, yoy: 1.8, asof: 'Dec 2025' },
  'wds': { now: 4693, prev: 4718, yoy: -0.5, asof: 'Dec 2025' },
  'wes': { now: 120000, prev: 118000, yoy: 1.7, asof: 'Dec 2025' },
  'wgx': { now: 1572, prev: 1071, yoy: 46.8, asof: 'Jun 2025' },
};
