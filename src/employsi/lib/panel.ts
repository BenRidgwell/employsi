import { COMPANIES } from '../data/companies';

export interface BigStat {
  value: string | number;
  label: string;
  sub: string;
  subCls: string;
}

export interface PanelData {
  ticker: string;
  name: string;
  domain: string;
  sector: string;
  note: string;
  bigStats: BigStat[];
  subStats: { value: string; label: string }[];
  trend: number[];
  headcount: number;
  revPerEmp: number;
  ebitdaPerEmp: number;
  skillsLabel: string;
  skills: string[];
  roles: { title: string; count: number; pct: string }[];
  cta: string;
  companyId: string;
}

export function buildPanel(id: string | null): PanelData | null {
  if (!id) return null;
  const c = COMPANIES.find((x) => x.id === id);
  if (!c) return null;
  const gPos = c.growth >= 0;
  const gStr = (gPos ? '+' : '') + c.growth.toFixed(1) + '%';
  const bigStats: BigStat[] = [
    { value: c.openRoles, label: 'Open roles', sub: 'hiring now', subCls: '' },
    { value: c.salary, label: 'Median salary', sub: c.metroDelta, subCls: '' },
    { value: gStr, label: 'Headcount YoY', sub: gPos ? 'growing' : 'shrinking', subCls: gPos ? '' : 'neg' },
  ];
  const subStats = [
    { value: c.timeToFill, label: 'Typical hiring pace' },
    { value: c.roles[0].title, label: 'Biggest hiring area' },
  ];
  const mx = Math.max(...c.roles.map((r) => r.count));
  return {
    ticker: c.ticker,
    name: c.name,
    domain: c.domain,
    sector: c.sector,
    note: 'What you’d find here as a candidate',
    bigStats,
    subStats,
    trend: c.trend,
    headcount: c.headcount,
    revPerEmp: c.revPerEmp,
    ebitdaPerEmp: c.ebitdaPerEmp,
    skillsLabel: 'Skills in demand',
    skills: c.skills,
    roles: c.roles.map((r) => ({ title: r.title, count: r.count, pct: Math.round((r.count / mx) * 100) + '%' })),
    cta: 'View open roles',
    companyId: c.id,
  };
}
