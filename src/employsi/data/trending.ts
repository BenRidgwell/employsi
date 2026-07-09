// Illustrative "What's Trending" board — movers over the last financial
// quarter. Deltas are placeholder figures; `ticker`/`skill` wire a row to
// the relevant company panel or skill-heat search.

export type TrendIcon = 'movers' | 'salary' | 'hot';

export interface TrendItem {
  label: string;
  sub: string;
  delta: number; // percent; sign = direction
  ticker?: string; // links to a company
  skill?: string; // links to a skill-heat search
}

export interface TrendSection {
  id: string;
  title: string;
  caption: string;
  icon: TrendIcon;
  items: TrendItem[];
}

// "Most viewed" snapshot — what platform users are exploring most right now.
export interface ViewedItem {
  kind: 'company' | 'continent' | 'skill';
  label: string;
  sub: string;
  share: string;
  ticker?: string;
  skill?: string;
}

export const MOST_VIEWED: ViewedItem[] = [
  { kind: 'company', label: 'BHP', sub: 'Diversified Mining', share: '18%', ticker: 'BHP' },
  { kind: 'continent', label: 'Australia', sub: 'Domestic hubs', share: '23%' },
  { kind: 'skill', label: 'Autonomous Haulage', sub: 'Occupation', share: '12%', skill: 'Autonomous Haulage' },
];

export const TREND_SECTIONS: TrendSection[] = [
  {
    id: 'movers',
    title: 'Big movers',
    caption: 'Changes in skills and occupations by job vacancy activity',
    icon: 'movers',
    items: [
      { label: 'Autonomous Haulage', sub: 'New vacancies · WA iron ore', delta: 34.0, skill: 'Autonomous Haulage' },
      { label: 'Hydrogen Engineering', sub: 'Green-energy build-out', delta: 28.5 },
      { label: 'Carbon Capture', sub: 'Gas majors ramping CCS', delta: 19.2, skill: 'Carbon Capture' },
      { label: 'Diesel Mechanics', sub: 'Fleet electrification', delta: -12.4 },
      { label: 'Rail Systems', sub: 'Fewer greenfield rail roles', delta: -8.1 },
    ],
  },
  {
    id: 'salary',
    title: 'Salary spenders',
    caption: 'Changes in median salary',
    icon: 'salary',
    items: [
      { label: 'Subsea Engineer', sub: 'Median salary · +$18k', delta: 11.0 },
      { label: 'Woodside Energy', sub: 'Human-capital spend', delta: 8.4, ticker: 'WDS' },
      { label: 'Fortescue', sub: 'Human-capital spend', delta: 6.1, ticker: 'FMG' },
      { label: 'Process Engineer', sub: 'Median salary easing', delta: -3.2 },
      { label: 'South32', sub: 'Human-capital spend', delta: -2.0, ticker: 'S32' },
    ],
  },
  {
    id: 'hot',
    title: 'Hot companies',
    caption: 'Changes in employee headcount',
    icon: 'hot',
    items: [
      { label: 'Fortescue', sub: 'Renewables & project delivery', delta: 9.2, ticker: 'FMG' },
      { label: 'IGO', sub: 'Hydromet & processing ramp', delta: 6.8, ticker: 'IGO' },
      { label: 'BHP', sub: 'Autonomous operations', delta: 4.1, ticker: 'BHP' },
      { label: 'South32', sub: 'Portfolio restructuring', delta: -2.4, ticker: 'S32' },
      { label: 'Santos', sub: 'Cost discipline', delta: -1.6, ticker: 'STO' },
    ],
  },
];
