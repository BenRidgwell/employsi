// Illustrative in-app news feed per company. Headlines are generated from the
// company's name + sector so each card feels bespoke; all content is fictional
// placeholder copy for demonstration.

export interface NewsItem {
  cat: string;
  title: string;
  time: string;
  comments: number;
}

export interface CompanyNews {
  hero: NewsItem;
  items: NewsItem[];
}

// Small deterministic hash so the same company always gets the same feed.
function seedOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
}

const HERO_TEMPLATES = [
  (n: string) => `${n} lifts full-year guidance as demand rebounds`,
  (n: string) => `${n} greenlights major expansion in a bet on the cycle`,
  (n: string) => `Inside ${n}'s push to automate its operations`,
  (n: string) => `${n} strikes multi-year offtake deal with Asian buyers`,
];

const ITEM_TEMPLATES: ((n: string) => string)[] = [
  (n) => `${n} names new chief operating officer`,
  (n) => `Analysts upgrade ${n} on stronger margins`,
  (n) => `${n} commits to fresh emissions-reduction target`,
  (n) => `${n} flags tighter labour market for skilled trades`,
  (n) => `${n} partners with universities on graduate pipeline`,
  (n) => `${n} reports quarterly output ahead of forecast`,
];

const CATS = ['Markets', 'Company', 'Sector', 'People', 'Sustainability'];
const TIMES = ['1h ago', '3h ago', '6h ago', '9h ago', '14h ago', '1d ago', '2d ago'];

// BHP is the real-data pilot: genuine, dated headlines from BHP's own
// newsroom and wire coverage (bhp.com/news, Bloomberg, US News — July 2026),
// in place of the generated placeholder copy every other company still uses.
function bhpRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Brandon Craig becomes BHP chief executive as leadership transition completes',
      time: '2d ago',
      comments: 34,
    },
    items: [
      { cat: 'Markets', title: 'BHP wins approval for $1.3B early works on Escondida copper expansion', time: '5h ago', comments: 21 },
      { cat: 'People', title: 'Port Hedland iron ore workers strike over pay and conditions', time: '1d ago', comments: 47 },
      { cat: 'Markets', title: 'JPMorgan and Citi trim BHP price targets on softer commodity outlook', time: '2d ago', comments: 16 },
      { cat: 'Company', title: 'Jessica Farrell appointed President North America', time: '3d ago', comments: 9 },
    ],
  };
}

export function companyNews(name: string, sector: string): CompanyNews {
  if (name === 'BHP') return bhpRealNews();
  const seed = seedOf(name + sector);
  const pick = <T,>(arr: T[], k: number) => arr[(seed + k) % arr.length];
  const hero: NewsItem = {
    cat: 'Trending',
    title: (pick(HERO_TEMPLATES, 0) as (n: string) => string)(name),
    time: pick(TIMES, 1),
    comments: 4 + ((seed + 7) % 40),
  };
  const items: NewsItem[] = [0, 1, 2, 3].map((i) => ({
    cat: pick(CATS, i + 2),
    title: (ITEM_TEMPLATES[(seed + i * 3) % ITEM_TEMPLATES.length])(name),
    time: pick(TIMES, i + 3),
    comments: 1 + ((seed + i * 5) % 30),
  }));
  return { hero, items };
}
