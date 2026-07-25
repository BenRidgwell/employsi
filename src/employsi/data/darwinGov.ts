import type { Company, RoleBreakdown } from './companies';
import { deriveDomain } from './rosters';

// Northern Territory Government agencies — the NT counterpart of perthGov.ts /
// adelaideGov.ts / canberraGov.ts, sourced from the official NT jobs board
// (jobs.nt.gov.au). These are PRIVATE (not exchange-listed) public-sector bodies,
// mapped to the "Infrastructure and Government" sector group so the Government
// sector filter and the Public/Private listing filter both pick them up.
//
// ids are `nt-gov-<slug>` — deliberately disjoint from the other gov prefixes
// (perth-gov-/sa-gov-/vic-gov-/qld-gov-/aps-), so an NT agency's vacancies are
// never confused or double-counted with a same-named agency in another
// jurisdiction. Live open-roles resolve from the NT board archived in D1 (source
// 'nt-gov') when a card is opened — see lib/openRolesFn.ts.
//
// Every NT agency is plotted in Darwin (the territory capital / seat of
// government), mirroring how the WA agencies all sit in Perth.
const AGENCIES: string[] = [
  'Department of Health',
  'Department of Education and Training',
  'Department of Corporate and Digital Development',
  'Department of Logistics and Infrastructure',
  'Department of Corrections',
  "Attorney General's Department",
  'Power and Water Corporation',
  'Department of Children and Families',
  'Department of Agriculture and Fisheries',
  'NT Police Force',
  'Department of Lands, Planning and Environment',
  'Department of Tourism and Hospitality',
  'Department of the Chief Minister and Cabinet',
  'Department of Housing, Local Government and Community Development',
  'Land Development Corporation',
  'Department Mining and Energy',
  'Department of People, Sport and Culture',
  'NT Fire and Emergency Services',
  'Territory Generation',
  'Batchelor Institute of Indigenous Tertiary Education',
  'Department of Trade, Business and Asian Relations',
  'Department of Treasury and Finance',
  'Department of Legislative Assembly',
];

const STOP = new Set(['of', 'and', 'the', 'for', '&', 'a']);

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
export function ntGovAgencyId(name: string): string {
  return 'nt-gov-' + slug(name);
}

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
  const salaryNum = Math.round((96 + (h - 0.5) * 42) * 1000); // ~75k .. 117k
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(6 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 1].map((w, i) => 6 + Math.round(h * 30 * w) + i);
  const roles: RoleBreakdown[] = GOV_ROLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 16);
  const acr = govAcronym(name);
  return {
    id: ntGovAgencyId(name),
    ticker: acr,
    name,
    pill: acr,
    domain: deriveDomain(name),
    sector: 'Government',
    group: 'Infrastructure and Government',
    private: true,
    headcount: 0,
    growth: 0,
    openRoles: Math.round(6 + h * 120),
    salary: `$${salaryNum.toLocaleString('en-US')}`,
    salaryShort: `$${salaryK}K`,
    salaryNum,
    turnover,
    salaryDelta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}%`,
    metroDelta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}% vs metro`,
    trend: [],
    revPerEmp: 0,
    ebitdaPerEmp: 0,
    timeToFill: `${Math.round(34 + h * 24)} days`,
    competition: h > 0.66 ? 'High' : h > 0.33 ? 'Medium' : 'Low',
    skills: GOV_SKILLS,
    roles,
  };
}

export const DARWIN_GOV_COMPANIES: Company[] = AGENCIES.map((name) => buildGovAgency(name));
export const DARWIN_GOV_IDS: string[] = DARWIN_GOV_COMPANIES.map((c) => c.id);
export const DARWIN_GOV_NAMES: string[] = [...AGENCIES];
