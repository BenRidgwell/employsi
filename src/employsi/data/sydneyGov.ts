import type { Company, RoleBreakdown } from './companies';
import { deriveDomain } from './rosters';

// New South Wales Government agencies — the NSW counterpart of perthGov.ts /
// adelaideGov.ts, sourced from the NSW public-sector structure (the ten
// portfolio departments plus the major agencies, health districts, justice and
// service bodies that advertise on iworkfor.nsw.gov.au). PRIVATE (not exchange-
// listed) public-sector bodies, mapped to the "Infrastructure and Government"
// sector group so the Government sector filter and the Public/Private listing
// filter both pick them up.
//
// ids are `nsw-gov-<slug>` — disjoint from the other jurisdictions' gov prefixes
// so a NSW agency is never confused/double-counted with a same-named body
// elsewhere. Live open-roles resolve from the NSW board archived in D1 (source
// 'nsw-gov') when a card is opened — see lib/openRolesFn.ts. Every NSW agency is
// plotted in Sydney (the state capital / seat of government), like WA→Perth. The
// scraper (scripts/nsw-gov-to-d1.py) matches a scraped job's organisation text
// back to one of these names (substring-tolerant), so the exact board labels
// don't have to be reproduced perfectly here.
const NAMES: string[] = [
  // Portfolio departments
  'Premier\'s Department',
  'The Cabinet Office',
  'Department of Communities and Justice',
  'Department of Customer Service',
  'Department of Education',
  'Department of Planning, Housing and Infrastructure',
  'Department of Primary Industries and Regional Development',
  'NSW Health',
  'Transport for NSW',
  'NSW Treasury',
  // Emergency services & policing
  'NSW Police Force',
  'Fire and Rescue NSW',
  'NSW Rural Fire Service',
  'NSW Ambulance',
  'NSW State Emergency Service',
  // Justice & legal
  'Corrective Services NSW',
  'Youth Justice NSW',
  'Legal Aid NSW',
  'Office of the Director of Public Prosecutions',
  'NSW Trustee and Guardian',
  'Crown Solicitor\'s Office',
  // Customer & revenue
  'Service NSW',
  'Revenue NSW',
  'TAFE NSW',
  'NSW Education Standards Authority',
  // Health entities
  'Sydney Local Health District',
  'South Eastern Sydney Local Health District',
  'Western Sydney Local Health District',
  'South Western Sydney Local Health District',
  'Northern Sydney Local Health District',
  'Nepean Blue Mountains Local Health District',
  'Hunter New England Local Health District',
  'eHealth NSW',
  'HealthShare NSW',
  'NSW Health Pathology',
  'Health Infrastructure',
  'Cancer Institute NSW',
  'Clinical Excellence Commission',
  // Transport operating agencies
  'Sydney Trains',
  'NSW Trains',
  // Planning, environment & land
  'NSW Environment Protection Authority',
  'National Parks and Wildlife Service',
  'Local Land Services',
  'NSW Reconstruction Authority',
  'Landcom',
  'Property and Development NSW',
  // Water & energy utilities
  'Sydney Water',
  'Hunter Water',
  'WaterNSW',
  'Essential Energy',
  'Forestry Corporation of NSW',
  // Insurance, regulation & oversight
  'icare NSW',
  'State Insurance Regulatory Authority',
  'Independent Pricing and Regulatory Tribunal',
  'Audit Office of New South Wales',
  'Independent Commission Against Corruption',
  'NSW Electoral Commission',
  // Culture & community
  'Destination NSW',
  'Create NSW',
  'Sydney Opera House',
  'Art Gallery of New South Wales',
  'Australian Museum',
  'State Library of New South Wales',
  'Museums of History NSW',
  'Aboriginal Affairs NSW',
  'Multicultural NSW',
];

const STOP = new Set(['of', 'and', 'the', 'for', '&', 'a', 'nsw']);

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
export function nswGovAgencyId(name: string): string {
  return 'nsw-gov-' + slug(name);
}

function govAcronym(name: string): string {
  const words = name.split(/[\s,]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  if (words.length >= 2) return words.map((w) => w[0].toUpperCase()).join('').slice(0, 6);
  return (words[0] || name).slice(0, 5).toUpperCase();
}

const GOV_SKILLS = ['Policy & Governance', 'Public Administration', 'Project Delivery', 'Data & Analytics', 'Community Services'];
const GOV_ROLES = ['Corporate & Policy', 'Frontline Services', 'Operations'];

function buildGovAgency(name: string): Company {
  const h = h01(name);
  const h2 = h01(name + '::b');
  const salaryNum = Math.round((96 + (h - 0.5) * 46) * 1000); // ~73k .. 119k
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(6 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 1].map((w, i) => 6 + Math.round(h * 30 * w) + i);
  const roles: RoleBreakdown[] = GOV_ROLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 16);
  const acr = govAcronym(name);
  return {
    id: nswGovAgencyId(name),
    ticker: acr,
    name,
    pill: acr,
    domain: deriveDomain(name),
    sector: 'Government',
    group: 'Infrastructure and Government',
    private: true,
    headcount: 0,
    growth: 0,
    openRoles: Math.round(8 + h * 120),
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

export const SYDNEY_GOV_COMPANIES: Company[] = NAMES.map(buildGovAgency);
export const SYDNEY_GOV_IDS: string[] = SYDNEY_GOV_COMPANIES.map((c) => c.id);
export const SYDNEY_GOV_NAMES: string[] = NAMES.slice();
