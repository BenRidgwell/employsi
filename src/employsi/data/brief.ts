// Illustrative "Daily Brief" stories for the resources sector. Headlines and
// summaries are original placeholder copy; tags reference companies in COMPANIES.

export type BriefIcon = 'energy' | 'mine' | 'gas' | 'battery' | 'metal' | 'carbon' | 'copper';

export interface BriefArticle {
  id: string;
  category: string;
  date: string;
  title: string;
  summary: string;
  tags: string[]; // company tickers
  tone: string; // thumbnail base colour
  icon: BriefIcon;
}

export const BRIEF_ARTICLES: BriefArticle[] = [
  {
    id: 'b1',
    category: 'Green Energy',
    date: '9 Jul 2026',
    title: 'Fortescue accelerates Pilbara green hydrogen build-out',
    summary: 'New electrolyser capacity and a wave of electrical and project-delivery hiring underpin the decarbonisation push.',
    tags: ['FMG'],
    tone: '#159d67',
    icon: 'energy',
  },
  {
    id: 'b2',
    category: 'Automation',
    date: '9 Jul 2026',
    title: 'BHP and Rio Tinto expand autonomous haulage fleets',
    summary: 'Both miners lift investment in remote operations, shifting demand toward data, controls and maintenance roles.',
    tags: ['BHP', 'RIO'],
    tone: '#3a3f4a',
    icon: 'mine',
  },
  {
    id: 'b3',
    category: 'Oil & Gas',
    date: '8 Jul 2026',
    title: 'Woodside locks in multi-year LNG supply to North Asia',
    summary: 'Long-term offtake supports sustained subsea and reservoir engineering recruitment across the portfolio.',
    tags: ['WDS'],
    tone: '#2b6cb0',
    icon: 'gas',
  },
  {
    id: 'b4',
    category: 'Battery Metals',
    date: '8 Jul 2026',
    title: 'IGO lifts lithium output guidance on strong demand',
    summary: 'Hydromet expansion and processing hires track the battery-metals cycle as nickel and lithium volumes climb.',
    tags: ['IGO'],
    tone: '#0d9488',
    icon: 'battery',
  },
  {
    id: 'b5',
    category: 'Metals',
    date: '7 Jul 2026',
    title: 'South32 ramps manganese as prices rally',
    summary: 'Higher throughput brings a steady pipeline of metallurgy, processing and maintenance vacancies.',
    tags: ['S32'],
    tone: '#b7791f',
    icon: 'metal',
  },
  {
    id: 'b6',
    category: 'Energy Transition',
    date: '7 Jul 2026',
    title: 'Santos advances Cooper Basin carbon capture project',
    summary: 'CCS milestones widen demand for facilities engineering and commercial talent across the gas business.',
    tags: ['STO'],
    tone: '#6d5bd0',
    icon: 'carbon',
  },
  {
    id: 'b7',
    category: 'Copper',
    date: '6 Jul 2026',
    title: 'Sandfire boosts copper output as Motheo hits stride',
    summary: 'Ramp-up at the flagship operation lifts processing, metallurgy and geology hiring.',
    tags: ['SFR'],
    tone: '#c05621',
    icon: 'copper',
  },
];
