import type { Company, RoleBreakdown } from './companies';
import { deriveDomain } from './rosters';

// South Australian government agencies plotted in Adelaide — the SA counterpart
// of perthGov.ts. These are PRIVATE (not exchange-listed) public-sector bodies,
// mapped to the "Infrastructure and Government" sector group so the sector
// filter and the Public/Private listing filter both pick them up. The roster is
// the full list of employing agencies published on the official SA public-sector
// board (iworkfor.sa.gov.au); the "Not Specified" catch-all entry is dropped as
// it isn't a real, mappable agency.
//
// Illustrative headline figures are generated from the name (stable per agency);
// live open-roles resolve from the SA jobs board archived in D1 (source
// 'sa-gov') when a card is opened — see lib/openRolesFn.ts.
const NAMES: string[] = [
  'Adelaide Cemeteries Authority',
  'Adelaide Festival Centre Trust',
  'Alinytjara Wilurara Landscape Board',
  "Attorney-General's Department",
  'Audit Office of South Australia',
  'Carclew Youth Arts Centre',
  'Child Death and Serious Injury Review Committee',
  'Commissioner for Children and Young People',
  'Country Arts SA',
  'Courts Administration Authority',
  'Dairysafe',
  'Defence SA',
  'Department for Child Protection',
  'Department for Correctional Services',
  'Department for Education',
  'Department for Energy and Mining',
  'Department for Environment and Water',
  'Department for Housing and Urban Development',
  'Department for Infrastructure and Transport',
  'Department of Human Services',
  'Department of Primary Industries and Regions',
  'Department of State Development',
  'Department of Treasury and Finance',
  'Department of the Premier and Cabinet',
  'Education Standards Board',
  'Electoral Commission of SA',
  'Environment Protection Authority',
  'Essential Services Commission of SA',
  'Eyre Peninsula Landscape Board',
  'ForestrySA',
  'Funds SA',
  'Green Industries SA',
  'Guardian for Children and Young People',
  'Health and Community Services Complaints Commissioner',
  'Hills and Fleurieu Landscape Board',
  'History Trust of South Australia',
  'Independent Commission Against Corruption',
  'Infrastructure SA',
  'Kangaroo Island Landscape Board',
  'Landscape SA',
  'Legal Profession Conduct Commissioner',
  'Legal Services Commission',
  'Lifetime Support Authority of SA',
  'Limestone Coast Landscape Board',
  'Motor Accident Commission',
  'Murraylands and Riverland Landscape Board',
  'Northern and Yorke Landscape Board',
  'Office for Early Childhood Development',
  'Office for Recreation Sport and Racing',
  'Office of Hydrogen Power SA',
  'Office of the Commissioner for Public Sector Employment',
  'Office of the SA Productivity Commission',
  'Parliament of SA',
  'Preventive Health SA',
  'Renewal SA',
  'SA Fire and Emergency Services Commission',
  'SA Health',
  'SA Lotteries',
  'SACE Board of SA',
  'SafeWork SA',
  'South Australia Police',
  'SA Arid Lands Landscape Board',
  'SA Country Fire Service',
  'SA Employment Tribunal',
  'SA Film Corporation',
  'SA Housing Trust',
  'SA Metropolitan Fire Service',
  'SA Motor Sport Board',
  'SA State Emergency Service',
  'SA Tourism Commission',
  'State Opera SA',
  'State Theatre Company of SA',
  'Study Adelaide',
  'TAFE SA',
  'Teachers Registration Board',
  'West Beach Parks',
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
export function saGovAgencyId(name: string): string {
  return 'sa-gov-' + slug(name);
}

// Short acronym for the map pill / search ticker (e.g. "Department for Child
// Protection" → "DFCP"). Single-word names use a truncated form.
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
  // No PSC workforce series loaded for SA yet, so headcount/trend stay empty and
  // the card shows no fabricated workforce numbers (best-effort per the roster).
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
    id: saGovAgencyId(name),
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

export const ADELAIDE_GOV_COMPANIES: Company[] = NAMES.map(buildGovAgency);
export const ADELAIDE_GOV_IDS: string[] = ADELAIDE_GOV_COMPANIES.map((c) => c.id);

// The raw agency names, exported so the SA-Government jobs scraper
// (scripts/sa-gov-to-d1.py) can map each advertised job's employing agency back
// to the matching gov company id.
export const ADELAIDE_GOV_NAMES: string[] = NAMES;
