import type { Company, RoleBreakdown } from './companies';
import { deriveDomain } from './rosters';

// Australian Public Service (Commonwealth / federal) agencies — the APS
// counterpart of perthGov.ts / adelaideGov.ts, sourced from apsjobs.gov.au. These
// are PRIVATE (not exchange-listed) public-sector bodies, mapped to the
// "Infrastructure and Government" sector group so the Government sector filter
// and the Public/Private listing filter both pick them up.
//
// ids are `aps-<slug>` — deliberately disjoint from the state gov prefixes
// (perth-gov-/sa-gov-/vic-gov-/qld-gov-), so a federal agency's vacancies are
// never confused or double-counted with a state agency of a similar name
// (federal "Department of Health" vs a state health department are different
// employers). Live open-roles resolve from the APS board archived in D1 (source
// 'aps-gov') when a card is opened — see lib/openRolesFn.ts.
//
// Most APS agencies are headquartered in Canberra; the handful HQ'd elsewhere
// carry a hub override so their pin lands in the right city.
type AgencyEntry = [name: string, hub?: string];
const AGENCIES: AgencyEntry[] = [
  // Departments of State
  ["Attorney-General's Department"],
  ['Department of Agriculture, Fisheries and Forestry'],
  ['Department of Climate Change, Energy, the Environment and Water'],
  ['Department of Defence'],
  ['Department of Education'],
  ['Department of Employment and Workplace Relations'],
  ['Department of Finance'],
  ['Department of Foreign Affairs and Trade'],
  ['Department of Health, Disability and Ageing'],
  ['Department of Home Affairs'],
  ['Department of Industry, Science and Resources'],
  ['Department of Infrastructure, Transport, Regional Development, Communications and the Arts'],
  ['Department of Social Services'],
  ['Department of the Prime Minister and Cabinet'],
  ['Department of the Treasury'],
  ['Department of Veterans’ Affairs'],
  // Major agencies (Canberra unless noted)
  ['Australian Taxation Office'],
  ['Services Australia'],
  ['Australian Bureau of Statistics'],
  ['Australian Federal Police'],
  ['National Disability Insurance Agency'],
  ['Australian Securities and Investments Commission', 'sydney'],
  ['Australian Prudential Regulation Authority', 'sydney'],
  ['Reserve Bank of Australia', 'sydney'],
  ['Australian Competition and Consumer Commission'],
  ['Australian Communications and Media Authority'],
  ['IP Australia'],
  ['Australian Electoral Commission'],
  ['Bureau of Meteorology', 'melbourne'],
  ['Geoscience Australia'],
  ['CSIRO'],
  ['Australian Signals Directorate'],
  ['Australian Security Intelligence Organisation'],
  ['Australian Digital Health Agency'],
  ['Australian Criminal Intelligence Commission'],
  ['Australian Transaction Reports and Analysis Centre'],
  ['Comcare'],
  ['Australian Institute of Health and Welfare'],
  ['Australian Financial Security Authority'],
  ['Australian Public Service Commission'],
  ['Australian National Audit Office'],
  ['Fair Work Commission'],
  ['Fair Work Ombudsman'],
  ['Clean Energy Regulator'],
  ['Australian Radiation Protection and Nuclear Safety Agency', 'melbourne'],
  ['National Archives of Australia'],
  ['Digital Transformation Agency'],
  ['Australian Space Agency', 'adelaide'],
  ['Safe Work Australia'],
  ['Australian Sports Commission'],
  ['National Indigenous Australians Agency'],
  ['Australian Institute of Family Studies', 'melbourne'],
  ['Australian War Memorial'],
  ['National Library of Australia'],
  ['Australian Trade and Investment Commission'],
  ['Australian Pesticides and Veterinary Medicines Authority'],
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
export function apsAgencyId(name: string): string {
  return 'aps-' + slug(name);
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
  const salaryNum = Math.round((100 + (h - 0.5) * 44) * 1000); // ~78k .. 122k (APS bands skew higher)
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(6 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 1].map((w, i) => 8 + Math.round(h * 40 * w) + i);
  const roles: RoleBreakdown[] = GOV_ROLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 16);
  const acr = govAcronym(name);
  return {
    id: apsAgencyId(name),
    ticker: acr,
    name,
    pill: acr,
    domain: deriveDomain(name),
    sector: 'Government',
    group: 'Infrastructure and Government',
    private: true,
    headcount: 0,
    growth: 0,
    openRoles: Math.round(10 + h * 240),
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

export const APS_GOV_COMPANIES: Company[] = AGENCIES.map(([name]) => buildGovAgency(name));
export const APS_GOV_IDS: string[] = APS_GOV_COMPANIES.map((c) => c.id);
export const APS_GOV_NAMES: string[] = AGENCIES.map(([name]) => name);

// id → hub (city) so the map pins each agency at its real HQ city (Canberra by
// default). Used by mapboxGeo.ts.
export const APS_GOV_HUB: Record<string, string> = Object.fromEntries(
  AGENCIES.map(([name, hub]) => [apsAgencyId(name), hub || 'canberra']),
);
