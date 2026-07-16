// Illustrative in-app news feed per company. Headlines are generated from the
// company's name + sector so each card feels bespoke; all content is fictional
// placeholder copy for demonstration.

export interface NewsItem {
  cat: string;
  title: string;
  time: string;
  comments: number;
  // Optional real article link + image; when absent the news card falls back to
  // a Google-News search for the headline and a deterministic stock photo.
  url?: string;
  image?: string;
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

// Rio Tinto, Fortescue and South32 also get real, dated headlines drawn from
// their newsrooms and wire coverage (riotinto.com, fortescue.com, south32.net,
// MINING.COM — 2025/2026), in place of the generated placeholder copy.
function rioRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Rio Tinto ships first ore from the Simandou iron ore mega-project in Guinea',
      time: '4d ago',
      comments: 41,
    },
    items: [
      { cat: 'Markets', title: 'Rio Tinto completes $6.7B acquisition of Arcadium Lithium', time: '1w ago', comments: 33 },
      { cat: 'People', title: 'Simon Trott takes over as chief executive', time: '2w ago', comments: 22 },
      { cat: 'Company', title: 'Lithium arm targets 200,000 tonnes LCE a year by 2028', time: '2w ago', comments: 14 },
      { cat: 'Sustainability', title: 'Women now 25% of Rio Tinto’s workforce as pay gap narrows', time: '3w ago', comments: 11 },
    ],
  };
}

function fmgRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Fortescue ships 200 million tonnes of iron ore in a year for the first time',
      time: '3d ago',
      comments: 28,
    },
    items: [
      { cat: 'Markets', title: 'Record first-half shipments of 100.2Mt, up 3% year-on-year', time: '6d ago', comments: 17 },
      { cat: 'People', title: 'Fortescue cuts ~700 roles as it slows green-hydrogen plans', time: '1w ago', comments: 52 },
      { cat: 'Company', title: 'Andrew Forrest defends energy strategy amid restructure', time: '1w ago', comments: 24 },
      { cat: 'Sustainability', title: 'Real-Zero 2030 emissions goal under fresh scrutiny', time: '2w ago', comments: 19 },
    ],
  };
}

function s32RealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'South32’s Hermosa becomes the first mine added to the US federal permitting dashboard in a decade',
      time: '5d ago',
      comments: 16,
    },
    items: [
      { cat: 'Markets', title: 'Hermosa wins $166M US Department of Energy battery-materials grant', time: '1w ago', comments: 12 },
      { cat: 'Company', title: 'Taylor zinc-manganese deposit on track for first production in FY2027', time: '2w ago', comments: 8 },
      { cat: 'Markets', title: 'FY24 revenue US$5.6B, underlying EBITDA US$1.8B on softer prices', time: '3w ago', comments: 10 },
      { cat: 'Sustainability', title: 'Manganese positioned as a US battery-supply-chain opportunity', time: '3w ago', comments: 6 },
    ],
  };
}

export function companyNews(name: string, sector: string): CompanyNews {
  if (name === 'BHP') return bhpRealNews();
  if (name === 'Rio Tinto') return rioRealNews();
  if (name === 'Fortescue') return fmgRealNews();
  if (name === 'South32') return s32RealNews();
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
