// Illustrative in-app news feed per company. Headlines are generated from the
// company's name + sector so each card feels bespoke; all content is fictional
// placeholder copy for demonstration.

export interface NewsItem {
  cat: string;
  title: string;
  time: string;
  comments: number;
  // Optional real article link + image. When `url` is a genuine publisher
  // article, the news panel scrapes that page's og:image on the Worker for a
  // real thumbnail (see lib/articleImageFn.ts); when absent the card links to a
  // Google-News search for the headline and shows a deterministic stock photo.
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
      url: 'https://www.bhp.com/news/media-centre/releases/2026/03/brandon-craig-to-succeed-mike-henry-as-bhp-ceo',
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
      url: 'https://www.riotinto.com/en/news/releases/2025/simandou-partners-celebrate-start-of-operations',
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
      url: 'https://www.mining.com/web/fortescue-forecasts-higher-annual-iron-ore-shipments/',
    },
    items: [
      { cat: 'Markets', title: 'Record first-half shipments of 100.2Mt, up 3% year-on-year', time: '6d ago', comments: 17 },
      { cat: 'People', title: 'Fortescue cuts ~700 roles as it slows green-hydrogen plans', time: '1w ago', comments: 52, url: 'https://www.miningweekly.com/article/fortescue-scales-back-hydrogen-ambitions-iron-ore-shipments-at-record-2025-07-24' },
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
      url: 'https://www.mining.com/south32s-hermosa-project-advances-in-federal-permitting/',
    },
    items: [
      { cat: 'Markets', title: 'Hermosa wins $166M US Department of Energy battery-materials grant', time: '1w ago', comments: 12 },
      { cat: 'Company', title: 'Taylor zinc-manganese deposit on track for first production in FY2027', time: '2w ago', comments: 8 },
      { cat: 'Markets', title: 'FY24 revenue US$5.6B, underlying EBITDA US$1.8B on softer prices', time: '3w ago', comments: 10 },
      { cat: 'Sustainability', title: 'Manganese positioned as a US battery-supply-chain opportunity', time: '3w ago', comments: 6 },
    ],
  };
}

// The remaining listed Perth resources names also get real, dated headlines
// drawn from their newsrooms and wire coverage (company sites, MINING.COM,
// Australian Mining, Mining Weekly, natural-gas & LNG trade press — 2025/2026),
// in place of the generated placeholder copy.
function wdsRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Woodside’s Scarborough passes 96% complete, on track for first LNG cargo in Q4 2026',
      time: '3d ago',
      comments: 27,
      url: 'https://lngprime.com/australia-and-oceania/woodside-expects-first-scarborough-lng-cargo-in-h2-2026/144621/',
    },
    items: [
      { cat: 'Company', title: 'Louisiana LNG reaches 24% complete as Woodside runs its sell-down process', time: '5d ago', comments: 18 },
      { cat: 'Markets', title: 'Trion oil development offshore Mexico passes 56% completion', time: '1w ago', comments: 12 },
      { cat: 'Sector', title: 'Bechtel sources Louisiana LNG structural steel from the UAE to protect schedule', time: '2w ago', comments: 9 },
      { cat: 'People', title: 'Woodside flags tighter market for LNG commissioning and subsea talent', time: '2w ago', comments: 14 },
    ],
  };
}

function stoRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Santos exports first Barossa gas to Darwin LNG as flagship project starts up',
      time: '4d ago',
      comments: 31,
      url: 'https://lngprime.com/australia-and-oceania/santos-says-barossa-fpso-receives-first-gas/163898/',
    },
    items: [
      { cat: 'Markets', title: 'ADNOC-led XRG consortium walks away from $36B Santos takeover', time: '1w ago', comments: 58 },
      { cat: 'Company', title: 'Pikka oil project on Alaska’s North Slope moves into production', time: '2w ago', comments: 16 },
      { cat: 'Markets', title: 'Shares trade near the top of a A$5.90–A$8.24 range as projects come online', time: '2w ago', comments: 11 },
      { cat: 'Sector', title: 'Barossa FPSO ramp-up to underpin Darwin LNG feed gas', time: '3w ago', comments: 8 },
    ],
  };
}

function chevronRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Chevron says Gorgon and Wheatstone now supply ~40% of WA’s domestic gas',
      time: '5d ago',
      comments: 19,
      url: 'https://lngprime.com/australia-and-oceania/chevron-pens-western-australian-gas-supply-deal-with-alinta/191667/',
    },
    items: [
      { cat: 'Sustainability', title: 'Gorgon CCS on Barrow Island passes 10.5Mt of CO₂ stored since 2019', time: '1w ago', comments: 22 },
      { cat: 'Markets', title: 'Chevron to keep supplying gas to WA utility Alinta under new deal', time: '1w ago', comments: 10, url: 'https://www.offshore-technology.com/news/chevron-supply-deal-alinta-energy/' },
      { cat: 'Company', title: 'Chevron takes Woodside’s 13% Wheatstone stake in operatorship swap', time: '3w ago', comments: 13 },
      { cat: 'Sustainability', title: 'JV to explore new carbon storage near Barrow Island', time: '3w ago', comments: 7 },
    ],
  };
}

function sfrRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Sandfire completes MATSA buyout, taking 100% of the Tier-1 Spanish copper complex',
      time: '4d ago',
      comments: 15,
      url: 'https://www.miningweekly.com/article/sandfire-retains-fy26-guidance-2026-01-22',
    },
    items: [
      { cat: 'Markets', title: 'Sandfire holds FY26 guidance as MATSA strength offsets Motheo hurdles', time: '1w ago', comments: 12 },
      { cat: 'Company', title: 'Group copper-equivalent output of 72,100t in H1 FY26, second-half weighted', time: '2w ago', comments: 8 },
      { cat: 'Sustainability', title: '21MW solar plant signed for the Motheo copper mine in Botswana', time: '2w ago', comments: 6 },
      { cat: 'Sector', title: 'A4 open pit ramps up as Motheo expansion advances', time: '3w ago', comments: 5 },
    ],
  };
}

function igoRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'IGO trims Greenbushes FY26 lithium guidance to 1,375–1,425kt of spodumene',
      time: '3d ago',
      comments: 21,
      url: 'https://www.miningweekly.com/article/worlds-biggest-lithium-mine-gets-downgrade-on-systemic-issues-2026-04-24',
    },
    items: [
      { cat: 'Markets', title: 'Q3 revenue jumps 45% to A$119.7M even as nickel and lithium prices stay weak', time: '6d ago', comments: 14, url: 'https://www.mining.com/web/australias-igo-posts-45-sequential-increase-in-q3-revenue/' },
      { cat: 'Company', title: 'Nova nickel nears end of mine life, with closure plan due to DMIRS by mid-2026', time: '1w ago', comments: 19 },
      { cat: 'Sector', title: 'Greenbushes stake keeps IGO tied to the world’s lowest-cost hard-rock lithium', time: '2w ago', comments: 9 },
      { cat: 'Markets', title: 'Shares stay near the low end of a A$4.10–A$10.05 range on battery-metals pressure', time: '2w ago', comments: 7 },
    ],
  };
}

function minRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Mineral Resources back in the black as Onslow Iron hits 35Mtpa nameplate',
      time: '2d ago',
      comments: 44,
      url: 'https://www.miningweekly.com/article/mineral-resources-hits-35mtpa-at-onslow-iron-2025-10-30',
    },
    items: [
      { cat: 'Markets', title: 'Record H1: revenue $3.1B and net profit $573M as net debt falls to $4.9B', time: '5d ago', comments: 26 },
      { cat: 'Company', title: 'Wodgina lithium output up 65% to 173,000t; MinRes turns bullish on lithium', time: '1w ago', comments: 18 },
      { cat: 'People', title: 'Governance review into founder Chris Ellison escalates to the ATO', time: '1w ago', comments: 63 },
      { cat: 'Markets', title: 'Shares rally toward a A$74.94 high after a A$23.46 low', time: '2w ago', comments: 15 },
    ],
  };
}

function plsRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Pilbara Minerals advances P2000 expansion with a A$1.2B new flotation plant',
      time: '3d ago',
      comments: 24,
      url: 'https://mining.com.au/pilbara-minerals-outlines-2-million-tonne-expansion-at-pilgangoora/',
    },
    items: [
      { cat: 'Company', title: 'Ngungaju 200ktpa plant readied for restart within four months, pending board approval', time: '6d ago', comments: 15, url: 'https://www.australianmining.com.au/pilbara-minerals-ignites-ngungaju-plant-comeback-as-lithium-rebounds/' },
      { cat: 'Markets', title: 'Pilgangoora ships 208,000t of spodumene as recoveries hold at 76%', time: '1w ago', comments: 12 },
      { cat: 'Sector', title: 'P2000 study flags $2.6B incremental NPV and a 55% IRR', time: '2w ago', comments: 10 },
      { cat: 'Markets', title: 'Cash balance of $954M underpins the growth pipeline as lithium thaws', time: '2w ago', comments: 8 },
    ],
  };
}

function ltrRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Liontown completes Kathleen Valley’s move to underground — Australia’s first underground lithium mine',
      time: '4d ago',
      comments: 20,
      url: 'https://www.mining.com/liontown-kicks-off-production-at-australias-first-underground-lithium-mine/',
    },
    items: [
      { cat: 'Company', title: 'Kathleen Valley hits a 1.5Mtpa run rate, targeting 2.8Mtpa steady state by FY27', time: '1w ago', comments: 14 },
      { cat: 'Markets', title: 'Liontown commits A$12M to long-lead gear for a 4.0Mtpa expansion', time: '2w ago', comments: 11 },
      { cat: 'Sector', title: 'FID on the 4.0Mtpa expansion flagged for around Q1 FY27', time: '2w ago', comments: 9 },
      { cat: 'Markets', title: 'Shares recover toward A$2.65 after a A$0.55 low as lithium sentiment turns', time: '3w ago', comments: 13 },
    ],
  };
}

function iluRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Iluka’s Eneabba rare-earths refinery passes 50% built, commissioning set for 2027',
      time: '3d ago',
      comments: 17,
      url: 'https://www.miningweekly.com/article/eneabba-rare-earths-refinery-australia-update-2026-06-26',
    },
    items: [
      { cat: 'Company', title: 'First rare-earths offtake: multi-year NdPr, Dy and Tb supply to a global automaker from 2028', time: '1w ago', comments: 13 },
      { cat: 'Sector', title: 'Eneabba to be Australia’s first fully integrated rare-earths refinery outside China', time: '2w ago', comments: 15 },
      { cat: 'Markets', title: 'A$1.65B non-recourse government loan backs the Eneabba build', time: '2w ago', comments: 9 },
      { cat: 'Company', title: 'Wimmera earmarked as future zircon and rare-earths feedstock', time: '3w ago', comments: 6 },
    ],
  };
}

function nstRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Northern Star folds De Grey’s Hemi into group reserves, lifting them 27%',
      time: '2d ago',
      comments: 29,
      url: 'https://www.australianmining.com.au/northern-star-lifts-gold-inventory-as-hemi-drives-major-growth',
    },
    items: [
      { cat: 'Markets', title: 'March quarter: ~381,000oz sold at an AISC of A$2,709/oz', time: '6d ago', comments: 17 },
      { cat: 'Company', title: 'Kalgoorlie resources climb 3.3Moz to 42.2Moz, led by KCGM', time: '1w ago', comments: 12 },
      { cat: 'Markets', title: 'Shares hammered on another FY26 production downgrade', time: '1w ago', comments: 34, url: 'https://www.miningweekly.com/article/northern-star-shares-hammered-on-another-production-downgrade-2026-03-13' },
      { cat: 'Company', title: 'A$140–150M earmarked to develop Hemi in the Pilbara', time: '2w ago', comments: 10 },
    ],
  };
}

export function companyNews(name: string, sector: string): CompanyNews {
  if (name === 'BHP') return bhpRealNews();
  if (name === 'Rio Tinto') return rioRealNews();
  if (name === 'Fortescue') return fmgRealNews();
  if (name === 'South32') return s32RealNews();
  if (name === 'Woodside Energy') return wdsRealNews();
  if (name === 'Santos') return stoRealNews();
  if (name === 'Chevron') return chevronRealNews();
  if (name === 'Sandfire Resources') return sfrRealNews();
  if (name === 'IGO') return igoRealNews();
  if (name === 'Mineral Resources') return minRealNews();
  if (name === 'Pilbara Minerals') return plsRealNews();
  if (name === 'Liontown Resources') return ltrRealNews();
  if (name === 'Iluka Resources') return iluRealNews();
  if (name === 'Northern Star Resources') return nstRealNews();
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
