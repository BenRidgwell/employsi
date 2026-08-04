// New Zealand companies, plotted on the Auckland + Wellington local views at
// their real head-office coordinates (geocoded from each HQ street address via
// OpenStreetMap / Nominatim). Headcounts are the companies' publicly-reported
// approximate figures; the remaining card fields (salary bands, role splits,
// time-to-fill, etc.) are illustrative and generated deterministically — the
// same convention the global rosters use — until primary-source data is wired.
import type { Company, RoleBreakdown } from "./companies";
import { deriveDomain, nameAcronym } from "./rosters";

export interface NzCompany extends Company {
  city: string;
  coords: [number, number];
}

// [ticker, name, city, [lng,lat], headcount, growthYoY%, sector, group,
//  exchange ('' = private), skills]
type Raw = [
  string,
  string,
  string,
  [number, number],
  number,
  number,
  string,
  string,
  string,
  string[],
];

const RAW: Raw[] = [
  // ── Auckland ──────────────────────────────────────────────────────────────
  [
    "FPH",
    "Fisher & Paykel Healthcare",
    "auckland",
    [174.880494, -36.931916],
    7000,
    5.0,
    "Medical Devices",
    "Healthcare and Life Sciences",
    "NZX",
    [
      "Medical Devices",
      "Manufacturing & Production",
      "Research & Development",
      "Quality & Compliance",
      "Regulatory Affairs",
    ],
  ],
  [
    "AIA",
    "Auckland International Airport",
    "auckland",
    [174.782451, -37.004756],
    600,
    8.0,
    "Airports & Aviation",
    "Infrastructure and Government",
    "NZX",
    [
      "Airport Operations",
      "Aviation",
      "Cleaning & Facilities",
      "Commercial & Legal",
      "Safety & Compliance",
    ],
  ],
  [
    "SPK",
    "Spark New Zealand",
    "auckland",
    [174.757658, -36.847507],
    5000,
    -2.0,
    "Telecommunications",
    "Technology, Media and Telecommunications",
    "NZX",
    [
      "Telecommunications",
      "Software Engineering",
      "Cloud & Infrastructure",
      "Data Science & Machine Learning",
      "Customer Service",
    ],
  ],
  [
    "MFT",
    "Mainfreight",
    "auckland",
    [174.83034, -36.943021],
    11000,
    3.0,
    "Transport & Logistics",
    "Industrial Manufacturing",
    "NZX",
    [
      "Warehousing & Logistics",
      "Driving & Transport",
      "Supply Chain",
      "Operations",
      "Freight Forwarding",
    ],
  ],
  [
    "MCY",
    "Mercury NZ",
    "auckland",
    [174.778085, -36.864677],
    1100,
    2.0,
    "Electricity & Renewables",
    "Energy & Natural Resources",
    "NZX",
    ["Renewable Energy", "Electrical Trade", "Asset Management", "Trading", "Sustainability"],
  ],
  [
    "FBU",
    "Fletcher Building",
    "auckland",
    [174.819756, -36.911563],
    14000,
    -4.0,
    "Building Products & Construction",
    "Industrial Manufacturing",
    "NZX",
    [
      "Construction Management",
      "Manufacturing & Production",
      "Supply Chain",
      "Project Delivery",
      "Safety & Compliance",
    ],
  ],
  [
    "SKC",
    "SkyCity Entertainment Group",
    "auckland",
    [174.761764, -36.849131],
    5000,
    1.0,
    "Gaming & Hospitality",
    "Consumer and Retail",
    "NZX",
    [
      "Hospitality & Food Service",
      "Gaming Operations",
      "Customer Service",
      "Security & Compliance",
      "Facilities Management",
    ],
  ],
  [
    "FCG",
    "Fonterra Co-operative Group",
    "auckland",
    [174.76283, -36.844587],
    19000,
    -3.0,
    "Dairy & Food",
    "Consumer and Retail",
    "NZX",
    [
      "Food Processing",
      "Manufacturing & Production",
      "Supply Chain",
      "Quality & Compliance",
      "Agriculture & Farming",
    ],
  ],
  [
    // Dual-listed (NZX ATM / ASX A2M) and Auckland-headquartered, at Level 10,
    // 51 Shortland Street. Headcount is the reported 511 at 30 June 2025, up
    // 4.7% on the prior year — the same annual-report figure the AU roster's
    // headcounts come from, not an estimate.
    "ATM",
    "The a2 Milk Company",
    "auckland",
    [174.768234, -36.847109],
    511,
    4.7,
    "Dairy & Nutrition",
    "Consumer and Retail",
    "NZX",
    [
      "Food Processing",
      "Quality & Compliance",
      "Supply Chain",
      "Brand & Marketing",
      "Nutrition Science",
    ],
  ],
  // ── Wellington ────────────────────────────────────────────────────────────
  [
    "IFT",
    "Infratil",
    "wellington",
    [174.7825, -41.296],
    60,
    10.0,
    "Infrastructure Investment",
    "Financial Services",
    "NZX",
    [
      "Investment Management",
      "Finance & Accounting",
      "Asset Management",
      "Commercial & Legal",
      "Strategy",
    ],
  ],
  [
    "XRO",
    "Xero",
    "wellington",
    [174.779892, -41.291603],
    4500,
    12.0,
    "Software",
    "Technology, Media and Telecommunications",
    "NZX",
    [
      "Software Engineering",
      "Cloud & Infrastructure",
      "Product Management",
      "Data Science & Machine Learning",
      "Customer Support",
    ],
  ],
  [
    "MEL",
    "Meridian Energy",
    "wellington",
    [174.778975, -41.283165],
    1000,
    2.0,
    "Electricity & Renewables",
    "Energy & Natural Resources",
    "NZX",
    ["Renewable Energy", "Electrical Trade", "Generation", "Trading", "Sustainability"],
  ],
  [
    "CEN",
    "Contact Energy",
    "wellington",
    [174.776156, -41.283544],
    1200,
    3.0,
    "Electricity & Renewables",
    "Energy & Natural Resources",
    "NZX",
    ["Renewable Energy", "Generation", "Trading", "Electrical Trade", "Customer Service"],
  ],
  [
    "CNU",
    "Chorus",
    "wellington",
    [174.772547, -41.292552],
    800,
    -1.0,
    "Telecommunications",
    "Technology, Media and Telecommunications",
    "NZX",
    [
      "Telecommunications",
      "Fibre Networks",
      "Electrical Trade",
      "Infrastructure",
      "Field Services",
    ],
  ],
  [
    "TOD",
    "Todd Corporation",
    "wellington",
    [174.777056, -41.285288],
    2000,
    4.0,
    "Energy & Investment",
    "Energy & Natural Resources",
    "",
    [
      "Oil & Gas Operations",
      "Investment Management",
      "Project Delivery",
      "Commercial & Legal",
      "Energy",
    ],
  ],
];

function h01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function nzId(name: string): string {
  return (
    "nz-" +
    name
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

const ROLE_TITLES = ["Commercial & Corporate", "Operations & Delivery", "Frontline & Support"];

function build([
  ticker,
  name,
  city,
  coords,
  headcount,
  growth,
  sector,
  group,
  exchange,
  skills,
]: Raw): NzCompany {
  const h = h01(name);
  const h2 = h01(name + "::b");
  const salaryNum = Math.round((84 + (h - 0.5) * 56) * 1000); // ~56k..112k (NZD-ish band)
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(8 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 2].map((w, i) => 3 + Math.round(h * 18 * w) + i);
  const roles: RoleBreakdown[] = ROLE_TITLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 14);
  const revPerEmp = +(0.3 + h * 0.9).toFixed(3);
  return {
    id: nzId(name),
    ticker,
    name,
    pill: nameAcronym(name) || ticker,
    domain: deriveDomain(name),
    sector,
    group,
    ...(exchange ? { exchange } : { private: true }),
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
    skills,
    roles,
    city,
    coords,
  };
}

const BUILT = RAW.map(build);

export const NZ_COMPANIES: Company[] = BUILT.map(({ city, coords, ...c }) => c);
export const NZ_IDS: string[] = BUILT.map((c) => c.id);

// city id → [{ id, coords }] for the map geomap (mapboxGeo).
export const NZ_BY_CITY: Record<string, { id: string; coords: [number, number] }[]> = BUILT.reduce<
  Record<string, { id: string; coords: [number, number] }[]>
>((acc, c) => {
  (acc[c.city] ||= []).push({ id: c.id, coords: c.coords });
  return acc;
}, {});
