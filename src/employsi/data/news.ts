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
  // Set when the item comes from the live Google-News feed: the publisher name
  // and publish timestamp arrive with the feed, so they don't need scraping.
  publisher?: string;
  publishedIso?: string;
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

// The listed Perth resources names each get a real, dated news feed: every
// story here is a genuine, published article (company newsrooms + wire coverage
// — MINING.COM, Mining Weekly, LNG Prime, Australian Mining, natural-gas/LNG
// trade press, 2025/2026). Because each item carries its real article URL, the
// news panel links straight to the source and scrapes that page's og:image,
// publish date and publisher on the Worker (see lib/articleImageFn.ts). The
// `time` label is only a fallback shown until the live date resolves.
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
      { cat: 'Markets', title: 'BHP now expects nearly 2Mt copper after record Escondida throughput', time: '5h ago', comments: 21, url: 'https://www.mining.com/bhp-now-expects-nearly-2m-tonnes-copper-production-after-record-escondida-throughput/' },
      { cat: 'Company', title: 'BHP reports results for the half year ended 31 December 2025', time: '1d ago', comments: 18, url: 'https://www.bhp.com/news/media-centre/releases/2026/02/bhp-results-for-the-half-year-ended-31-december-2025' },
      { cat: 'People', title: 'BHP updates its executive leadership team under Brandon Craig', time: '3d ago', comments: 9, url: 'https://www.bhp.com/news/media-centre/releases/2026/06/bhp-executive-leadership-team-update' },
      { cat: 'Markets', title: 'BHP shares slide as the Escondida copper expansion is overshadowed', time: '2d ago', comments: 16, url: 'https://thebull.com.au/news/bhp-shares-slide-as-escondida-copper-expansion-overshadowed/' },
    ],
  };
}

function rioRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Rio Tinto ships first ore from the Simandou iron-ore mega-project in Guinea',
      time: '4d ago',
      comments: 41,
      url: 'https://www.riotinto.com/en/news/releases/2025/simandou-partners-celebrate-start-of-operations',
    },
    items: [
      { cat: 'Markets', title: 'Simandou’s first boat heads for China as the iron-ore shake-up begins', time: '1w ago', comments: 33, url: 'https://www.mining.com/web/iron-ore-shakeup-begins-as-simandous-first-boat-heads-for-china/' },
      { cat: 'Company', title: 'China receives its first shipment of Simandou iron ore', time: '2w ago', comments: 22, url: 'https://www.mining.com/web/china-receives-first-shipment-of-simandou-iron-ore/' },
      { cat: 'Markets', title: 'Guinea’s Simandou iron exports surge six months after first ore', time: '2w ago', comments: 14, url: 'https://www.mining.com/web/guineas-simandou-iron-exports-surge-six-months-after-first-ore/' },
      { cat: 'Company', title: 'Rio Tinto ramps up Simandou stockpiles ahead of first shipments', time: '3w ago', comments: 11, url: 'https://www.mining.com/web/rio-tinto-ramps-up-simandou-stockpiles-to-2-million-tonnes-for-first-shipment/' },
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
      { cat: 'Markets', title: 'Fortescue celebrates a 200-million-tonne shipping record', time: '6d ago', comments: 17, url: 'https://www.fortescue.com/en/articles/fortescue-celebrates-200-million-tonne-shipping-record' },
      { cat: 'People', title: 'Fortescue scales back hydrogen ambitions as iron-ore shipments hit a record', time: '1w ago', comments: 52, url: 'https://www.miningweekly.com/article/fortescue-scales-back-hydrogen-ambitions-iron-ore-shipments-at-record-2025-07-24' },
      { cat: 'Markets', title: 'Fortescue hits a record 200-million-tonne iron-ore export year', time: '1w ago', comments: 24, url: 'https://www.thedcn.com.au/news/fortescue-hits-record-200-million-tonne-iron-ore-export' },
      { cat: 'Company', title: 'Inside Fortescue’s 200-million-tonne iron-ore milestone', time: '2w ago', comments: 19, url: 'https://www.australianmining.com.au/fortescues-200-million-tonne-iron-ore-milestone/' },
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
      { cat: 'Markets', title: 'March quarter: Cannington lifts payable zinc-equivalent 13%, Worsley up 2%', time: '1w ago', comments: 12, url: 'https://www.south32.net/news-media/latest-news/quarterly-report-march-2026' },
      { cat: 'Company', title: 'South32’s Australian operations bounce back after a soft start', time: '2w ago', comments: 9, url: 'https://www.australianmining.com.au/south32s-australian-operations-bounce-back' },
      { cat: 'Markets', title: 'Citi upgrade and Hermosa progress shape South32’s copper and aluminium upside', time: '3w ago', comments: 8, url: 'https://simplywall.st/community/narratives/au/materials/asx-s32/south32-shares/uvuoaioq-s32-upcoming-asset-sale-and-production-outlook-will-affect-future-returns' },
      { cat: 'Sector', title: 'South32 back on the diversified-miner radar', time: '3w ago', comments: 6, url: 'https://kalkine.com.au/news/mining/south32-asxs32-the-diversified-miner-back-on-investor-radar' },
    ],
  };
}

function wdsRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Woodside expects first Scarborough LNG cargo in H2 2026 as project passes 96% complete',
      time: '3d ago',
      comments: 27,
      url: 'https://lngprime.com/australia-and-oceania/woodside-expects-first-scarborough-lng-cargo-in-h2-2026/144621/',
    },
    items: [
      { cat: 'Company', title: 'Construction progresses on Woodside’s Scarborough and Louisiana LNG projects', time: '5d ago', comments: 18, url: 'https://lngprime.com/australia-and-oceania/construction-progresses-on-woodsides-scarborough-and-louisiana-lng-projects/184854/' },
      { cat: 'Markets', title: 'Scarborough LNG on track for Q4 2026; Louisiana LNG targets 2029', time: '1w ago', comments: 12, url: 'https://pgjonline.com/news/2026/january/woodside-scarborough-lng-on-track-for-q4-2026-louisiana-lng-targets-2029' },
      { cat: 'Company', title: 'Fast Five: the lowdown on Woodside’s Louisiana LNG', time: '2w ago', comments: 9, url: 'https://www.woodside.com/media-centre/news-stories/story/fast-five--the-lowdown-on-louisiana-lng' },
      { cat: 'Sector', title: 'Woodside firing on all cylinders across Australia, Mexico and the US', time: '2w ago', comments: 14, url: 'https://www.offshore-energy.biz/woodside-firing-on-all-cylinders-to-advance-australian-gas-project-mexican-oil-development-and-us-lng-terminal/' },
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
      { cat: 'Markets', title: 'ADNOC-led XRG consortium walks away from the $36B Santos takeover', time: '1w ago', comments: 58, url: 'https://www.capitalbrief.com/briefing/adnoc-led-consortium-pulls-bid-collapsing-36b-santos-takeover-reports-694c3ca3-583e-4479-af39-ce600eff42fa/' },
      { cat: 'Company', title: 'Santos expects Barossa gas supply to Darwin LNG in coming months', time: '2w ago', comments: 16, url: 'https://naturalgasintel.com/news/santos-expects-barossa-natural-gas-production-supply-to-darwin-lng-in-coming-months/' },
      { cat: 'Markets', title: 'Santos shifts blame to ADNOC’s XRG as the takeover deal collapses', time: '2w ago', comments: 11, url: 'https://www.energyintel.com/00000199-5b88-d6fb-a3fb-5f9db4d60000' },
      { cat: 'Sector', title: 'Santos narrows production, keeps a year-end LNG start in sight', time: '3w ago', comments: 8, url: 'https://naturalgasintel.com/news/santos-narrows-production-keeps-year-end-lng-start-in-sight-amid-steadying-global-gas-prices/' },
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
      { cat: 'Markets', title: 'Chevron signs a new five-year WA gas-supply deal with Alinta Energy', time: '1w ago', comments: 22, url: 'https://www.offshore-technology.com/news/chevron-supply-deal-alinta-energy/' },
      { cat: 'Company', title: 'Downer wins a contract for Chevron’s Wheatstone and Gorgon facilities', time: '1w ago', comments: 10, url: 'https://lngprime.com/australia-and-oceania/downer-wins-contract-for-chevrons-wheatstone-and-gorgon-facilities/168487/' },
      { cat: 'Markets', title: 'Chevron secures a long-term WA gas-supply deal with Horizon Power', time: '3w ago', comments: 13, url: 'https://finance.yahoo.com/news/chevron-secures-long-term-gas-124500605.html' },
      { cat: 'Sector', title: 'Inside Chevron’s Wheatstone LNG and domestic-gas project', time: '3w ago', comments: 7, url: 'https://australia.chevron.com/what-we-do/wheatstone-project' },
    ],
  };
}

function sfrRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Sandfire holds FY26 copper guidance as MATSA strength offsets Motheo hurdles',
      time: '4d ago',
      comments: 15,
      url: 'https://www.tipranks.com/news/company-announcements/sandfire-holds-fy26-copper-output-guidance-as-matsa-strength-offsets-motheo-hurdles',
    },
    items: [
      { cat: 'Markets', title: 'Sandfire retains FY26 production, cost and capex guidance', time: '1w ago', comments: 12, url: 'https://www.miningweekly.com/article/sandfire-retains-fy26-guidance-2026-01-22' },
      { cat: 'Sustainability', title: '21MW solar plant signed for the Motheo copper mine in Botswana', time: '2w ago', comments: 8, url: 'https://www.scatec.com/en/release-signs-lease-agreement-for-a-21-mw-solar-plant-at-motheo-copper-mine-in-botswana/' },
      { cat: 'Company', title: 'Inside Sandfire’s Motheo copper-mine triumph', time: '2w ago', comments: 6, url: 'https://www.miningreview.com/magazine-article/sandfires-motheo-copper-mine-triumph/' },
      { cat: 'Markets', title: 'Copper miners navigate a challenging March quarter', time: '3w ago', comments: 5, url: 'https://discoveryalert.com.au/copper-mining-operations-navigate-challenges-2026/' },
    ],
  };
}

function igoRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'IGO trims Greenbushes FY26 lithium guidance on systemic issues at the world’s biggest mine',
      time: '3d ago',
      comments: 21,
      url: 'https://www.miningweekly.com/article/worlds-biggest-lithium-mine-gets-downgrade-on-systemic-issues-2026-04-24',
    },
    items: [
      { cat: 'Markets', title: 'IGO shares dive as the guidance cut overshadows strong cash flow', time: '6d ago', comments: 14, url: 'https://thebull.com.au/news/igo-shares-dive-as-guidance-cut-overshadows-strong-cash-flow/' },
      { cat: 'Company', title: 'IGO to divest the Nova nickel operation to Global Lithium for A$7M', time: '1w ago', comments: 19, url: 'https://www.tipranks.com/news/company-announcements/igo-to-divest-nova-nickel-operation-to-global-lithium-for-a7m' },
      { cat: 'Markets', title: 'IGO Q3 revenue jumps 45% even as battery-metal prices stay weak', time: '2w ago', comments: 9, url: 'https://www.mining.com/web/australias-igo-posts-45-sequential-increase-in-q3-revenue/' },
      { cat: 'Sector', title: 'Systemic problems at Greenbushes drive IGO’s 2026 guidance cut', time: '2w ago', comments: 7, url: 'https://discoveryalert.com.au/igo-greenbushes-systemic-problems-lithium-guidance-cut-2026/' },
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
      { cat: 'Markets', title: 'Onslow iron and lithium propel a record MinRes result', time: '5d ago', comments: 26, url: 'https://miningmagazine.com.au/onslow-iron-lithium-propel-minres-record/' },
      { cat: 'Company', title: 'Ellison heralds a balance-sheet transformation as MinRes returns to profit', time: '1w ago', comments: 18, url: 'https://thenightly.com.au/business/mining/chris-ellison-heralds-balance-sheet-transformation-with-miner-back-in-black-thanks-to-onslow-lithium-boost--c-21698937' },
      { cat: 'People', title: 'Governance uncertainty over founder Chris Ellison persists', time: '1w ago', comments: 63, url: 'https://discoveryalert.com.au/mineral-resources-ceo-uncertainty-governance-onslow-iron-2026/' },
      { cat: 'Markets', title: 'MinRes turns bullish on lithium again', time: '2w ago', comments: 15, url: 'https://stockhead.com.au/resources/minres-and-chris-ellison-dodging-missiles-turn-bullish-again-on-lithium/' },
    ],
  };
}

function plsRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Pilbara Minerals outlines a 2-million-tonne P2000 expansion at Pilgangoora',
      time: '3d ago',
      comments: 24,
      url: 'https://mining.com.au/pilbara-minerals-outlines-2-million-tonne-expansion-at-pilgangoora/',
    },
    items: [
      { cat: 'Company', title: 'Pilbara Minerals approves the Ngungaju plant restart', time: '6d ago', comments: 15, url: 'https://pls.com/news-stories/ngungaju-restart-approved/' },
      { cat: 'Markets', title: 'PLS primed for growth as the lithium winter starts to thaw', time: '1w ago', comments: 12, url: 'https://www.mining.com/australias-pls-primed-for-growth-as-lithium-winter-starts-to-thaw/' },
      { cat: 'Sector', title: 'PLS ignites the Ngungaju plant comeback as lithium rebounds', time: '2w ago', comments: 10, url: 'https://www.australianmining.com.au/pilbara-minerals-ignites-ngungaju-plant-comeback-as-lithium-rebounds/' },
      { cat: 'Company', title: 'PLS eyes a Pilbara lithium ramp-up', time: '2w ago', comments: 8, url: 'https://www.australianmining.com.au/pls-eyes-pilbara-lithium-ramp-up/' },
    ],
  };
}

function ltrRealNews(): CompanyNews {
  return {
    hero: {
      cat: 'Trending',
      title: 'Liontown kicks off production at Australia’s first underground lithium mine',
      time: '4d ago',
      comments: 20,
      url: 'https://www.mining.com/liontown-kicks-off-production-at-australias-first-underground-lithium-mine/',
    },
    items: [
      { cat: 'Company', title: 'Liontown opens the Kathleen Valley lithium operation', time: '1w ago', comments: 14, url: 'https://www.mining-technology.com/news/liontown-resources-kathleen-valley-lithium-2/' },
      { cat: 'Markets', title: 'Liontown starts early works for the Kathleen Valley expansion', time: '2w ago', comments: 11, url: 'https://resourcesreview.com.au/projects/liontown-starts-early-works-for-kathleen-valley-expansion/' },
      { cat: 'Sector', title: 'Liontown looks at a Kathleen Valley expansion to 4.0Mtpa', time: '2w ago', comments: 9, url: 'https://www.miningnews.net/miners/news-analysis/4526359/liontown-looking-kathleen-valley-expansion' },
      { cat: 'Company', title: 'Kathleen Valley underground ramp-up: production and cost lens', time: '3w ago', comments: 13, url: 'https://www.geomechanics.io/news/article/liontowns-kathleen-valley-underground-ramp-up-production-and-cost-lens-for-engineers' },
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
      { cat: 'Company', title: 'Iluka locks in rare-earths demand as Eneabba advances', time: '1w ago', comments: 13, url: 'https://miningmagazine.com.au/iluka-locks-in-rare-earths-demand-as-eneabba-advances/' },
      { cat: 'Sector', title: 'Australia’s first integrated rare-earths refinery takes shape', time: '2w ago', comments: 15, url: 'https://australianminingreview.com.au/issue/2026/01/australias-first-integrated-rare-earths-refinery/' },
      { cat: 'Markets', title: 'Iluka Resources: Eneabba and the 2026 guide', time: '2w ago', comments: 9, url: 'https://rare-earth-mining.com/iluka-resources/' },
      { cat: 'Company', title: 'Eneabba resource-development update', time: '3w ago', comments: 6, url: 'https://www.iluka.com/operations-resource-development/resource-development/eneabba/' },
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
      { cat: 'Markets', title: 'Northern Star shares hammered on another FY26 production downgrade', time: '6d ago', comments: 34, url: 'https://www.miningweekly.com/article/northern-star-shares-hammered-on-another-production-downgrade-2026-03-13' },
      { cat: 'Company', title: 'Northern Star hits major gold across all hubs', time: '1w ago', comments: 17, url: 'https://www.australianmining.com.au/northern-star-hits-major-gold-across-all-hubs/' },
      { cat: 'Company', title: 'Kalgoorlie shines as Northern Star ramps up expansion', time: '1w ago', comments: 12, url: 'https://www.australianmining.com.au/kalgoorlie-shines-as-northern-star-ramps-up-expansion/' },
      { cat: 'Sector', title: 'What the Northern Star–De Grey deal means for Aussie gold', time: '2w ago', comments: 10, url: 'https://www.australianmining.com.au/what-the-northern-star-de-grey-deal-means-for-aussie-gold/' },
    ],
  };
}

// Companies with a hand-curated real feed above. Everyone else falls back to
// the live Google-News feed (see NewsPanel), then to generated copy.
export const CURATED_NEWS_COMPANIES = new Set([
  'BHP', 'Rio Tinto', 'Fortescue', 'South32', 'Woodside Energy', 'Santos',
  'Chevron', 'Sandfire Resources', 'IGO', 'Mineral Resources',
  'Pilbara Minerals', 'Liontown Resources', 'Iluka Resources', 'Northern Star Resources',
]);

// Build a CompanyNews card from live Google-News items: the first is the hero,
// the next few are the list. Publisher + publish date ride along with each item
// so the card shows them directly (no scraping needed).
export function liveToCompanyNews(
  items: { title: string; url: string; publisher: string; published: string; image?: string }[],
): CompanyNews | null {
  if (!items.length) return null;
  const toItem = (a: (typeof items)[number], cat: string): NewsItem => ({
    cat,
    title: a.title,
    time: '',
    comments: 0,
    url: a.url,
    image: a.image,
    publisher: a.publisher,
    publishedIso: a.published,
  });
  return {
    hero: toItem(items[0], 'Trending'),
    items: items.slice(1, 5).map((a) => toItem(a, 'News')),
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
