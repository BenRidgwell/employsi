import type { Company, RoleBreakdown } from './companies';
import { deriveDomain } from './rosters';

// Queensland government agencies plotted in Brisbane — the Queensland counterpart of
// perthGov.ts / adelaideGov.ts. These are PRIVATE (not exchange-listed)
// public-sector bodies, mapped to the "Infrastructure and Government" sector
// group so the sector filter and the Public/Private listing filter both pick
// them up. The roster is every employing organisation currently advertising on
// the official Queensland government jobs board (smartjobs.qld.gov.au); it's derived from the
// board itself, so it tracks who is actually hiring.
//
// Illustrative headline figures are generated from the name (stable per agency);
// live open-roles resolve from the scraped board feed (jobs-cron, KV
// qldgov:{id}) when a card is opened — see lib/openRolesFn.ts.
const NAMES: string[] = [
  'Art Gallery',
  'Crime and Corruption Commission',
  'Cross River Rail Delivery Authority',
  'Department of Customer Services, Open Data and Small and Family Business',
  'Department of Women, Aboriginal and Torres Strait Islander Partnerships and Multiculturalism',
  'Economic Development Queensland',
  'Education',
  'Electoral Commission',
  'Energy and Water Ombudsman Queensland',
  'Environment, Tourism, Science and Innovation',
  'Families, Seniors, Disability Services and Child Safety',
  'Health and Wellbeing Queensland',
  'Housing and Public Works',
  'Information Commissioner',
  'Inspector General Emergency Management',
  'Justice',
  'Legal Aid',
  'Local Government, Water and Volunteers',
  'National Injury Insurance Agency Queensland',
  'Natural Resources and Mines, Manufacturing and Regional and Rural Development',
  'Office of Industrial Relations',
  'Office of the Health Ombudsman',
  'Office of the Public Guardian',
  'Office of the Queensland Integrity Commissioner',
  'Office of the Queensland Ombudsman',
  'Parliamentary Service',
  'Primary Industries',
  'Public Trust Office',
  'QLeave',
  'Queensland Academy of Sport',
  'Queensland Ambulance Service',
  'Queensland Audit Office',
  'Queensland Building and Construction Commission',
  'Queensland Corrective Services',
  'Queensland Curriculum and Assessment Authority',
  'Queensland Family and Child Commission',
  'Queensland Fire Department',
  'Queensland Health',
  'Queensland Mental Health Commission',
  'Queensland Pharmacy Business Ownership Council',
  'Queensland Police Service',
  'Queensland Racing Integrity Commission',
  'Queensland Rural and Industry Development Authority',
  'Queensland Treasury',
  'Resources Safety and Health Queensland',
  'Sport, Racing and Olympic and Paralympic Games',
  'Stadiums Queensland',
  'State Development, Infrastructure and Planning',
  'State Library',
  'TAFE Queensland',
  'Teach Queensland',
  'Trade and Investment Queensland',
  'Trade, Employment and Training',
  'Transport and Main Roads',
  'Youth Justice and Victim Support',
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
export function qldGovAgencyId(name: string): string {
  return 'qld-gov-' + slug(name);
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
    id: qldGovAgencyId(name),
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

export const BRISBANE_GOV_COMPANIES: Company[] = NAMES.map(buildGovAgency);
export const BRISBANE_GOV_IDS: string[] = BRISBANE_GOV_COMPANIES.map((c) => c.id);

// The raw agency names, exported so the Queensland-Government jobs fetcher
// (workers/jobs-cron/qldGov.ts) can map each advertised job's employing
// organisation back to the matching gov company id.
export const BRISBANE_GOV_NAMES: string[] = NAMES;
