import { COMPANIES } from '../data/companies';
import { COMPANY_CULTURE, INDUSTRY_BENCH, type Layoff } from '../data/culture';
import type { CompanyNews } from '../data/news';
import type { BhpFeed } from '../data/bhpFeed';

export interface BigStat {
  value: string | number;
  label: string;
  sub: string;
  subCls: string;
}

export interface SubStat {
  value: string;
  label: string;
  sub?: string;
  subCls?: string;
}

export interface Diversity {
  femalePct: number;
  payGap: number;
  payGapBench: number;
  womenLeadActual: number;
  womenLeadTarget: number;
  indigenousPct: number;
  indigenousBench: number;
}

export interface PanelData {
  ticker: string;
  exchange?: string;
  name: string;
  domain: string;
  sector: string;
  note: string;
  bigStats: BigStat[];
  subStats: SubStat[];
  trend: number[];
  headcount: number;
  revPerEmp: number;
  ebitdaPerEmp: number;
  skillsLabel: string;
  skills: string[];
  roles: { title: string; count: number; pct: string }[];
  roleOptions: string[];
  roleFocus: string | null;
  diversity: Diversity;
  layoffs: Layoff | null;
  news: CompanyNews | null;
  companyId: string;
}

// Stable 0..1 hash so per-role figures are deterministic.
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function buildPanel(id: string | null, roleTitle?: string | null, live?: BhpFeed): PanelData | null {
  if (!id) return null;
  const c = COMPANIES.find((x) => x.id === id);
  if (!c) return null;
  const culture = COMPANY_CULTURE[c.id];

  // Live feed (BHP) overrides the illustrative role breakdown / skills where
  // present, so counts, bars and the "biggest hiring area" all move.
  const roleList = live ? live.roles : c.roles;
  const topRole = roleList.reduce((a, b) => (b.count > a.count ? b : a)).title;

  let bigStats: BigStat[];
  let subStats: SubStat[];

  const glass = live ? live.glassdoor : culture ? culture.glassdoor : 3.6;
  const glassDelta = +(glass - INDUSTRY_BENCH.glassdoor).toFixed(1);
  const glassSub = (glassDelta >= 0 ? '+' : '−') + Math.abs(glassDelta).toFixed(1) + ' vs industry';
  const glassSub2: SubStat = { value: glass.toFixed(1) + ' ★', label: 'Glassdoor rating', sub: glassSub, subCls: glassDelta >= 0 ? '' : 'neg' };

  if (roleTitle) {
    // Role-focused figures, derived deterministically from the role title.
    const h = hash01(roleTitle);
    const h2 = hash01(roleTitle + '::g');
    const roleOpen = 6 + Math.round(h * 44);
    const roleSalary = Math.round((c.salaryNum * (0.9 + h * 0.24)) / 1000) * 1000;
    const roleGrowth = +(c.growth + (h2 - 0.5) * 6).toFixed(1);
    const rgPos = roleGrowth >= 0;
    bigStats = [
      { value: roleOpen, label: 'Open roles', sub: roleTitle, subCls: '' },
      { value: '$' + roleSalary.toLocaleString('en-US'), label: 'Median salary', sub: 'for this role', subCls: '' },
      { value: (rgPos ? '+' : '') + roleGrowth.toFixed(1) + '%', label: 'Role demand YoY', sub: rgPos ? 'growing' : 'cooling', subCls: rgPos ? '' : 'neg' },
    ];
    subStats = [glassSub2, { value: roleTitle, label: 'Focused role' }];
  } else {
    // Live feed (BHP) overrides the illustrative headline figures where present.
    const openRoles = live ? live.openRoles : c.openRoles;
    const salary = live ? live.salary : c.salary;
    const metroDelta = live ? live.metroDelta : c.metroDelta;
    const growth = live ? live.growth : c.growth;
    const gPos = growth >= 0;
    const gStr = (gPos ? '+' : '') + growth.toFixed(1) + '%';
    bigStats = [
      { value: openRoles, label: 'Open roles', sub: 'hiring now', subCls: '' },
      { value: salary, label: 'Median salary', sub: metroDelta, subCls: '' },
      { value: gStr, label: 'Headcount YoY', sub: gPos ? 'growing' : 'shrinking', subCls: gPos ? '' : 'neg' },
    ];
    subStats = [glassSub2, { value: topRole, label: 'Biggest hiring area' }];
  }

  const mx = Math.max(...roleList.map((r) => r.count));
  return {
    ticker: c.ticker,
    exchange: c.exchange,
    name: c.name,
    domain: c.domain,
    sector: c.sector,
    note: 'What you’d find here as a candidate',
    bigStats,
    subStats,
    trend: live ? live.trend : c.trend,
    headcount: live ? live.headcount : c.headcount,
    revPerEmp: live ? live.revPerEmp : c.revPerEmp,
    ebitdaPerEmp: live ? live.ebitdaPerEmp : c.ebitdaPerEmp,
    skillsLabel: 'Skills in demand',
    skills: live ? live.skills : c.skills,
    roles: roleList.map((r) => ({ title: r.title, count: r.count, pct: Math.round((r.count / mx) * 100) + '%' })),
    roleOptions: culture ? culture.roleOptions : [],
    roleFocus: roleTitle || null,
    diversity: live
      ? live.diversity
      : {
          femalePct: culture ? culture.femalePct : 25,
          payGap: culture ? culture.payGap : INDUSTRY_BENCH.payGap,
          payGapBench: INDUSTRY_BENCH.payGap,
          womenLeadActual: culture ? culture.womenLeadActual : 28,
          womenLeadTarget: culture ? culture.womenLeadTarget : 40,
          indigenousPct: culture ? culture.indigenousPct : INDUSTRY_BENCH.indigenous,
          indigenousBench: INDUSTRY_BENCH.indigenous,
        },
    layoffs: live ? live.layoffs : culture ? culture.layoffs : null,
    news: live ? live.news : null,
    companyId: c.id,
  };
}
