// Simulated *live* data feed for BHP — the pilot company for real-time metrics.
// Every field drifts as a smooth function of the current time, so successive
// polls return subtly different values (a stand-in for genuine market / jobs /
// social feeds). The shape is deliberately generic so a real provider can be
// dropped in behind the same interface later.

import { COMPANIES } from './companies';
import { COMPANY_CULTURE, INDUSTRY_BENCH, type Layoff } from './culture';
import { shareTrend, commodityBaskets, type CommodityBasket } from './finance';
import { companySocial, type SocialSummary } from './social';
import { companyNews, type CompanyNews } from './news';

export interface BhpDiversity {
  femalePct: number;
  payGap: number;
  payGapBench: number;
  womenLeadActual: number;
  womenLeadTarget: number;
  indigenousPct: number;
  indigenousBench: number;
}

export interface BhpFeed {
  updatedAt: number;
  // headline stats
  openRoles: number;
  salary: string;
  salaryNum: number;
  metroDelta: string;
  headcount: number;
  growth: number;
  glassdoor: number;
  // workforce trend inputs
  trend: number[];
  revPerEmp: number;
  ebitdaPerEmp: number;
  // financial trends
  sharePrice: number[];
  commodities: Record<CommodityBasket, number[]>;
  // engagement + diversity
  social: SocialSummary;
  diversity: BhpDiversity;
  // demand-ranked skills, open roles by area, restructuring + news engagement
  skills: string[];
  roles: { title: string; count: number }[];
  layoffs: Layoff;
  news: CompanyNews;
}

// Smooth −1..1 oscillator; different periods/phases decorrelate the fields.
const wob = (now: number, periodMs: number, phase: number) => Math.sin(now / periodMs + phase);

export function buildBhpFeed(now: number = Date.now()): BhpFeed {
  const c = COMPANIES.find((x) => x.id === 'bhp')!;
  const cul = COMPANY_CULTURE.bhp;
  const n = c.trend.length;

  const d1 = wob(now, 3200, 0);
  const d2 = wob(now, 7100, 1.3);
  const d3 = wob(now, 11000, 2.1);
  const d4 = wob(now, 5300, 0.7);

  const openRoles = Math.max(0, Math.round(c.openRoles + d1 * 7));
  const salaryNum = Math.round((c.salaryNum + d2 * 1600) / 100) * 100;
  const headcount = Math.round(c.headcount + d3 * 45);
  const growth = +(c.growth + d1 * 0.3).toFixed(1);
  const glassdoor = +Math.min(5, Math.max(0, cul.glassdoor + d2 * 0.05)).toFixed(1);
  const revPerEmp = +(c.revPerEmp * (1 + d4 * 0.01)).toFixed(2);
  const ebitdaPerEmp = +(c.ebitdaPerEmp * (1 + d2 * 0.012)).toFixed(2);

  // Nudge only the latest (current-quarter) point of each series so the history
  // stays stable but the live edge moves.
  const trend = c.trend.slice();
  trend[n - 1] = +Math.min(105, Math.max(90, trend[n - 1] + d1 * 0.6)).toFixed(1);

  const sharePrice = shareTrend(c.ticker, c.trend);
  sharePrice[n - 1] = +(sharePrice[n - 1] * (1 + d2 * 0.012)).toFixed(2);

  const commodities = commodityBaskets(n);
  commodities.base[n - 1] = +(commodities.base[n - 1] * (1 + d1 * 0.015)).toFixed(1);
  commodities.precious[n - 1] = +(commodities.precious[n - 1] * (1 + d3 * 0.012)).toFixed(1);
  commodities.oilLng[n - 1] = +(commodities.oilLng[n - 1] * (1 + d4 * 0.02)).toFixed(1);

  const baseSocial = companySocial('bhp', c.trend[n - 1] - c.trend[0]);
  const social: SocialSummary = {
    ...baseSocial,
    redditMentions: Math.max(0, Math.round(baseSocial.redditMentions + d1 * 9)),
    xMentions: Math.max(0, Math.round(baseSocial.xMentions + d2 * 45)),
    redditDelta: +(baseSocial.redditDelta + d3 * 1.6).toFixed(1),
    xDelta: +(baseSocial.xDelta + d1 * 1.3).toFixed(1),
  };

  // Skills reordered by a live "demand score": the base ranking (first = most
  // in demand) nudged by a per-skill oscillator so adjacent skills can trade
  // places poll-to-poll.
  const skills = c.skills
    .map((sk, i) => ({ sk, score: c.skills.length - i + wob(now, 4000 + i * 900, i * 1.1) * 1.4 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.sk);

  // Open roles by area — each area's live count drifts around its base.
  const roles = c.roles.map((r, i) => ({
    title: r.title,
    count: Math.max(0, Math.round(r.count + wob(now, 3800 + i * 700, i * 0.9) * 6)),
  }));

  // Live restructuring figure (BHP has no static layoffs record). Roles drift
  // slowly; pct is derived from the live headcount so the two stay consistent.
  const layoffRoles = Math.max(0, Math.round(140 + d3 * 12));
  const layoffs: Layoff = {
    period: 'Rolling 12 months',
    roles: layoffRoles,
    pct: +((layoffRoles / headcount) * 100).toFixed(1),
    note: 'Targeted restructuring in corporate and support functions; most affected roles redeployed within the group.',
  };

  // News engagement: keep the (deterministic) headlines stable but let the
  // comment counts tick as a live signal.
  const baseNews = companyNews(c.name, c.sector);
  const bumpC = (v: number, i: number) => Math.max(0, Math.round(v + wob(now, 4200 + i * 600, i * 0.6) * 5));
  const news: CompanyNews = {
    hero: { ...baseNews.hero, comments: bumpC(baseNews.hero.comments, 0) },
    items: baseNews.items.map((it, i) => ({ ...it, comments: bumpC(it.comments, i + 1) })),
  };

  const diversity: BhpDiversity = {
    femalePct: +Math.max(0, cul.femalePct + d4 * 0.4).toFixed(1),
    payGap: +Math.max(0, cul.payGap + d2 * 0.3).toFixed(1),
    payGapBench: INDUSTRY_BENCH.payGap,
    womenLeadActual: +Math.max(0, cul.womenLeadActual + d1 * 0.5).toFixed(1),
    womenLeadTarget: cul.womenLeadTarget,
    indigenousPct: +Math.max(0, cul.indigenousPct + d3 * 0.1).toFixed(1),
    indigenousBench: INDUSTRY_BENCH.indigenous,
  };

  return {
    updatedAt: now,
    openRoles,
    salary: '$' + salaryNum.toLocaleString('en-US'),
    salaryNum,
    metroDelta: c.metroDelta,
    headcount,
    growth,
    glassdoor,
    trend,
    revPerEmp,
    ebitdaPerEmp,
    sharePrice,
    commodities,
    social,
    diversity,
    skills,
    roles,
    layoffs,
    news,
  };
}
