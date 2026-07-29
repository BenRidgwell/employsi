import type { Company, RoleBreakdown } from "./companies";
import type { JobsTarget } from "./auJobsTargets";
import { deriveDomain, nameAcronym } from "./rosters";

// AFR / IBISWorld "Top 500 Private Companies" (Australia) — the top 150 by
// revenue, plotted on their home-state capital and configured as private
// (non-listed) company cards. Source figures: 2024 revenue ($'000) and its
// year-on-year change; everything else (headcount, salary, roles, skills) is
// derived from those so the card reads consistently with the listed names. Live
// vacancies resolve from each company's own job market (Adzuna) like any other
// company — these ids are also added to the daily jobs pipeline.
//
// RAW: [name, homeCity, revenueThousands, revenueChangePct].
type Raw = [name: string, city: string, revK: number, chg: number];
const RAW: Raw[] = [
  ["Hancock Prospecting", "perth", 14904639, 3.89],
  ["Visy", "melbourne", 9912061, 3.43],
  ["Pallion", "sydney", 9442558, 37.33],
  ["United Petroleum", "melbourne", 7627026, 9.56],
  ["CBH Group", "perth", 6040862, -3.58],
  ["VGW Holdings", "perth", 5452389, 12.63],
  ["HCF", "sydney", 4183979, 8.12],
  ["Linfox", "melbourne", 3950000, 5.47],
  ["Peregrine", "adelaide", 3860292, 8.83],
  ["Hutchies Builders", "brisbane", 3400000, 8.47],
  ["Chemist Warehouse", "melbourne", 3389874, 8.4],
  ["St Vincent's Health Australia", "sydney", 3257041, 4.79],
  ["Teys Australia", "brisbane", 3153081, 1.92],
  ["Thomas Foods International", "adelaide", 3019380, 8.04],
  ["Spotlight", "melbourne", 2986949, 7.04],
  ["Team Global Express", "melbourne", 2953235, -1.86],
  ["NGP Group", "sydney", 2932486, 8.29],
  ["GHD", "sydney", 2883000, 7.06],
  ["Ateco", "sydney", 2829877, 12.78],
  ["EY", "sydney", 2810000, -5.39],
  ["RACQ", "brisbane", 2800245, 10.48],
  ["Deloitte Touche Tohmatsu", "sydney", 2780000, -2.46],
  ["Meriton", "sydney", 2758920, -11.8],
  ["PwC Australia", "sydney", 2655479, -7.15],
  ["Manildra Group", "sydney", 2525715, 8.33],
  ["Swift Holdings Investments", "perth", 2519516, 13.93],
  ["Ausgrid", "sydney", 2470570, 1.45],
  ["Built", "sydney", 2409108, 2.64],
  ["Competitive Foods", "sydney", 2341855, 15.09],
  ["BMD Group", "brisbane", 2312113, 32.41],
  ["KPMG", "sydney", 2200000, -13.83],
  ["COGI", "melbourne", 2196919, -1.23],
  ["Suttons Motors", "sydney", 2177668, 12.11],
  ["St John of God Health Care", "perth", 2157492, 5.18],
  ["HBF", "perth", 2122375, 3.95],
  ["Australian Unity", "melbourne", 2100000, 13.01],
  ["CMV Group", "adelaide", 2077983, 10.58],
  ["UnitingCare Queensland", "brisbane", 2035906, 4.71],
  ["Calvary Health Care", "sydney", 2017624, 9.37],
  ["Baiada Poultry", "sydney", 2001688, 1.5],
  ["Loan Market", "brisbane", 1950515, 6.77],
  ["Mater", "brisbane", 1714955, 7.86],
  // "ABN Group", not "ABN": the AFR list abbreviates it, but the bare
  // three-letter form is the Australian Business Number every ad and
  // article in the country quotes, so keyword searches keyed off it
  // matched the whole market (the card read 1,172 open roles and the news
  // panel filled with ABN registration stories). It is the WA/VIC
  // residential builder.
  ["ABN Group", "perth", 1708000, 19.71],
  ["SMRM Holdings", "brisbane", 1633128, 9.09],
  ["Midfield", "sydney", 1591748, 9.62],
  ["Bolton Clarke", "brisbane", 1584016, 34.15],
  ["Aurecon", "melbourne", 1575202, 9.94],
  ["Richard Crookes Constructions", "sydney", 1550000, 1.96],
  ["RAC of WA", "perth", 1549190, 10.6],
  ["Brisbane Catholic Education", "brisbane", 1491478, 8.84],
  ["Metricon Homes", "melbourne", 1467000, -6.44],
  ["Consolidated Travel", "melbourne", 1434240, 9.97],
  ["Fdc", "sydney", 1425000, 12.26],
  ["J.J. Richards & Sons", "brisbane", 1408794, 9.91],
  ["Goodstart Early Learning", "brisbane", 1404586, 5.28],
  ["Queensland Sugar", "brisbane", 1399664, 14.23],
  ["Ritchies Supa IGA", "melbourne", 1363094, 0.98],
  ["People First Bank", "adelaide", 1324200, 94.85],
  ["Drake Supermarkets", "adelaide", 1320000, 8.9],
  ["Uniting", "sydney", 1308000, 12.25],
  ["ADCO Constructions", "sydney", 1300000, -8.4],
  ["Georgiou", "perth", 1294200, 23.93],
  ["Opal Aged Care", "sydney", 1270448, 33.79],
  ["Herbert Smith Freehills", "sydney", 1235752, 4.19],
  ["Hansen Yuncken", "melbourne", 1209000, -5.15],
  ["QCoal", "brisbane", 1178751, 1.22],
  ["Salvation Army Australia", "melbourne", 1176561, 4.55],
  ["Melbourne Airport", "melbourne", 1156480, 9.6],
  ["Refuelling Solutions", "sydney", 1125314, -2.74],
  ["Mecca Brands", "melbourne", 1123080, 15.6],
  ["Winslow Constructors", "melbourne", 1112493, 5.96],
  ["Talent International", "melbourne", 1102565, 16.36],
  ["Epworth HealthCare", "melbourne", 1098879, 3.86],
  ["WorkPac", "brisbane", 1082777, -4.74],
  ["Australian Panels", "sydney", 1071956, 9.81],
  ["AFL", "melbourne", 1067708, 12.88],
  ["Winning Appliances", "sydney", 1051785, 8.19],
  ["Canberra Airport", "canberra", 1044407, 11.17],
  ["SunPork Group", "brisbane", 1023231, 5.23],
  ["ATI Global", "sydney", 1012959, 10.46],
  ["ARA", "sydney", 983934, 11.17],
  ["BAC Holdings", "brisbane", 982284, 18.89],
  ["Kane Constructions", "melbourne", 969837, -8.89],
  ["Teachers Health Fund", "sydney", 968381, 1.33],
  ["Firstmac", "brisbane", 967524, 4.34],
  ["BGC", "perth", 964461, 2.1],
  ["Avant Mutual", "sydney", 949820, 7.15],
  ["Village Roadshow", "melbourne", 932325, 6.5],
  ["Harris Farm", "sydney", 923819, 9.35],
  ["ColCap", "sydney", 918822, 88.8],
  ["CJD Equipment", "perth", 910000, 12.71],
  ["Perfection Fresh", "brisbane", 909700, 3.02],
  ["Mort & Co", "brisbane", 904984, -1.7],
  ["Nepean Consolidated", "sydney", 902764, 7.54],
  ["Turosi", "melbourne", 899087, 10.65],
  ["St Vincent de Paul", "melbourne", 885818, 4.47],
  ["MPC Kinetic", "brisbane", 885529, 10.84],
  ["John Hughes Group", "perth", 883000, 7.55],
  ["RACV", "melbourne", 881248, 6.87],
  ["Patterson Cheney", "melbourne", 871219, 5.24],
  ["Sydney Tools", "sydney", 870356, 7.23],
  ["Apco Service Stations", "melbourne", 868532, 12.99],
  ["NRMA Motoring & Services", "sydney", 857395, 5.08],
  ["Life Without Barriers", "sydney", 851586, 5.46],
  ["Northwestern Roads", "sydney", 846178, 8.91],
  ["Grand Motors", "melbourne", 828765, -3.72],
  ["MinterEllison", "sydney", 824461, 3.37],
  ["CCI", "melbourne", 795087, 12.89],
  ["Great Southern Bank", "brisbane", 789520, 6.33],
  ["CNW Electrical", "brisbane", 783721, 8.75],
  ["McNab Constructions", "brisbane", 770000, 23.2],
  ["Perron Group", "perth", 766985, 2.29],
  ["Alto", "sydney", 765000, 4.79],
  ["King & Wood Mallesons", "melbourne", 751281, 5.65],
  ["AGnVET Management Services", "sydney", 740809, 11.47],
  ["ABC Tissue", "sydney", 727718, 5.85],
  ["Defence Health", "melbourne", 714158, 2.73],
  ["Perth Airport", "perth", 711792, 13.64],
  ["Australian Rugby League Commission", "sydney", 701206, 18.09],
  ["Fitness and Lifestyle", "brisbane", 690000, 3.42],
  ["Leader Computers", "adelaide", 688000, 21.69],
  ["Kennards Hire", "sydney", 679025, 6.03],
  ["RAA", "adelaide", 678545, -17.01],
  ["Choices Flooring", "sydney", 673778, -7.93],
  ["AKD", "melbourne", 669060, 3.67],
  ["Craig Mostyn", "perth", 667708, 9.52],
  ["Employers Mutual", "sydney", 658074, 6.34],
  ["NHP Electrical Engineering Products", "melbourne", 654665, 7.65],
  ["Newcastle Greater Mutual Group", "sydney", 651941, 5.55],
  ["PharmaCare", "brisbane", 651101, 4.83],
  ["Norco Co-op", "sydney", 645001, -0.92],
  ["San Remo", "adelaide", 643803, 8.63],
  ["Walker Corporation", "sydney", 642500, -1.8],
  ["Merivale", "sydney", 640297, 4.79],
  ["GMHBA", "melbourne", 637830, -0.23],
  ["Peter Kittle Motor Company", "adelaide", 634882, 25.85],
  ["Detmold Group", "adelaide", 634000, 0.42],
  ["Stowe Australia", "sydney", 633058, 17.35],
  ["Creation Homes", "melbourne", 620160, 9.4],
  ["Anytime Fitness", "sydney", 605264, 13.66],
  ["Tennis Australia", "melbourne", 602879, 13.99],
  ["Sarah Group", "adelaide", 600000, 38.25],
  ["Australian Consolidated Milk", "melbourne", 596241, 4.13],
  ["Kennards Self Storage", "sydney", 595108, 11.05],
  ["BIG4 Holiday Parks", "sydney", 594608, 4.62],
  ["Clayton Utz", "sydney", 594000, 6.07],
  ["Sunny Queen Farms", "brisbane", 590000, 12.59],
  ["Bing Lee Electrics", "sydney", 589007, 7.6],
  ["Bowens Timber & Hardware", "melbourne", 587192, -1.17],
  ["HammondCare", "sydney", 586600, 22.87],
];

const STOP = new Set([
  "of",
  "and",
  "the",
  "for",
  "&",
  "a",
  "group",
  "holdings",
  "australia",
  "pty",
  "ltd",
]);

function h01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
export function privateCompanyId(name: string): string {
  return "priv-" + slug(name);
}

// Infer a display sector + one of the seven filter groups from the name. Private
// companies don't carry an exchange classification, so this is a keyword read;
// unmatched names fall back to a diversified consumer grouping.
interface Sec {
  sector: string;
  group: string;
  skills: string[];
}
const RESOURCES = {
  sector: "Resources",
  group: "Energy & Natural Resources",
  skills: [
    "Mining Engineering",
    "Heavy Diesel Maintenance",
    "Plant & Equipment Operation",
    "Safety & Compliance",
    "Logistics & Supply Chain",
  ],
};
const CONSTRUCTION = {
  sector: "Construction & Property",
  group: "Infrastructure and Government",
  skills: [
    "Project Management",
    "Civil Engineering",
    "Construction Management",
    "Trades & Services",
    "Estimating & Contracts",
  ],
};
const CONSUMER = {
  sector: "Consumer & Retail",
  group: "Consumer and Retail",
  skills: [
    "Retail Operations",
    "Supply Chain & Logistics",
    "Sales & Business Development",
    "Marketing & Comms",
    "Customer Service",
  ],
};
const INDUSTRIAL = {
  sector: "Industrial & Manufacturing",
  group: "Industrial Manufacturing",
  skills: [
    "Manufacturing & Production",
    "Mechanical Engineering",
    "Warehousing & Logistics",
    "Quality & Safety",
    "Maintenance & Trades",
  ],
};
const TECH = {
  sector: "Technology & Media",
  group: "Technology, Media and Telecommunications",
  skills: [
    "Software Engineering",
    "Data & Analytics",
    "Product & Design",
    "Sales & Business Development",
    "Customer Success",
  ],
};
const HEALTH = {
  sector: "Healthcare",
  group: "Healthcare and Life Sciences",
  skills: [
    "Nursing",
    "Allied Health",
    "Aged & Community Care",
    "Administration & Office Support",
    "Health & Safety",
  ],
};
const FINANCE = {
  sector: "Financial Services",
  group: "Financial Services",
  skills: [
    "Finance & Accounting",
    "Banking & Lending",
    "Risk & Compliance",
    "Data & Analytics",
    "Sales & Business Development",
  ],
};
const TRANSPORT = {
  sector: "Transport & Logistics",
  group: "Industrial Manufacturing",
  skills: [
    "Driving & Transport",
    "Warehousing & Logistics",
    "Supply Chain & Logistics",
    "Fleet & Maintenance",
    "Operations Management",
  ],
};
const AGRI = {
  sector: "Agribusiness",
  group: "Consumer and Retail",
  skills: [
    "Agriculture & Farming",
    "Supply Chain & Logistics",
    "Food Trades",
    "Warehousing & Logistics",
    "Operations Management",
  ],
};

// Companies whose NAME carries no clue to their industry, so the keyword rules
// below cannot place them and would silently drop them into the catch-all.
// Keep this small and evidenced — it exists for genuine misses, not for tuning.
const SECTOR_OVERRIDE: Record<string, () => Sec> = {
  // WA/VIC residential builder. Nothing in "ABN Group" says construction, so it
  // was landing in Consumer & Retail.
  "abn group": () => CONSTRUCTION,
};

function classify(name: string): Sec {
  const n = name.toLowerCase();
  const override = SECTOR_OVERRIDE[n];
  if (override) return override();
  const has = (...k: string[]) => k.some((x) => n.includes(x));
  if (
    has(
      "prospect",
      "mining",
      "resources",
      "minerals",
      "iron",
      "gold",
      "coal",
      "petroleum",
      "energy",
      "oil",
      "gas",
      "fuel",
      "lng",
    )
  )
    return RESOURCES;
  if (
    has(
      "construct",
      "building",
      "builder",
      "property",
      "developm",
      "homes",
      "civil",
      "infrastructure",
      "land",
      "estate",
      "concrete",
      "steel",
    )
  )
    return CONSTRUCTION;
  if (has("health", "care", "medical", "hospital", "pharma", "dental", "aged")) return HEALTH;
  if (has("capital", "financial", "invest", "wealth", "insurance", "bank", "finance"))
    return FINANCE;
  if (has("transport", "logistics", "freight", "shipping", "haul", "linfox", "cartage"))
    return TRANSPORT;
  if (
    has(
      "tech",
      "digital",
      "software",
      "media",
      "telecom",
      "data",
      "gaming",
      "games",
      "online",
      "entertainment",
    )
  )
    return TECH;
  if (
    has(
      "farm",
      "agri",
      "dairy",
      "grain",
      "cotton",
      "poultry",
      "meat",
      "produce",
      "wool",
      "cattle",
      "cbh",
    )
  )
    return AGRI;
  if (
    has(
      "manufactur",
      "industr",
      "packaging",
      "plastics",
      "motors",
      "automotive",
      "machinery",
      "products",
      "visy",
    )
  )
    return INDUSTRIAL;
  if (
    has(
      "food",
      "beverage",
      "wine",
      "brands",
      "retail",
      "hospitality",
      "hotel",
      "liquor",
      "supermarket",
      "foods",
      "fresh",
    )
  )
    return CONSUMER;
  return CONSUMER;
}

const ROLE_TITLES = ["Commercial & Corporate", "Operations & Delivery", "Frontline & Support"];

function buildPrivate([name, city, revK, chg]: Raw): Company & { city: string } {
  const h = h01(name);
  const h2 = h01(name + "::b");
  const sec = classify(name);
  // Headcount from revenue: ~$400k revenue/employee (private-sector blend).
  const headcount = Math.max(120, Math.round((revK * 1000) / 400000));
  const revPerEmp = +((revK * 1000) / headcount / 1e6).toFixed(3); // $M/emp
  const salaryNum = Math.round((88 + (h - 0.5) * 60) * 1000); // ~58k..118k
  const salaryK = Math.round(salaryNum / 1000);
  const growth = +chg.toFixed(1);
  const turnover = +(8 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 2].map((w, i) => 4 + Math.round(h * 22 * w) + i);
  const roles: RoleBreakdown[] = ROLE_TITLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 14);
  const acr = nameAcronym(name) || name.slice(0, 4).toUpperCase();
  return {
    id: privateCompanyId(name),
    ticker: acr,
    name,
    pill: acr,
    domain: deriveDomain(name),
    sector: sec.sector,
    group: sec.group,
    private: true,
    headcount,
    growth,
    openRoles: Math.max(
      0,
      roleCounts.reduce((a, b) => a + b, 0),
    ),
    salary: `$${salaryNum.toLocaleString("en-US")}`,
    salaryShort: `$${salaryK}K`,
    salaryNum,
    turnover,
    salaryDelta: `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`,
    metroDelta: `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}% vs metro`,
    trend: [],
    revPerEmp,
    ebitdaPerEmp: +(revPerEmp * (0.1 + h2 * 0.12)).toFixed(3),
    timeToFill: `${Math.round(26 + h * 26)} days`,
    competition: h > 0.66 ? "High" : h > 0.33 ? "Medium" : "Low",
    skills: sec.skills,
    roles,
    city,
  };
}

const BUILT = RAW.map(buildPrivate);

export const TOP_PRIVATE_COMPANIES: Company[] = BUILT.map(({ city, ...c }) => {
  void city;
  return c;
});
export const TOP_PRIVATE_IDS: string[] = TOP_PRIVATE_COMPANIES.map((c) => c.id);

// city → the private-company ids plotted there (for the map geomap step).
export const TOP_PRIVATE_BY_CITY: Record<string, string[]> = BUILT.reduce<Record<string, string[]>>(
  (acc, c) => {
    (acc[c.city] ||= []).push(c.id);
    return acc;
  },
  {},
);

// Daily jobs-pipeline targets so each private company's live Adzuna vacancies are
// pulled + mapped to skills (feeding the heat index) like every listed company.
export const TOP_PRIVATE_TARGETS: JobsTarget[] = BUILT.map((c) => ({
  id: c.id,
  name: c.name,
  sector: c.sector,
  group: c.group ?? "Consumer and Retail",
  cities: [c.city],
}));
