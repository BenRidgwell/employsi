import type { Company, RoleBreakdown } from './companies';
import { deriveDomain } from './rosters';
import { GOV_WORKFORCE, GOV_HEADCOUNT } from './perthGovWorkforce';

// Western Australian government agencies plotted in Perth. These are PRIVATE
// (not exchange-listed) public-sector bodies, mapped to the "Infrastructure and
// Government" sector group so the sector filter and the new Public/Private
// listing filter both pick them up. Illustrative figures are generated from the
// name (stable per agency); live open-roles still resolve from Adzuna by name
// when a card is opened.

const NAMES: string[] = [
  'Arts and Culture Trust',
  'Central Regional TAFE',
  'ChemCentre',
  'Child and Adolescent Health Service',
  'Construction Training Fund',
  'Corruption and Crime Commission',
  'Department of Biodiversity, Conservation and Attractions',
  'Department of Communities',
  'Department of Creative Industries, Tourism and Sport',
  'Department of Education',
  'Department of Energy and Economic Diversification',
  'Department of Fire & Emergency Services',
  'Department of Health',
  'Department of Housing and Works',
  'Department of Justice',
  'Department of Local Government, Industry Regulation and Safety',
  'Department of Mines, Petroleum and Exploration',
  'Department of Planning, Lands and Heritage',
  'Department of Primary Industries and Regional Development',
  'Department of the Premier and Cabinet',
  'Department of Training and Workforce Development',
  'Department of Transport and Major Infrastructure',
  'Department of Treasury and Finance',
  'Department of Water and Environmental Regulation',
  'East Metropolitan Health Service',
  'Economic Regulation Authority',
  'Forest Products Commission',
  'GESB',
  'Health Support Services',
  'Insurance Commission of Western Australia',
  'Landgate',
  'Legal Aid Western Australia',
  'Legal Practice Board',
  'Lotterywest',
  'Main Roads WA',
  'Mental Health Commission',
  'Metropolitan Cemeteries Board',
  'MyLeave',
  'North Metropolitan Health Service',
  'North Metropolitan TAFE',
  'North Regional TAFE',
  'Office of the Auditor General',
  'Office of the Director of Public Prosecutions',
  'Ombudsman Western Australian',
  'Parliamentary Services Department',
  'PathWest',
  'Pilbara Ports Authority',
  'Public Sector Commission',
  'Public Transport Authority',
  'Rottnest Island Authority',
  'South Metropolitan Health Service',
  'South Metropolitan TAFE',
  'South Regional TAFE',
  'State Solicitors Office',
  'Tourism Western Australia',
  'VenuesWest',
  'WA Country Health Service',
  'Western Australia Police Force',
  'Western Australian Electoral Commission',
  'Western Australian Museum',
  'WorkCover WA',
  'Perth Zoo',
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
export function govAgencyId(name: string): string {
  return 'perth-gov-' + slug(name);
}

// Short acronym for the map pill / search ticker (e.g. "Department of Fire &
// Emergency Services" → "DFES"). Single-word names just use a truncated form.
function govAcronym(name: string): string {
  const words = name.split(/[\s,]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
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
  const id = govAgencyId(name);
  // Real workforce figures from the PSC Statistical Bulletins where the agency
  // is reported; otherwise headcount is unknown (0) and the trend is empty, so
  // the card shows no fabricated workforce numbers for it.
  const hcRec = GOV_HEADCOUNT[id];
  const wf = GOV_WORKFORCE[id];
  const headcount = hcRec ? hcRec.now : 0;
  const growth = hcRec ? hcRec.yoy : 0;
  const trend = wf ? wf.trend : [];
  const salaryNum = Math.round((98 + (h - 0.5) * 40) * 1000); // ~78k .. 118k
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(6 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 1].map((w, i) => 8 + Math.round(h * 40 * w) + i);
  const roles: RoleBreakdown[] = GOV_ROLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 16);
  const acr = govAcronym(name);
  return {
    id: govAgencyId(name),
    ticker: acr,
    name,
    pill: acr,
    domain: deriveDomain(name),
    sector: 'Government',
    group: 'Infrastructure and Government',
    // No `exchange` — these are private (not listed). `private` drives the
    // Public/Private master filter.
    private: true,
    headcount,
    growth,
    openRoles: Math.round(10 + h * 240),
    salary: `$${salaryNum.toLocaleString('en-US')}`,
    salaryShort: `$${salaryK}K`,
    salaryNum,
    turnover,
    salaryDelta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`,
    metroDelta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}% vs metro`,
    trend,
    revPerEmp: 0,
    ebitdaPerEmp: 0,
    timeToFill: `${Math.round(34 + h * 24)} days`,
    competition: h > 0.66 ? 'High' : h > 0.33 ? 'Medium' : 'Low',
    skills: GOV_SKILLS,
    roles,
  };
}

export const PERTH_GOV_COMPANIES: Company[] = NAMES.map(buildGovAgency);
export const PERTH_GOV_IDS: string[] = PERTH_GOV_COMPANIES.map((c) => c.id);

// The raw agency names, exported so the WA-Government jobs scraper (jobs-cron)
// can map each advertised job's "Agency" back to the matching gov company id.
export const PERTH_GOV_NAMES: string[] = NAMES;
