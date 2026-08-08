// Illustrative in-app news feed per company. Headlines are generated from the
// company's name + sector so each card feels bespoke; all content is fictional
// placeholder copy for demonstration.

export interface NewsItem {
  cat: string;
  title: string;
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
  // Where the item came from. "post" is the employer's OWN LinkedIn publication
  // rather than a publisher reporting on them, and the card tags it visibly —
  // an announcement and a news report are different kinds of claim, and a
  // reader who cannot tell them apart is being misled by the layout.
  kind?: "news" | "post";
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

const CATS = ["Markets", "Company", "Sector", "People", "Sustainability"];

// The listed Perth resources names each get a real, dated news feed: every
// story here is a genuine, published article (company newsrooms + wire coverage
// — MINING.COM, Mining Weekly, LNG Prime, Australian Mining, natural-gas/LNG
// trade press, 2025/2026). Because each item carries its real article URL, the
// news panel links straight to the source and scrapes that page's og:image,
// publish date and publisher on the Worker (see lib/articleImageFn.ts).
//
// `publishedIso` is that scrape done ONCE and written down, for the 40 of these
// 70 articles that publish a machine-readable date. It is here rather than left
// to the live scrape because the live one fails often enough to matter — BHP's
// newsroom times out, TipRanks 403s a Worker, and Rio's releases carry no date
// meta at all — and what used to fill that gap was a hardcoded "2d ago".
function bhpRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Brandon Craig becomes BHP chief executive as leadership transition completes",
      comments: 34,
      url: "https://www.bhp.com/news/media-centre/releases/2026/03/brandon-craig-to-succeed-mike-henry-as-bhp-ceo",
    },
    items: [
      {
        cat: "Markets",
        title: "BHP now expects nearly 2Mt copper after record Escondida throughput",
        comments: 21,
        url: "https://www.mining.com/bhp-now-expects-nearly-2m-tonnes-copper-production-after-record-escondida-throughput/",
        publishedIso: "2026-04-22T07:44:27Z",
      },
      {
        cat: "Company",
        title: "BHP reports results for the half year ended 31 December 2025",
        comments: 18,
        url: "https://www.bhp.com/news/media-centre/releases/2026/02/bhp-results-for-the-half-year-ended-31-december-2025",
      },
      {
        cat: "People",
        title: "BHP updates its executive leadership team under Brandon Craig",
        comments: 9,
        url: "https://www.bhp.com/news/media-centre/releases/2026/06/bhp-executive-leadership-team-update",
      },
      {
        cat: "Markets",
        title: "BHP shares slide as the Escondida copper expansion is overshadowed",
        comments: 16,
        url: "https://thebull.com.au/news/bhp-shares-slide-as-escondida-copper-expansion-overshadowed/",
      },
    ],
  };
}

function rioRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Rio Tinto ships first ore from the Simandou iron-ore mega-project in Guinea",
      comments: 41,
      url: "https://www.riotinto.com/en/news/releases/2025/simandou-partners-celebrate-start-of-operations",
    },
    items: [
      {
        cat: "Markets",
        title: "Simandou’s first boat heads for China as the iron-ore shake-up begins",
        comments: 33,
        url: "https://www.mining.com/web/iron-ore-shakeup-begins-as-simandous-first-boat-heads-for-china/",
        publishedIso: "2025-12-03T15:24:21Z",
      },
      {
        cat: "Company",
        title: "China receives its first shipment of Simandou iron ore",
        comments: 22,
        url: "https://www.mining.com/web/china-receives-first-shipment-of-simandou-iron-ore/",
        publishedIso: "2026-01-18T17:13:03Z",
      },
      {
        cat: "Markets",
        title: "Guinea’s Simandou iron exports surge six months after first ore",
        comments: 14,
        url: "https://www.mining.com/web/guineas-simandou-iron-exports-surge-six-months-after-first-ore/",
        publishedIso: "2026-06-03T14:18:40Z",
      },
      {
        cat: "Company",
        title: "Rio Tinto ramps up Simandou stockpiles ahead of first shipments",
        comments: 11,
        url: "https://www.mining.com/web/rio-tinto-ramps-up-simandou-stockpiles-to-2-million-tonnes-for-first-shipment/",
        publishedIso: "2025-10-17T15:30:02Z",
      },
    ],
  };
}

function fmgRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Fortescue ships 200 million tonnes of iron ore in a year for the first time",
      comments: 28,
      url: "https://www.mining.com/web/fortescue-forecasts-higher-annual-iron-ore-shipments/",
      publishedIso: "2024-07-24T23:33:23Z",
    },
    items: [
      {
        cat: "Markets",
        title: "Fortescue celebrates a 200-million-tonne shipping record",
        comments: 17,
        url: "https://www.fortescue.com/en/articles/fortescue-celebrates-200-million-tonne-shipping-record",
      },
      {
        cat: "People",
        title: "Fortescue scales back hydrogen ambitions as iron-ore shipments hit a record",
        comments: 52,
        url: "https://www.miningweekly.com/article/fortescue-scales-back-hydrogen-ambitions-iron-ore-shipments-at-record-2025-07-24",
        publishedIso: "2025-07-24T09:00:00Z",
      },
      {
        cat: "Markets",
        title: "Fortescue hits a record 200-million-tonne iron-ore export year",
        comments: 24,
        url: "https://www.thedcn.com.au/news/fortescue-hits-record-200-million-tonne-iron-ore-export",
        publishedIso: "2026-06-30T02:43:15Z",
      },
      {
        cat: "Company",
        title: "Inside Fortescue’s 200-million-tonne iron-ore milestone",
        comments: 19,
        url: "https://www.australianmining.com.au/fortescues-200-million-tonne-iron-ore-milestone/",
      },
    ],
  };
}

function s32RealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title:
        "South32’s Hermosa becomes the first mine added to the US federal permitting dashboard in a decade",
      comments: 16,
      url: "https://www.mining.com/south32s-hermosa-project-advances-in-federal-permitting/",
      publishedIso: "2025-05-09T17:53:59Z",
    },
    items: [
      {
        cat: "Markets",
        title: "March quarter: Cannington lifts payable zinc-equivalent 13%, Worsley up 2%",
        comments: 12,
        url: "https://www.south32.net/news-media/latest-news/quarterly-report-march-2026",
      },
      {
        cat: "Company",
        title: "South32’s Australian operations bounce back after a soft start",
        comments: 9,
        url: "https://www.australianmining.com.au/south32s-australian-operations-bounce-back",
      },
      {
        cat: "Markets",
        title: "Citi upgrade and Hermosa progress shape South32’s copper and aluminium upside",
        comments: 8,
        url: "https://simplywall.st/community/narratives/au/materials/asx-s32/south32-shares/uvuoaioq-s32-upcoming-asset-sale-and-production-outlook-will-affect-future-returns",
        publishedIso: "2025-04-25T20:10:06.213000Z",
      },
      {
        cat: "Sector",
        title: "South32 back on the diversified-miner radar",
        comments: 6,
        url: "https://kalkine.com.au/news/mining/south32-asxs32-the-diversified-miner-back-on-investor-radar",
        publishedIso: "2026-06-23T07:11:00Z",
      },
    ],
  };
}

function wdsRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title:
        "Woodside expects first Scarborough LNG cargo in H2 2026 as project passes 96% complete",
      comments: 27,
      url: "https://lngprime.com/australia-and-oceania/woodside-expects-first-scarborough-lng-cargo-in-h2-2026/144621/",
      publishedIso: "2025-03-12T10:15:53Z",
    },
    items: [
      {
        cat: "Company",
        title: "Construction progresses on Woodside’s Scarborough and Louisiana LNG projects",
        comments: 18,
        url: "https://lngprime.com/australia-and-oceania/construction-progresses-on-woodsides-scarborough-and-louisiana-lng-projects/184854/",
        publishedIso: "2026-04-29T06:02:33Z",
      },
      {
        cat: "Markets",
        title: "Scarborough LNG on track for Q4 2026; Louisiana LNG targets 2029",
        comments: 12,
        url: "https://pgjonline.com/news/2026/january/woodside-scarborough-lng-on-track-for-q4-2026-louisiana-lng-targets-2029",
      },
      {
        cat: "Company",
        title: "Fast Five: the lowdown on Woodside’s Louisiana LNG",
        comments: 9,
        url: "https://www.woodside.com/media-centre/news-stories/story/fast-five--the-lowdown-on-louisiana-lng",
      },
      {
        cat: "Sector",
        title: "Woodside firing on all cylinders across Australia, Mexico and the US",
        comments: 14,
        url: "https://www.offshore-energy.biz/woodside-firing-on-all-cylinders-to-advance-australian-gas-project-mexican-oil-development-and-us-lng-terminal/",
        publishedIso: "2026-04-29T11:26:18Z",
      },
    ],
  };
}

function stoRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Santos exports first Barossa gas to Darwin LNG as flagship project starts up",
      comments: 31,
      url: "https://lngprime.com/australia-and-oceania/santos-says-barossa-fpso-receives-first-gas/163898/",
      publishedIso: "2025-09-22T08:03:05Z",
    },
    items: [
      {
        cat: "Markets",
        title: "ADNOC-led XRG consortium walks away from the $36B Santos takeover",
        comments: 58,
        url: "https://www.capitalbrief.com/briefing/adnoc-led-consortium-pulls-bid-collapsing-36b-santos-takeover-reports-694c3ca3-583e-4479-af39-ce600eff42fa/",
        publishedIso: "2025-09-17T11:45:56Z",
      },
      {
        cat: "Company",
        title: "Santos expects Barossa gas supply to Darwin LNG in coming months",
        comments: 16,
        url: "https://naturalgasintel.com/news/santos-expects-barossa-natural-gas-production-supply-to-darwin-lng-in-coming-months/",
        publishedIso: "2025-07-24T13:03:00Z",
      },
      {
        cat: "Markets",
        title: "Santos shifts blame to ADNOC’s XRG as the takeover deal collapses",
        comments: 11,
        url: "https://www.energyintel.com/00000199-5b88-d6fb-a3fb-5f9db4d60000",
        publishedIso: "2025-09-18T10:44:59.081000Z",
      },
      {
        cat: "Sector",
        title: "Santos narrows production, keeps a year-end LNG start in sight",
        comments: 8,
        url: "https://naturalgasintel.com/news/santos-narrows-production-keeps-year-end-lng-start-in-sight-amid-steadying-global-gas-prices/",
        publishedIso: "2025-10-22T13:25:00Z",
      },
    ],
  };
}

function chevronRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Chevron says Gorgon and Wheatstone now supply ~40% of WA’s domestic gas",
      comments: 19,
      url: "https://lngprime.com/australia-and-oceania/chevron-pens-western-australian-gas-supply-deal-with-alinta/191667/",
      publishedIso: "2026-07-10T05:18:11Z",
    },
    items: [
      {
        cat: "Markets",
        title: "Chevron signs a new five-year WA gas-supply deal with Alinta Energy",
        comments: 22,
        url: "https://www.offshore-technology.com/news/chevron-supply-deal-alinta-energy/",
      },
      {
        cat: "Company",
        title: "Downer wins a contract for Chevron’s Wheatstone and Gorgon facilities",
        comments: 10,
        url: "https://lngprime.com/australia-and-oceania/downer-wins-contract-for-chevrons-wheatstone-and-gorgon-facilities/168487/",
        publishedIso: "2025-11-11T06:56:09Z",
      },
      {
        cat: "Markets",
        title: "Chevron secures a long-term WA gas-supply deal with Horizon Power",
        comments: 13,
        url: "https://finance.yahoo.com/news/chevron-secures-long-term-gas-124500605.html",
        publishedIso: "2026-03-09T12:45:00Z",
      },
      {
        cat: "Sector",
        title: "Inside Chevron’s Wheatstone LNG and domestic-gas project",
        comments: 7,
        url: "https://australia.chevron.com/what-we-do/wheatstone-project",
        publishedIso: "2026-04-09T00:00:00Z",
      },
    ],
  };
}

function sfrRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Sandfire holds FY26 copper guidance as MATSA strength offsets Motheo hurdles",
      comments: 15,
      url: "https://www.tipranks.com/news/company-announcements/sandfire-holds-fy26-copper-output-guidance-as-matsa-strength-offsets-motheo-hurdles",
    },
    items: [
      {
        cat: "Markets",
        title: "Sandfire retains FY26 production, cost and capex guidance",
        comments: 12,
        url: "https://www.miningweekly.com/article/sandfire-retains-fy26-guidance-2026-01-22",
        publishedIso: "2026-01-22T13:42:00Z",
      },
      {
        cat: "Sustainability",
        title: "21MW solar plant signed for the Motheo copper mine in Botswana",
        comments: 8,
        url: "https://www.scatec.com/en/release-signs-lease-agreement-for-a-21-mw-solar-plant-at-motheo-copper-mine-in-botswana/",
      },
      {
        cat: "Company",
        title: "Inside Sandfire’s Motheo copper-mine triumph",
        comments: 6,
        url: "https://www.miningreview.com/magazine-article/sandfires-motheo-copper-mine-triumph/",
      },
      {
        cat: "Markets",
        title: "Copper miners navigate a challenging March quarter",
        comments: 5,
        url: "https://discoveryalert.com.au/copper-mining-operations-navigate-challenges-2026/",
        publishedIso: "2026-04-23T00:50:41Z",
      },
    ],
  };
}

function igoRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title:
        "IGO trims Greenbushes FY26 lithium guidance on systemic issues at the world’s biggest mine",
      comments: 21,
      url: "https://www.miningweekly.com/article/worlds-biggest-lithium-mine-gets-downgrade-on-systemic-issues-2026-04-24",
      publishedIso: "2026-04-24T06:30:00Z",
    },
    items: [
      {
        cat: "Markets",
        title: "IGO shares dive as the guidance cut overshadows strong cash flow",
        comments: 14,
        url: "https://thebull.com.au/news/igo-shares-dive-as-guidance-cut-overshadows-strong-cash-flow/",
      },
      {
        cat: "Company",
        title: "IGO to divest the Nova nickel operation to Global Lithium for A$7M",
        comments: 19,
        url: "https://www.tipranks.com/news/company-announcements/igo-to-divest-nova-nickel-operation-to-global-lithium-for-a7m",
      },
      {
        cat: "Markets",
        title: "IGO Q3 revenue jumps 45% even as battery-metal prices stay weak",
        comments: 9,
        url: "https://www.mining.com/web/australias-igo-posts-45-sequential-increase-in-q3-revenue/",
        publishedIso: "2026-04-23T22:50:34Z",
      },
      {
        cat: "Sector",
        title: "Systemic problems at Greenbushes drive IGO’s 2026 guidance cut",
        comments: 7,
        url: "https://discoveryalert.com.au/igo-greenbushes-systemic-problems-lithium-guidance-cut-2026/",
        publishedIso: "2026-04-25T05:50:37Z",
      },
    ],
  };
}

function minRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Mineral Resources back in the black as Onslow Iron hits 35Mtpa nameplate",
      comments: 44,
      url: "https://www.miningweekly.com/article/mineral-resources-hits-35mtpa-at-onslow-iron-2025-10-30",
      publishedIso: "2025-10-30T11:53:00Z",
    },
    items: [
      {
        cat: "Markets",
        title: "Onslow iron and lithium propel a record MinRes result",
        comments: 26,
        url: "https://miningmagazine.com.au/onslow-iron-lithium-propel-minres-record/",
      },
      {
        cat: "Company",
        title: "Ellison heralds a balance-sheet transformation as MinRes returns to profit",
        comments: 18,
        url: "https://thenightly.com.au/business/mining/chris-ellison-heralds-balance-sheet-transformation-with-miner-back-in-black-thanks-to-onslow-lithium-boost--c-21698937",
        publishedIso: "2026-02-20T01:41:51Z",
      },
      {
        cat: "People",
        title: "Governance uncertainty over founder Chris Ellison persists",
        comments: 63,
        url: "https://discoveryalert.com.au/mineral-resources-ceo-uncertainty-governance-onslow-iron-2026/",
        publishedIso: "2026-06-22T05:31:22Z",
      },
      {
        cat: "Markets",
        title: "MinRes turns bullish on lithium again",
        comments: 15,
        url: "https://stockhead.com.au/resources/minres-and-chris-ellison-dodging-missiles-turn-bullish-again-on-lithium/",
        publishedIso: "2025-11-20T19:00:37Z",
      },
    ],
  };
}

function plsRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Pilbara Minerals outlines a 2-million-tonne P2000 expansion at Pilgangoora",
      comments: 24,
      url: "https://mining.com.au/pilbara-minerals-outlines-2-million-tonne-expansion-at-pilgangoora/",
    },
    items: [
      {
        cat: "Company",
        title: "Pilbara Minerals approves the Ngungaju plant restart",
        comments: 15,
        url: "https://pls.com/news-stories/ngungaju-restart-approved/",
      },
      {
        cat: "Markets",
        title: "PLS primed for growth as the lithium winter starts to thaw",
        comments: 12,
        url: "https://www.mining.com/australias-pls-primed-for-growth-as-lithium-winter-starts-to-thaw/",
        publishedIso: "2025-08-03T16:05:09Z",
      },
      {
        cat: "Sector",
        title: "PLS ignites the Ngungaju plant comeback as lithium rebounds",
        comments: 10,
        url: "https://www.australianmining.com.au/pilbara-minerals-ignites-ngungaju-plant-comeback-as-lithium-rebounds/",
      },
      {
        cat: "Company",
        title: "PLS eyes a Pilbara lithium ramp-up",
        comments: 8,
        url: "https://www.australianmining.com.au/pls-eyes-pilbara-lithium-ramp-up/",
      },
    ],
  };
}

function ltrRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Liontown kicks off production at Australia’s first underground lithium mine",
      comments: 20,
      url: "https://www.mining.com/liontown-kicks-off-production-at-australias-first-underground-lithium-mine/",
      publishedIso: "2025-04-09T17:52:47Z",
    },
    items: [
      {
        cat: "Company",
        title: "Liontown opens the Kathleen Valley lithium operation",
        comments: 14,
        url: "https://www.mining-technology.com/news/liontown-resources-kathleen-valley-lithium-2/",
      },
      {
        cat: "Markets",
        title: "Liontown starts early works for the Kathleen Valley expansion",
        comments: 11,
        url: "https://resourcesreview.com.au/projects/liontown-starts-early-works-for-kathleen-valley-expansion/",
        publishedIso: "2026-04-30T09:57:49Z",
      },
      {
        cat: "Sector",
        title: "Liontown looks at a Kathleen Valley expansion to 4.0Mtpa",
        comments: 9,
        url: "https://www.miningnews.net/miners/news-analysis/4526359/liontown-looking-kathleen-valley-expansion",
        publishedIso: "2026-01-29T07:01:59Z",
      },
      {
        cat: "Company",
        title: "Kathleen Valley underground ramp-up: production and cost lens",
        comments: 13,
        url: "https://www.geomechanics.io/news/article/liontowns-kathleen-valley-underground-ramp-up-production-and-cost-lens-for-engineers",
        publishedIso: "2026-03-11T23:50:32Z",
      },
    ],
  };
}

function iluRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Iluka’s Eneabba rare-earths refinery passes 50% built, commissioning set for 2027",
      comments: 17,
      url: "https://www.miningweekly.com/article/eneabba-rare-earths-refinery-australia-update-2026-06-26",
      publishedIso: "2026-06-25T22:00:00Z",
    },
    items: [
      {
        cat: "Company",
        title: "Iluka locks in rare-earths demand as Eneabba advances",
        comments: 13,
        url: "https://miningmagazine.com.au/iluka-locks-in-rare-earths-demand-as-eneabba-advances/",
      },
      {
        cat: "Sector",
        title: "Australia’s first integrated rare-earths refinery takes shape",
        comments: 15,
        url: "https://australianminingreview.com.au/issue/2026/01/australias-first-integrated-rare-earths-refinery/",
        publishedIso: "2025-12-15T00:31:55Z",
      },
      {
        cat: "Markets",
        title: "Iluka Resources: Eneabba and the 2026 guide",
        comments: 9,
        url: "https://rare-earth-mining.com/iluka-resources/",
      },
      {
        cat: "Company",
        title: "Eneabba resource-development update",
        comments: 6,
        url: "https://www.iluka.com/operations-resource-development/resource-development/eneabba/",
      },
    ],
  };
}

function nstRealNews(): CompanyNews {
  return {
    hero: {
      cat: "Trending",
      title: "Northern Star folds De Grey’s Hemi into group reserves, lifting them 27%",
      comments: 29,
      url: "https://www.australianmining.com.au/northern-star-lifts-gold-inventory-as-hemi-drives-major-growth",
    },
    items: [
      {
        cat: "Markets",
        title: "Northern Star shares hammered on another FY26 production downgrade",
        comments: 34,
        url: "https://www.miningweekly.com/article/northern-star-shares-hammered-on-another-production-downgrade-2026-03-13",
        publishedIso: "2026-03-13T07:48:00Z",
      },
      {
        cat: "Company",
        title: "Northern Star hits major gold across all hubs",
        comments: 17,
        url: "https://www.australianmining.com.au/northern-star-hits-major-gold-across-all-hubs/",
      },
      {
        cat: "Company",
        title: "Kalgoorlie shines as Northern Star ramps up expansion",
        comments: 12,
        url: "https://www.australianmining.com.au/kalgoorlie-shines-as-northern-star-ramps-up-expansion/",
      },
      {
        cat: "Sector",
        title: "What the Northern Star–De Grey deal means for Aussie gold",
        comments: 10,
        url: "https://www.australianmining.com.au/what-the-northern-star-de-grey-deal-means-for-aussie-gold/",
      },
    ],
  };
}

// Companies with a hand-curated real feed above. Everyone else falls back to
// the live Google-News feed (see NewsPanel), then to generated copy.
export const CURATED_NEWS_COMPANIES = new Set([
  "BHP",
  "Rio Tinto",
  "Fortescue",
  "South32",
  "Woodside Energy",
  "Santos",
  "Chevron",
  "Sandfire Resources",
  "IGO",
  "Mineral Resources",
  "Pilbara Minerals",
  "Liontown Resources",
  "Iluka Resources",
  "Northern Star Resources",
]);

// Build a CompanyNews card from live Google-News items: the first is the hero,
// the next few are the list. Publisher + publish date ride along with each item
// so the card shows them directly (no scraping needed).
export function liveToCompanyNews(
  items: {
    title: string;
    url: string;
    publisher: string;
    published: string;
    image?: string;
    kind?: "news" | "post";
  }[],
): CompanyNews | null {
  if (!items.length) return null;
  const toItem = (a: (typeof items)[number], cat: string): NewsItem => ({
    // A company post keeps its own category label rather than being called
    // "News" or "Trending" — those words claim an editorial source it does not
    // have.
    cat: a.kind === "post" ? "Company post" : cat,
    title: a.title,
    comments: 0,
    url: a.url,
    image: a.image,
    publisher: a.publisher,
    publishedIso: a.published,
    kind: a.kind ?? "news",
  });
  return {
    hero: toItem(items[0], "Trending"),
    items: items.slice(1, 5).map((a) => toItem(a, "News")),
  };
}

export function companyNews(name: string, sector: string): CompanyNews {
  if (name === "BHP") return bhpRealNews();
  if (name === "Rio Tinto") return rioRealNews();
  if (name === "Fortescue") return fmgRealNews();
  if (name === "South32") return s32RealNews();
  if (name === "Woodside Energy") return wdsRealNews();
  if (name === "Santos") return stoRealNews();
  if (name === "Chevron") return chevronRealNews();
  if (name === "Sandfire Resources") return sfrRealNews();
  if (name === "IGO") return igoRealNews();
  if (name === "Mineral Resources") return minRealNews();
  if (name === "Pilbara Minerals") return plsRealNews();
  if (name === "Liontown Resources") return ltrRealNews();
  if (name === "Iluka Resources") return iluRealNews();
  if (name === "Northern Star Resources") return nstRealNews();
  const seed = seedOf(name + sector);
  const pick = <T>(arr: T[], k: number) => arr[(seed + k) % arr.length];
  const hero: NewsItem = {
    cat: "Trending",
    title: (pick(HERO_TEMPLATES, 0) as (n: string) => string)(name),
    comments: 4 + ((seed + 7) % 40),
  };
  const items: NewsItem[] = [0, 1, 2, 3].map((i) => ({
    cat: pick(CATS, i + 2),
    title: ITEM_TEMPLATES[(seed + i * 3) % ITEM_TEMPLATES.length](name),
    comments: 1 + ((seed + i * 5) % 30),
  }));
  return { hero, items };
}
