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

// Resources-sector benchmarks used for relative comparisons.
export const INDUSTRY_BENCH = {
  glassdoor: 3.6,
  payGap: 13.8,
  indigenous: 3.3,
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
  bhp: {
    glassdoor: 4.0,
    femalePct: 28,
    payGap: 10.8,
    womenLeadActual: 34,
    womenLeadTarget: 40,
    indigenousPct: 3.6,
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
};
