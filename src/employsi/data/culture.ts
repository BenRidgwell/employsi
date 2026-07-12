// Illustrative culture / diversity data per company, plus searchable role
// options. Figures are placeholders for demonstration.

export interface Layoff {
  period: string;
  roles: number;
  pct: number;
  note: string;
}

export interface CultureData {
  glassdoor: number; // out of 5
  femalePct: number; // % of workforce
  payGap: number; // median gender pay gap %, women vs men
  womenLeadActual: number; // % women in leadership
  womenLeadTarget: number; // % target
  indigenousPct: number; // % Indigenous employment
  layoffs: Layoff | null;
  roleOptions: string[];
}

// Resources-sector benchmarks used for relative comparisons. payGap and
// indigenous are real published figures (not placeholders): payGap is WGEA's
// 2023-24 median total-remuneration gender pay gap for the Australian mining
// industry (19.9%); indigenous is the mining industry's Indigenous employment
// share per the 2021 Census (4.6%, ABS/Australia Institute reporting).
export const INDUSTRY_BENCH = {
  glassdoor: 3.6,
  payGap: 19.9,
  indigenous: 4.6,
};

export const COMPANY_CULTURE: Record<string, CultureData> = {
  rio: {
    glassdoor: 3.9,
    femalePct: 22,
    payGap: 12.4,
    womenLeadActual: 31,
    womenLeadTarget: 40,
    indigenousPct: 3.1,
    layoffs: null,
    roleOptions: ['Mining Engineer', 'Geologist', 'Process Engineer', 'Rail Operations', 'Maintenance Technician', 'Autonomous Systems Specialist'],
  },
  // Real figures (bhp.com WGEA Employer Statement + Sustainability Report,
  // FY2024/FY2025): Glassdoor 4.1/5 (2,614 reviews); female workforce 41.3%
  // (FY2025); median gender pay gap 11.2% (2023-24, WGEA); women people
  // leaders 36.5%, shown against BHP's own public 50% workforce-gender
  // target; Indigenous employment 8.3% (Minerals Australia, FY2024) — BHP's
  // own FY2027 target for this is 9.7%, higher than the shared industry
  // benchmark below, so the card understates how far BHP is from its own goal.
  bhp: {
    glassdoor: 4.1,
    femalePct: 41.3,
    payGap: 11.2,
    womenLeadActual: 36.5,
    womenLeadTarget: 50,
    indigenousPct: 8.3,
    layoffs: null,
    roleOptions: ['Mining Engineer', 'Maintenance Planner', 'Data Analyst', 'HSE Advisor', 'Mobile Plant Operator', 'Electrical Engineer'],
  },
  s32: {
    glassdoor: 3.7,
    femalePct: 24,
    payGap: 13.1,
    womenLeadActual: 27,
    womenLeadTarget: 33,
    indigenousPct: 2.8,
    layoffs: { period: 'Q4 2025', roles: 180, pct: -2.4, note: 'Manganese cost-reduction program' },
    roleOptions: ['Metallurgist', 'Maintenance Technician', 'Supply Chain Analyst', 'Process Operator', 'Finance Analyst', 'Sustainability Lead'],
  },
  fmg: {
    glassdoor: 3.8,
    femalePct: 26,
    payGap: 9.6,
    womenLeadActual: 30,
    womenLeadTarget: 40,
    indigenousPct: 11.5,
    layoffs: { period: 'Q3 2025', roles: 700, pct: -3.1, note: 'Energy division restructure' },
    roleOptions: ['Electrical Engineer', 'Project Engineer', 'Renewables Specialist', 'Automation Engineer', 'HSE Advisor', 'Heavy Diesel Mechanic'],
  },
  wds: {
    glassdoor: 3.9,
    femalePct: 29,
    payGap: 11.2,
    womenLeadActual: 32,
    womenLeadTarget: 40,
    indigenousPct: 2.4,
    layoffs: null,
    roleOptions: ['Subsea Engineer', 'Reservoir Engineer', 'Project Controls', 'LNG Operator', 'Process Engineer', 'Drilling Supervisor'],
  },
  sto: {
    glassdoor: 3.6,
    femalePct: 27,
    payGap: 12.0,
    womenLeadActual: 29,
    womenLeadTarget: 35,
    indigenousPct: 2.6,
    layoffs: { period: 'Q1 2026', roles: 90, pct: -1.6, note: 'Cost-discipline program' },
    roleOptions: ['Petroleum Engineer', 'Facilities Engineer', 'HSE Advisor', 'Commercial Analyst', 'Drilling Engineer', 'Operations Technician'],
  },
  sfr: {
    glassdoor: 3.5,
    femalePct: 21,
    payGap: 14.2,
    womenLeadActual: 24,
    womenLeadTarget: 30,
    indigenousPct: 2.2,
    layoffs: null,
    roleOptions: ['Metallurgist', 'Mine Geologist', 'Maintenance Technician', 'Process Operator', 'Environmental Advisor', 'Mining Engineer'],
  },
  igo: {
    glassdoor: 3.8,
    femalePct: 30,
    payGap: 10.4,
    womenLeadActual: 33,
    womenLeadTarget: 40,
    indigenousPct: 3.4,
    layoffs: null,
    roleOptions: ['Process Engineer', 'Hydromet Specialist', 'Exploration Geologist', 'Data Scientist', 'Sustainability Advisor', 'Maintenance Planner'],
  },
  min: {
    glassdoor: 3.4,
    femalePct: 20,
    payGap: 14.6,
    womenLeadActual: 23,
    womenLeadTarget: 30,
    indigenousPct: 4.2,
    layoffs: { period: 'Q2 2026', roles: 260, pct: -3.8, note: 'Onslow Iron ramp-down' },
    roleOptions: ['Heavy Diesel Mechanic', 'Process Operator', 'Drill & Blast Engineer', 'Crushing Supervisor', 'Automation Engineer', 'HSE Advisor'],
  },
  pls: {
    glassdoor: 3.9,
    femalePct: 27,
    payGap: 10.2,
    womenLeadActual: 31,
    womenLeadTarget: 40,
    indigenousPct: 6.4,
    layoffs: null,
    roleOptions: ['Metallurgist', 'Process Engineer', 'Maintenance Technician', 'Battery Metals Specialist', 'Sustainability Advisor', 'Mine Geologist'],
  },
  ltr: {
    glassdoor: 3.7,
    femalePct: 29,
    payGap: 9.4,
    womenLeadActual: 30,
    womenLeadTarget: 40,
    indigenousPct: 7.8,
    layoffs: null,
    roleOptions: ['Project Engineer', 'Metallurgist', 'Mine Geologist', 'Process Operator', 'Automation Engineer', 'Environmental Advisor'],
  },
  ilu: {
    glassdoor: 3.6,
    femalePct: 25,
    payGap: 12.2,
    womenLeadActual: 28,
    womenLeadTarget: 35,
    indigenousPct: 3.0,
    layoffs: null,
    roleOptions: ['Chemical Engineer', 'Rare Earths Specialist', 'Metallurgist', 'Process Operator', 'Environmental Advisor', 'Maintenance Planner'],
  },
  nst: {
    glassdoor: 3.8,
    femalePct: 23,
    payGap: 12.8,
    womenLeadActual: 26,
    womenLeadTarget: 33,
    indigenousPct: 5.6,
    layoffs: null,
    roleOptions: ['Underground Miner', 'Metallurgist', 'Mine Geologist', 'Maintenance Technician', 'Ventilation Engineer', 'HSE Advisor'],
  },
  chevron: {
    glassdoor: 4.1,
    femalePct: 30,
    payGap: 11.6,
    womenLeadActual: 33,
    womenLeadTarget: 40,
    indigenousPct: 2.5,
    layoffs: null,
    roleOptions: ['LNG Operator', 'Reservoir Engineer', 'Subsea Engineer', 'Facilities Engineer', 'Process Engineer', 'HSE Advisor'],
  },
  beach: {
    glassdoor: 3.6,
    femalePct: 26,
    payGap: 12.9,
    womenLeadActual: 28,
    womenLeadTarget: 35,
    indigenousPct: 2.3,
    layoffs: null,
    roleOptions: ['Petroleum Engineer', 'Drilling Engineer', 'Facilities Engineer', 'Production Technician', 'Commercial Analyst', 'HSE Advisor'],
  },
  mgt: {
    glassdoor: 3.3,
    femalePct: 22,
    payGap: 14.4,
    womenLeadActual: 22,
    womenLeadTarget: 30,
    indigenousPct: 3.2,
    layoffs: null,
    roleOptions: ['Metallurgist', 'Mining Engineer', 'Process Engineer', 'Project Engineer', 'Environmental Advisor', 'Geologist'],
  },
  hgo: {
    glassdoor: 3.4,
    femalePct: 21,
    payGap: 13.9,
    womenLeadActual: 23,
    womenLeadTarget: 30,
    indigenousPct: 2.7,
    layoffs: null,
    roleOptions: ['Underground Miner', 'Metallurgist', 'Mine Geologist', 'Process Operator', 'Maintenance Technician', 'HSE Advisor'],
  },
  smr: {
    glassdoor: 3.5,
    femalePct: 20,
    payGap: 14.1,
    womenLeadActual: 24,
    womenLeadTarget: 30,
    indigenousPct: 3.8,
    layoffs: null,
    roleOptions: ['Mining Engineer', 'Coal Geologist', 'Maintenance Planner', 'Process Operator', 'Wash Plant Technician', 'HSE Advisor'],
  },
  nhc: {
    glassdoor: 3.6,
    femalePct: 22,
    payGap: 13.4,
    womenLeadActual: 25,
    womenLeadTarget: 33,
    indigenousPct: 4.0,
    layoffs: null,
    roleOptions: ['Mining Engineer', 'Coal Geologist', 'Environmental Advisor', 'Process Operator', 'Maintenance Technician', 'Rehabilitation Specialist'],
  },
  shell: {
    glassdoor: 4.0,
    femalePct: 32,
    payGap: 10.6,
    womenLeadActual: 35,
    womenLeadTarget: 42,
    indigenousPct: 2.4,
    layoffs: null,
    roleOptions: ['LNG Operator', 'Reservoir Engineer', 'Process Engineer', 'Trading Analyst', 'Facilities Engineer', 'HSE Advisor'],
  },
  aow: {
    glassdoor: 3.7,
    femalePct: 27,
    payGap: 12.2,
    womenLeadActual: 29,
    womenLeadTarget: 38,
    indigenousPct: 3.5,
    layoffs: null,
    roleOptions: ['Petroleum Engineer', 'Well Delivery Engineer', 'Facilities Engineer', 'Production Technician', 'Land Access Advisor', 'HSE Advisor'],
  },
  mmi: {
    glassdoor: 3.4,
    femalePct: 23,
    payGap: 13.6,
    womenLeadActual: 24,
    womenLeadTarget: 32,
    indigenousPct: 6.2,
    layoffs: null,
    roleOptions: ['Mining Engineer', 'Metallurgist', 'Barge Operator', 'Process Operator', 'Environmental Advisor', 'Maintenance Technician'],
  },
  jellinbah: {
    glassdoor: 3.5,
    femalePct: 19,
    payGap: 14.8,
    womenLeadActual: 21,
    womenLeadTarget: 28,
    indigenousPct: 3.6,
    layoffs: null,
    roleOptions: ['Mining Engineer', 'Coal Geologist', 'Wash Plant Technician', 'Maintenance Planner', 'Process Operator', 'HSE Advisor'],
  },
};
