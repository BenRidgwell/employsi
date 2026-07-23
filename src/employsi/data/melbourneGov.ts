import type { Company, RoleBreakdown } from './companies';
import { deriveDomain } from './rosters';

// Victorian government agencies plotted in Melbourne — the Victorian counterpart of
// perthGov.ts / adelaideGov.ts. These are PRIVATE (not exchange-listed)
// public-sector bodies, mapped to the "Infrastructure and Government" sector
// group so the sector filter and the Public/Private listing filter both pick
// them up. The roster is every employing organisation currently advertising on
// the official Victorian government jobs board (careers.vic.gov.au); it's derived from the
// board itself, so it tracks who is actually hiring.
//
// Illustrative headline figures are generated from the name (stable per agency);
// live open-roles resolve from the scraped board feed (jobs-cron, KV
// vicgov:{id}) when a card is opened — see lib/openRolesFn.ts.
const NAMES: string[] = [
  'Albury Wodonga Health',
  'Alexandra District Health',
  'Ambulance Victoria',
  'Austin Health',
  'Bairnsdale Regional Health Service',
  'Barwon Health',
  'Benalla Health',
  'Bendigo Health',
  'Building and Plumbing Commission',
  'Cenitex',
  'Central Gippsland Health',
  'Central Highlands Rural Health',
  "Children's Court",
  'Corryong Health',
  'Country Fire Authority',
  'County Court',
  'Court Services Victoria',
  'Department of Education',
  'Department of Energy, Environment and Climate Action',
  'Department of Families, Fairness and Housing',
  'Department of Government Services',
  'Department of Health',
  'Department of Jobs, Skills, Industry and Regions',
  'Department of Justice and Community Safety',
  'Department of Premier and Cabinet',
  'Department of Transport and Planning',
  'Department of Treasury and Finance',
  'Dhelkaya Health',
  'Energy Safe Victoria',
  'Environment Protection Authority',
  'Essential Services Commission',
  'Game Management Authority',
  'Goulburn Valley Health',
  'Government schools',
  'Grampians Wimmera Mallee Water Corporation',
  'Heathcote Health',
  'Homes Victoria',
  'Independent Broad-based Anti-Corruption Commission',
  'Inglewood and Districts Health Service',
  'Latrobe Regional Health',
  'Magistrates Court',
  'Moyne Health Services',
  'Museums Victoria',
  'NCN Health',
  'Northeast Health Wangaratta',
  'Office of Public Prosecutions',
  'Office of the Victorian Information Commissioner',
  'Orbost Regional Health',
  'Parks Victoria',
  'Parliament of Victoria',
  'Peninsula Health',
  'Peter MacCallum Cancer Centre',
  'Portable Long Service Authority',
  'Royal Botanic Gardens Victoria',
  "Royal Children's Hospital",
  'Royal Melbourne Hospital',
  'Safer Care Victoria',
  'Shrine of Remembrance Trust',
  'Social Services Regulator',
  'South West Healthcare',
  'State Library of Victoria',
  'State Revenue Office',
  'State Trustees Limited',
  'Supreme Court',
  'Tallangatta Health Service',
  'Triple Zero Victoria',
  'VicGrid',
  'VicScreen',
  'Victoria Legal Aid',
  'Victoria Police',
  'Victoria State Emergency Service',
  'Victorian Civil and Administrative Tribunal (VCAT)',
  'Victorian Electoral Commission',
  'Victorian Gambling and Casino Control Commission',
  "Victorian Government Solicitor's Office",
  'Victorian Health Promotion Foundation',
  'Victorian Infrastructure Delivery Authority',
  'Victorian Infrastructure Delivery Authority | Health',
  'Victorian Infrastructure Delivery Authority | Rail',
  'Victorian Infrastructure Delivery Authority | Roads',
  'Victorian Institute of Forensic Medicine',
  'Victorian Institute of Teaching',
  'Victorian Legal Services Board and Commissioner',
  'Victorian Managed Insurance Authority',
  'Victorian Ombudsman',
  'Victorian School Building Authority',
  'West Gippsland Healthcare Group',
  'Western Health',
  'Workforce Inspectorate Victoria',
  'Workplace Injury Commission',
  'WorkSafe',
];

const STOP = new Set(['of', 'and', 'the', 'for', '&', 'a']);

// Deterministic 0..1 hash so each agency's figures are stable.
function h01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export function vicGovAgencyId(name: string): string {
  return 'vic-gov-' + slug(name);
}

// Short acronym for the map pill / search ticker.
function govAcronym(name: string): string {
  const words = name.split(/[\s,|]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  if (words.length >= 2) {
    return words.map((w) => w[0].toUpperCase()).join('').slice(0, 6);
  }
  return (words[0] || name).slice(0, 5).toUpperCase();
}

const GOV_SKILLS = ['Policy & Governance', 'Public Administration', 'Project Delivery', 'Data & Analytics', 'Community Services'];
const GOV_ROLES = ['Corporate & Policy', 'Frontline Services', 'Operations'];

function buildGovAgency(name: string): Company {
  const h = h01(name);
  const h2 = h01(name + '::b');
  // No PSC workforce series loaded, so headcount/trend stay empty and the card
  // shows no fabricated workforce numbers (best-effort per the roster).
  const headcount = 0;
  const growth = 0;
  const trend: number[] = [];
  const salaryNum = Math.round((98 + (h - 0.5) * 40) * 1000); // ~78k .. 118k
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(6 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 1].map((w, i) => 8 + Math.round(h * 40 * w) + i);
  const roles: RoleBreakdown[] = GOV_ROLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 16);
  const acr = govAcronym(name);
  return {
    id: vicGovAgencyId(name),
    ticker: acr,
    name,
    pill: acr,
    domain: deriveDomain(name),
    sector: 'Government',
    group: 'Infrastructure and Government',
    private: true,
    headcount,
    growth,
    openRoles: Math.round(10 + h * 240),
    salary: `$${salaryNum.toLocaleString('en-US')}`,
    salaryShort: `$${salaryK}K`,
    salaryNum,
    turnover,
    salaryDelta: `${delta >= 0 ? '+' : '\u2212'}${Math.abs(delta)}%`,
    metroDelta: `${delta >= 0 ? '+' : '\u2212'}${Math.abs(delta)}% vs metro`,
    trend,
    revPerEmp: 0,
    ebitdaPerEmp: 0,
    timeToFill: `${Math.round(34 + h * 24)} days`,
    competition: h > 0.66 ? 'High' : h > 0.33 ? 'Medium' : 'Low',
    skills: GOV_SKILLS,
    roles,
  };
}

export const MELBOURNE_GOV_COMPANIES: Company[] = NAMES.map(buildGovAgency);
export const MELBOURNE_GOV_IDS: string[] = MELBOURNE_GOV_COMPANIES.map((c) => c.id);

// The raw agency names, exported so the Victorian-Government jobs fetcher
// (workers/jobs-cron/vicGov.ts) can map each advertised job's employing
// organisation back to the matching gov company id.
export const MELBOURNE_GOV_NAMES: string[] = NAMES;
