import type { Company, RoleBreakdown } from "./companies";
import { deriveDomain } from "./rosters";

// Tasmanian Government agencies — the TAS counterpart of perthGov.ts /
// darwinGov.ts, sourced from the official TAS jobs board
// (careers.jobs.tas.gov.au). PRIVATE (not exchange-listed) public-sector bodies,
// mapped to the "Infrastructure and Government" sector group so the Government
// sector filter and the Public/Private listing filter both pick them up.
//
// ids are `tas-gov-<slug>` — disjoint from the other jurisdictions' gov prefixes
// so a TAS agency is never confused/double-counted with a same-named body
// elsewhere. Live open-roles resolve from the TAS board archived in D1 (source
// 'tas-gov') when a card is opened — see lib/openRolesFn.ts. Every TAS agency is
// plotted in Hobart (the state capital / seat of government), like WA→Perth.
//
// Each entry carries the board's own department-filter uid, so the scraper can
// pull that agency's vacancies directly (the job cards don't name the agency).
type AgencyEntry = [name: string, uid: string];
const AGENCIES: AgencyEntry[] = [
  ["Department of Health", "9b5c83e734333d5083d0e364b7eb365b"],
  ["Department for Education, Children and Young People", "f29cf7f0920a347cbc2a5318f5ad9705"],
  ["Department of Justice", "dcd2cfb8d287c6bf0d4803356a50dc21"],
  ["Department of Natural Resources and Environment Tasmania", "8905cadb4c381441137263b48688da6b"],
  ["Department of Police, Fire and Emergency Management", "33233760a1e15b5bd2410b05dcedec32"],
  ["Department of Premier and Cabinet", "915dcc05e40c9da041d80382140e5505"],
  ["Whole of Government Programs", "4d65325705e8035fc6a3caa107736e6f"],
  ["Building Tasmania", "b6c1ab6ddbfab736334b3b0fdf1ebf72"],
  ["Homes Tasmania", "8f21a44c208a3586c58c805545dca62b"],
  ["Macquarie Point Development Corporation", "338fea147c23bf7f11ebac7598114bf6"],
  ["Port Arthur Historic Site Management Authority", "11feb6da0afcfe16dfa2d7b4d13c16f7"],
  ["Public Trustee", "7be4cd92ed2181c4a6edf97a901b0ca5"],
  ["Tourism Tasmania", "d107644391af02536572fc2bb9465cc7"],
];

const STOP = new Set(["of", "and", "the", "for", "&", "a"]);

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
export function tasGovAgencyId(name: string): string {
  return "tas-gov-" + slug(name);
}

function govAcronym(name: string): string {
  const words = name.split(/[\s,]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  if (words.length >= 2)
    return words
      .map((w) => w[0].toUpperCase())
      .join("")
      .slice(0, 6);
  return (words[0] || name).slice(0, 5).toUpperCase();
}

const GOV_SKILLS = [
  "Policy & Governance",
  "Public Administration",
  "Project Delivery",
  "Data & Analytics",
  "Community Services",
];
const GOV_ROLES = ["Corporate & Policy", "Frontline Services", "Operations"];

function buildGovAgency(name: string): Company {
  const h = h01(name);
  const h2 = h01(name + "::b");
  const salaryNum = Math.round((94 + (h - 0.5) * 42) * 1000); // ~73k .. 115k
  const salaryK = Math.round(salaryNum / 1000);
  const turnover = +(6 + h2 * 8).toFixed(1);
  const roleCounts = [3, 2, 1].map((w, i) => 5 + Math.round(h * 26 * w) + i);
  const roles: RoleBreakdown[] = GOV_ROLES.map((title, i) => ({ title, count: roleCounts[i] }));
  const delta = Math.round((h - 0.5) * 16);
  const acr = govAcronym(name);
  return {
    id: tasGovAgencyId(name),
    ticker: acr,
    name,
    pill: acr,
    domain: deriveDomain(name),
    sector: "Government",
    group: "Infrastructure and Government",
    private: true,
    headcount: 0,
    growth: 0,
    openRoles: Math.round(5 + h * 90),
    salary: `$${salaryNum.toLocaleString("en-US")}`,
    salaryShort: `$${salaryK}K`,
    salaryNum,
    turnover,
    salaryDelta: `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%`,
    metroDelta: `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}% vs metro`,
    trend: [],
    revPerEmp: 0,
    ebitdaPerEmp: 0,
    timeToFill: `${Math.round(34 + h * 24)} days`,
    competition: h > 0.66 ? "High" : h > 0.33 ? "Medium" : "Low",
    skills: GOV_SKILLS,
    roles,
  };
}

export const HOBART_GOV_COMPANIES: Company[] = AGENCIES.map(([name]) => buildGovAgency(name));
export const HOBART_GOV_IDS: string[] = HOBART_GOV_COMPANIES.map((c) => c.id);
export const HOBART_GOV_NAMES: string[] = AGENCIES.map(([name]) => name);

// agency id → the TAS board's department-filter uid (for the scraper).
export const TAS_GOV_UID: Record<string, string> = Object.fromEntries(
  AGENCIES.map(([name, uid]) => [tasGovAgencyId(name), uid]),
);
