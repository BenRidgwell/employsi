import { COMPANIES, companyGroup } from "../data/companies";
import { COMPANY_CULTURE, INDUSTRY_BENCH, type Layoff } from "../data/culture";
import { COMPANY_HEADCOUNT } from "../data/companyHeadcount";
import { GOV_HEADCOUNT } from "../data/perthGovWorkforce";
import type { CompanyNews } from "../data/news";
import type { BhpFeed } from "../data/bhpFeed";

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
}

export interface PanelData {
  ticker: string;
  exchange?: string;
  name: string;
  domain: string;
  sector: string;
  group: string;
  note: string;
  bigStats: BigStat[];
  subStats: SubStat[];
  trend: number[];
  headcount: number;
  headcountReal: boolean; // true only when headcount/trend come from a real source
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

export function buildPanel(
  id: string | null,
  roleTitle?: string | null,
  live?: BhpFeed,
): PanelData | null {
  if (!id) return null;
  const c = COMPANIES.find((x) => x.id === id);
  if (!c) return null;
  const culture = COMPANY_CULTURE[c.id];

  // Live feed (BHP) overrides the illustrative role breakdown / skills where
  // present, so counts, bars and the "biggest hiring area" all move.
  const roleList = live ? live.roles : c.roles;
  const topRole = roleList.reduce((a, b) => (b.count > a.count ? b : a)).title;
  // Real reported headcount (static), where we have it: listed companies from
  // their annual reports, WA government agencies from the PSC workforce bulletins.
  const hc = COMPANY_HEADCOUNT[c.id] ?? GOV_HEADCOUNT[c.id];

  let bigStats: BigStat[];
  let subStats: SubStat[];

  if (roleTitle) {
    // Role-focused figures, derived deterministically from the role title.
    const h = hash01(roleTitle);
    const h2 = hash01(roleTitle + "::g");
    const roleOpen = 6 + Math.round(h * 44);
    const roleSalary = Math.round((c.salaryNum * (0.9 + h * 0.24)) / 1000) * 1000;
    const roleGrowth = +(c.growth + (h2 - 0.5) * 6).toFixed(1);
    const rgPos = roleGrowth >= 0;
    bigStats = [
      { value: roleOpen, label: "Open roles", sub: roleTitle, subCls: "" },
      {
        value: "$" + roleSalary.toLocaleString("en-US"),
        label: "Median salary",
        sub: "for this role",
        subCls: "",
      },
      {
        value: (rgPos ? "+" : "") + roleGrowth.toFixed(1) + "%",
        label: "Role demand YoY",
        sub: rgPos ? "growing" : "cooling",
        subCls: rgPos ? "" : "neg",
      },
    ];
    subStats = [{ value: roleTitle, label: "Focused role" }];
  } else {
    // Live feed (BHP) overrides the illustrative headline figures where present.
    const openRoles = live ? live.openRoles : c.openRoles;
    const salary = live ? live.salary : c.salary;
    const metroDelta = live ? live.metroDelta : c.metroDelta;
    // Headcount growth: real YoY from the company's annual report where we have
    // it (static, not a live feed), else the illustrative figure.
    const growth = hc ? hc.yoy : live ? live.growth : c.growth;
    const gPos = growth >= 0;
    const gStr = (gPos ? "+" : "") + growth.toFixed(1) + "%";
    bigStats = [
      { value: openRoles, label: "Open roles", sub: "hiring now", subCls: "" },
      { value: salary, label: "Median salary", sub: metroDelta, subCls: "" },
      {
        value: gStr,
        label: "Headcount YoY",
        sub: hc ? `${hc.now.toLocaleString("en-US")} · ${hc.asof}` : gPos ? "growing" : "shrinking",
        subCls: gPos ? "" : "neg",
      },
    ];
    subStats = [{ value: topRole, label: "Biggest hiring area" }];
  }

  const mx = Math.max(...roleList.map((r) => r.count));
  return {
    ticker: c.ticker,
    exchange: c.exchange,
    name: c.name,
    domain: c.domain,
    sector: c.sector,
    group: companyGroup(c),
    note: "What you’d find here as a candidate",
    bigStats,
    subStats,
    trend: live ? live.trend : c.trend,
    headcount: hc ? hc.now : live ? live.headcount : c.headcount,
    // Real only when it comes from an annual report (COMPANY_HEADCOUNT / gov
    // bulletins) or the live feed — never the illustrative per-company figure.
    headcountReal: !!hc || !!live,
    revPerEmp: live ? live.revPerEmp : c.revPerEmp,
    ebitdaPerEmp: live ? live.ebitdaPerEmp : c.ebitdaPerEmp,
    skillsLabel: "Skills in demand",
    skills: live ? live.skills : c.skills,
    roles: roleList.map((r) => ({
      title: r.title,
      count: r.count,
      pct: Math.round((r.count / mx) * 100) + "%",
    })),
    roleOptions: culture ? culture.roleOptions : [],
    roleFocus: roleTitle || null,
    diversity: live
      ? live.diversity
      : {
          femalePct: culture ? culture.femalePct : 25,
          payGap: culture ? culture.payGap : INDUSTRY_BENCH.payGap,
          payGapBench: INDUSTRY_BENCH.payGap,
        },
    layoffs: live ? live.layoffs : culture ? culture.layoffs : null,
    // ALWAYS null, even for BHP — see below. This is what makes the news column
    // ask for live coverage.
    //
    // BHP is the one company handed a `live` BhpFeed (CompanyPanel gates it on
    // `lastId === "bhp"`), and that feed carried a `news` block built from
    // data/news.ts's curated set with its comment counts wobbled to look like
    // movement. Passing it through here set NewsPanel's `live` prop, which
    // makes it compute `liveQuery = null` — and that DISABLES the live news
    // query outright. So the one company with a bespoke feed was the only one
    // that never fetched real coverage, and its card showed the same static
    // headlines indefinitely: on 2026-08-13 it was still leading with a CEO
    // transition from March and a MINING.COM piece four months old.
    //
    // That is the opposite of what the rest of the panel intends — NewsPanel's
    // own comment says every company fetches the live feed and the curated set
    // is the FALLBACK. BHP now does the same, and still falls back to exactly
    // those articles on a day the live feed returns nothing.
    //
    // The BhpFeed's other fields are untouched; only its news is ignored.
    news: null,
    companyId: c.id,
  };
}
