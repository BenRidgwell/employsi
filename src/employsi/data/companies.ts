export interface RoleBreakdown {
  title: string;
  count: number;
}

export interface Company {
  id: string;
  ticker: string;
  name: string;
  domain: string;
  sector: string;
  headcount: number;
  growth: number;
  openRoles: number;
  salary: string;
  salaryShort: string;
  salaryNum: number;
  turnover: number;
  salaryDelta: string;
  metroDelta: string;
  trend: number[];
  /** Latest-quarter financial productivity, $ millions per employee. */
  revPerEmp: number;
  ebitdaPerEmp: number;
  timeToFill: string;
  competition: string;
  skills: string[];
  roles: RoleBreakdown[];
}

export const COMPANIES: Company[] = [
  { id: 'rio', ticker: 'RIO', name: 'Rio Tinto', domain: 'riotinto.com', sector: 'Iron Ore & Metals', headcount: 11500, growth: 4.1, openRoles: 268, salary: '$152,000', salaryShort: '$152K', salaryNum: 152000, turnover: 9.8, salaryDelta: '+13%', metroDelta: '+13% vs metro', trend: [92, 93, 94, 95, 96, 97, 99, 100], revPerEmp: 2.42, ebitdaPerEmp: 1.12, timeToFill: '52 days', competition: 'High', skills: ['Geoscience', 'Process Engineering', 'Remote Operations', 'Rail Systems', 'Decarbonisation'], roles: [{ title: 'Engineering', count: 57 }, { title: 'Geoscience', count: 39 }, { title: 'Rail & Logistics', count: 33 }] },
  { id: 'bhp', ticker: 'BHP', name: 'BHP', domain: 'bhp.com', sector: 'Diversified Mining', headcount: 9200, growth: 6.4, openRoles: 312, salary: '$148,000', salaryShort: '$148K', salaryNum: 148000, turnover: 11.2, salaryDelta: '+10%', metroDelta: '+10% vs metro', trend: [86, 88, 89, 91, 93, 95, 98, 100], revPerEmp: 2.65, ebitdaPerEmp: 1.28, timeToFill: '47 days', competition: 'High', skills: ['Mining Engineering', 'Autonomous Haulage', 'Data Analytics', 'HSE', 'Maintenance Planning'], roles: [{ title: 'Maintenance & Trades', count: 84 }, { title: 'Engineering', count: 61 }, { title: 'Operations', count: 48 }] },
  { id: 's32', ticker: 'S32', name: 'South32', domain: 'south32.net', sector: 'Metals & Mining', headcount: 3400, growth: 2.0, openRoles: 124, salary: '$141,000', salaryShort: '$141K', salaryNum: 141000, turnover: 12.5, salaryDelta: '+4%', metroDelta: '+4% vs metro', trend: [95, 96, 96, 97, 98, 98, 99, 100], revPerEmp: 1.38, ebitdaPerEmp: 0.52, timeToFill: '44 days', competition: 'Medium', skills: ['Metallurgy', 'Supply Chain', 'Sustainability', 'Finance', 'Maintenance'], roles: [{ title: 'Metallurgy & Processing', count: 31 }, { title: 'Maintenance', count: 27 }, { title: 'Corporate', count: 22 }] },
  { id: 'fmg', ticker: 'FMG', name: 'Fortescue', domain: 'fortescue.com', sector: 'Iron Ore & Green Energy', headcount: 7800, growth: 12.3, openRoles: 415, salary: '$139,000', salaryShort: '$139K', salaryNum: 139000, turnover: 14.6, salaryDelta: '+3%', metroDelta: '+3% vs metro', trend: [70, 74, 79, 83, 87, 92, 96, 100], revPerEmp: 1.92, ebitdaPerEmp: 0.94, timeToFill: '39 days', competition: 'Very high', skills: ['Renewable Energy', 'Hydrogen', 'Electrical Engineering', 'Project Delivery', 'Automation'], roles: [{ title: 'Renewables & Electrical', count: 96 }, { title: 'Project Delivery', count: 71 }, { title: 'Operations', count: 58 }] },
  { id: 'wds', ticker: 'WDS', name: 'Woodside Energy', domain: 'woodside.com', sector: 'Oil, Gas & LNG', headcount: 3900, growth: 5.2, openRoles: 201, salary: '$158,000', salaryShort: '$158K', salaryNum: 158000, turnover: 8.4, salaryDelta: '+18%', metroDelta: '+18% vs metro', trend: [88, 90, 91, 93, 95, 96, 98, 100], revPerEmp: 3.05, ebitdaPerEmp: 1.46, timeToFill: '50 days', competition: 'High', skills: ['Subsea Engineering', 'LNG Processing', 'Reservoir Engineering', 'Carbon Capture', 'Project Controls'], roles: [{ title: 'Subsurface & Reservoir', count: 48 }, { title: 'Project Delivery', count: 41 }, { title: 'Operations', count: 34 }] },
  { id: 'sto', ticker: 'STO', name: 'Santos', domain: 'santos.com', sector: 'Oil & Gas', headcount: 1400, growth: 3.3, openRoles: 88, salary: '$149,000', salaryShort: '$149K', salaryNum: 149000, turnover: 10.1, salaryDelta: '+11%', metroDelta: '+11% vs metro', trend: [93, 94, 95, 96, 97, 98, 99, 100], revPerEmp: 2.18, ebitdaPerEmp: 0.90, timeToFill: '46 days', competition: 'Medium', skills: ['Petroleum Engineering', 'Facilities Engineering', 'HSE', 'Commercial', 'Drilling'], roles: [{ title: 'Facilities Engineering', count: 24 }, { title: 'Commercial & Trading', count: 19 }, { title: 'Operations', count: 17 }] },
  { id: 'sfr', ticker: 'SFR', name: 'Sandfire Resources', domain: 'sandfire.com.au', sector: 'Copper & Base Metals', headcount: 1050, growth: 3.8, openRoles: 62, salary: '$137,000', salaryShort: '$137K', salaryNum: 137000, turnover: 11.0, salaryDelta: '+2%', metroDelta: '+2% vs metro', trend: [97, 98, 98, 99, 99, 99, 100, 100], revPerEmp: 1.28, ebitdaPerEmp: 0.48, timeToFill: '45 days', competition: 'Medium', skills: ['Copper Processing', 'Mine Geology', 'Metallurgy', 'Maintenance', 'Environmental'], roles: [{ title: 'Processing & Metallurgy', count: 21 }, { title: 'Maintenance', count: 18 }, { title: 'Geology', count: 13 }] },
  { id: 'igo', ticker: 'IGO', name: 'IGO', domain: 'igo.com.au', sector: 'Battery Metals — Nickel & Lithium', headcount: 920, growth: 7.5, openRoles: 81, salary: '$145,000', salaryShort: '$145K', salaryNum: 145000, turnover: 12.8, salaryDelta: '+7%', metroDelta: '+7% vs metro', trend: [84, 87, 90, 92, 94, 96, 98, 100], revPerEmp: 1.61, ebitdaPerEmp: 0.71, timeToFill: '41 days', competition: 'High', skills: ['Battery Metals', 'Lithium Processing', 'Hydromet', 'Data Science', 'Sustainability'], roles: [{ title: 'Processing & Hydromet', count: 26 }, { title: 'Exploration', count: 21 }, { title: 'Corporate & ESG', count: 18 }] },
  { id: 'min', ticker: 'MIN', name: 'Mineral Resources', domain: 'mineralresources.com.au', sector: 'Mining Services & Lithium', headcount: 6400, growth: 8.2, openRoles: 240, salary: '$142,000', salaryShort: '$142K', salaryNum: 142000, turnover: 13.2, salaryDelta: '+8%', metroDelta: '+8% vs metro', trend: [80, 84, 88, 90, 93, 96, 98, 100], revPerEmp: 1.35, ebitdaPerEmp: 0.42, timeToFill: '40 days', competition: 'Very high', skills: ['Crushing & Processing', 'Lithium', 'Heavy Diesel', 'Drilling', 'Automation'], roles: [{ title: 'Maintenance & Trades', count: 88 }, { title: 'Processing', count: 62 }, { title: 'Operations', count: 44 }] },
  { id: 'pls', ticker: 'PLS', name: 'Pilbara Minerals', domain: 'pilbaraminerals.com.au', sector: 'Lithium', headcount: 1350, growth: 9.6, openRoles: 96, salary: '$150,000', salaryShort: '$150K', salaryNum: 150000, turnover: 12.0, salaryDelta: '+12%', metroDelta: '+12% vs metro', trend: [72, 78, 83, 88, 92, 95, 98, 100], revPerEmp: 1.72, ebitdaPerEmp: 0.88, timeToFill: '42 days', competition: 'Very high', skills: ['Lithium Processing', 'Metallurgy', 'Battery Metals', 'Maintenance', 'Sustainability'], roles: [{ title: 'Processing & Metallurgy', count: 34 }, { title: 'Maintenance', count: 28 }, { title: 'Operations', count: 22 }] },
  { id: 'ltr', ticker: 'LTR', name: 'Liontown Resources', domain: 'liontown.com.au', sector: 'Lithium', headcount: 520, growth: 15.4, openRoles: 74, salary: '$147,000', salaryShort: '$147K', salaryNum: 147000, turnover: 13.8, salaryDelta: '+9%', metroDelta: '+9% vs metro', trend: [55, 64, 72, 80, 86, 92, 97, 100], revPerEmp: 1.28, ebitdaPerEmp: 0.55, timeToFill: '44 days', competition: 'Very high', skills: ['Lithium Processing', 'Project Delivery', 'Mine Geology', 'Metallurgy', 'Automation'], roles: [{ title: 'Project Delivery', count: 31 }, { title: 'Processing', count: 24 }, { title: 'Geology', count: 19 }] },
  { id: 'ilu', ticker: 'ILU', name: 'Iluka Resources', domain: 'iluka.com', sector: 'Mineral Sands & Rare Earths', headcount: 1250, growth: 4.4, openRoles: 68, salary: '$138,000', salaryShort: '$138K', salaryNum: 138000, turnover: 10.6, salaryDelta: '+5%', metroDelta: '+5% vs metro', trend: [90, 91, 93, 94, 96, 97, 99, 100], revPerEmp: 1.44, ebitdaPerEmp: 0.61, timeToFill: '46 days', competition: 'Medium', skills: ['Mineral Processing', 'Rare Earths', 'Metallurgy', 'Chemical Engineering', 'Sustainability'], roles: [{ title: 'Processing & Refining', count: 27 }, { title: 'Engineering', count: 22 }, { title: 'Environmental', count: 16 }] },
  { id: 'nst', ticker: 'NST', name: 'Northern Star Resources', domain: 'nsrltd.com', sector: 'Gold', headcount: 8600, growth: 6.0, openRoles: 205, salary: '$140,000', salaryShort: '$140K', salaryNum: 140000, turnover: 12.4, salaryDelta: '+7%', metroDelta: '+7% vs metro', trend: [85, 88, 90, 92, 94, 96, 98, 100], revPerEmp: 0.95, ebitdaPerEmp: 0.44, timeToFill: '43 days', competition: 'High', skills: ['Underground Mining', 'Metallurgy', 'Geology', 'Maintenance', 'HSE'], roles: [{ title: 'Underground Mining', count: 74 }, { title: 'Processing', count: 52 }, { title: 'Geology', count: 38 }] },
  { id: 'chevron', ticker: 'CVX', name: 'Chevron', domain: 'chevron.com', sector: 'Oil, Gas & LNG', headcount: 3400, growth: 2.4, openRoles: 130, salary: '$165,000', salaryShort: '$165K', salaryNum: 165000, turnover: 8.0, salaryDelta: '+22%', metroDelta: '+22% vs metro', trend: [95, 96, 96, 97, 98, 98, 99, 100], revPerEmp: 3.6, ebitdaPerEmp: 1.7, timeToFill: '53 days', competition: 'High', skills: ['LNG Processing', 'Subsea Engineering', 'Reservoir Engineering', 'Carbon Capture', 'Project Controls'], roles: [{ title: 'Operations', count: 56 }, { title: 'Project Delivery', count: 44 }, { title: 'Subsurface', count: 32 }] },
  { id: 'beach', ticker: 'BPT', name: 'Beach Energy', domain: 'beachenergy.com.au', sector: 'Oil & Gas', headcount: 900, growth: 4.0, openRoles: 70, salary: '$152,000', salaryShort: '$152K', salaryNum: 152000, turnover: 9.8, salaryDelta: '+12%', metroDelta: '+12% vs metro', trend: [88, 90, 92, 93, 95, 97, 98, 100], revPerEmp: 2.1, ebitdaPerEmp: 1.05, timeToFill: '48 days', competition: 'High', skills: ['Petroleum Engineering', 'Reservoir Engineering', 'Facilities Engineering', 'HSE', 'Drilling'], roles: [{ title: 'Subsurface', count: 32 }, { title: 'Facilities', count: 26 }, { title: 'Operations', count: 18 }] },
  { id: 'mgt', ticker: 'MGT', name: 'Magnetite Mines', domain: 'magnetitemines.com', sector: 'Iron Ore', headcount: 90, growth: 9.0, openRoles: 22, salary: '$135,000', salaryShort: '$135K', salaryNum: 135000, turnover: 12.0, salaryDelta: '+4%', metroDelta: '+4% vs metro', trend: [70, 76, 82, 86, 90, 94, 97, 100], revPerEmp: 0.9, ebitdaPerEmp: 0.3, timeToFill: '42 days', competition: 'High', skills: ['Magnetite Processing', 'Metallurgy', 'Project Delivery', 'Environmental', 'Studies'], roles: [{ title: 'Project Delivery', count: 10 }, { title: 'Metallurgy', count: 7 }, { title: 'Environmental', count: 5 }] },
  { id: 'hgo', ticker: 'HGO', name: 'Hillgrove Resources', domain: 'hillgroveresources.com.au', sector: 'Copper & Base Metals', headcount: 260, growth: 11.0, openRoles: 34, salary: '$138,000', salaryShort: '$138K', salaryNum: 138000, turnover: 12.6, salaryDelta: '+5%', metroDelta: '+5% vs metro', trend: [64, 72, 80, 86, 91, 95, 98, 100], revPerEmp: 1.1, ebitdaPerEmp: 0.42, timeToFill: '44 days', competition: 'High', skills: ['Underground Mining', 'Copper Processing', 'Geology', 'Maintenance', 'HSE'], roles: [{ title: 'Underground Mining', count: 15 }, { title: 'Processing', count: 11 }, { title: 'Geology', count: 8 }] },
  { id: 'smr', ticker: 'SMR', name: 'Stanmore Resources', domain: 'stanmore.net.au', sector: 'Coal', headcount: 2600, growth: 5.5, openRoles: 120, salary: '$141,000', salaryShort: '$141K', salaryNum: 141000, turnover: 12.2, salaryDelta: '+6%', metroDelta: '+6% vs metro', trend: [86, 88, 90, 92, 94, 96, 98, 100], revPerEmp: 1.5, ebitdaPerEmp: 0.68, timeToFill: '43 days', competition: 'High', skills: ['Coal Mining', 'Maintenance', 'Processing', 'Geology', 'HSE'], roles: [{ title: 'Operations', count: 52 }, { title: 'Maintenance', count: 40 }, { title: 'Geology', count: 24 }] },
  { id: 'nhc', ticker: 'NHC', name: 'New Hope Group', domain: 'newhopegroup.com.au', sector: 'Coal', headcount: 1500, growth: 3.6, openRoles: 82, salary: '$139,000', salaryShort: '$139K', salaryNum: 139000, turnover: 11.4, salaryDelta: '+5%', metroDelta: '+5% vs metro', trend: [92, 93, 94, 95, 96, 97, 99, 100], revPerEmp: 1.6, ebitdaPerEmp: 0.82, timeToFill: '45 days', competition: 'Medium', skills: ['Coal Mining', 'Rehabilitation', 'Maintenance', 'Processing', 'Environmental'], roles: [{ title: 'Operations', count: 34 }, { title: 'Maintenance', count: 28 }, { title: 'Environmental', count: 18 }] },
  { id: 'shell', ticker: 'SHEL', name: 'Shell', domain: 'shell.com', sector: 'Oil, Gas & LNG', headcount: 3200, growth: 3.0, openRoles: 140, salary: '$160,000', salaryShort: '$160K', salaryNum: 160000, turnover: 8.6, salaryDelta: '+19%', metroDelta: '+19% vs metro', trend: [94, 95, 96, 97, 98, 99, 99, 100], revPerEmp: 3.4, ebitdaPerEmp: 1.55, timeToFill: '52 days', competition: 'High', skills: ['LNG Processing', 'Subsurface', 'Project Controls', 'HSE', 'Commercial'], roles: [{ title: 'Operations', count: 58 }, { title: 'Project Delivery', count: 46 }, { title: 'Commercial', count: 30 }] },
  { id: 'aow', ticker: 'ARW', name: 'Arrow Energy', domain: 'arrowenergy.com.au', sector: 'Oil & Gas', headcount: 1100, growth: 6.5, openRoles: 74, salary: '$150,000', salaryShort: '$150K', salaryNum: 150000, turnover: 10.0, salaryDelta: '+12%', metroDelta: '+12% vs metro', trend: [82, 86, 89, 92, 94, 96, 98, 100], revPerEmp: 2.2, ebitdaPerEmp: 1.02, timeToFill: '47 days', competition: 'High', skills: ['Coal Seam Gas', 'Drilling', 'Facilities Engineering', 'Reservoir Engineering', 'HSE'], roles: [{ title: 'Subsurface', count: 30 }, { title: 'Facilities', count: 26 }, { title: 'Operations', count: 20 }] },
  { id: 'mmi', ticker: 'MMI', name: 'Metro Mining', domain: 'metromining.com.au', sector: 'Bauxite', headcount: 420, growth: 10.5, openRoles: 40, salary: '$134,000', salaryShort: '$134K', salaryNum: 134000, turnover: 13.4, salaryDelta: '+3%', metroDelta: '+3% vs metro', trend: [66, 74, 81, 87, 91, 95, 98, 100], revPerEmp: 1.2, ebitdaPerEmp: 0.44, timeToFill: '42 days', competition: 'High', skills: ['Bauxite Mining', 'Barging & Logistics', 'Maintenance', 'Environmental', 'HSE'], roles: [{ title: 'Operations', count: 18 }, { title: 'Logistics', count: 13 }, { title: 'Maintenance', count: 9 }] },
  { id: 'jellinbah', ticker: 'JEL', name: 'Jellinbah Group', domain: 'jellinbah.com.au', sector: 'Coal', headcount: 800, growth: 4.2, openRoles: 48, salary: '$143,000', salaryShort: '$143K', salaryNum: 143000, turnover: 11.8, salaryDelta: '+7%', metroDelta: '+7% vs metro', trend: [90, 91, 93, 94, 96, 97, 99, 100], revPerEmp: 1.7, ebitdaPerEmp: 0.9, timeToFill: '44 days', competition: 'Medium', skills: ['Coal Mining', 'Maintenance', 'Processing', 'Rail & Logistics', 'HSE'], roles: [{ title: 'Operations', count: 20 }, { title: 'Maintenance', count: 16 }, { title: 'Logistics', count: 12 }] },
];

// Resources sit in one combined bucket now — mining, metals, oil, gas and LNG
// all fold into "Energy & Natural Resources". Finance hubs are tagged
// separately (see geo.ts CITY_SECTORS); companies here are all resources.
export const RESOURCES_SECTOR = 'Energy & Natural Resources';
export function categorize(_sector: string): string {
  return RESOURCES_SECTOR;
}

export interface TickerItem {
  name: string;
  tag: string;
  v: number;
}

export const TICKER_BASE: TickerItem[] = [
  { name: 'Fortescue', tag: 'Headcount', v: 12.3 },
  { name: 'Hydrogen', tag: 'Demand', v: 18.4 },
  { name: 'BHP', tag: 'Headcount', v: 6.4 },
  { name: 'Autonomous Haulage', tag: 'Demand', v: 14.1 },
  { name: 'Data Analytics', tag: 'Demand', v: 11.7 },
  { name: 'Woodside', tag: 'Headcount', v: 5.2 },
  { name: 'Subsea Engineering', tag: 'Demand', v: 9.2 },
  { name: 'Rio Tinto', tag: 'Headcount', v: 4.1 },
  { name: 'Decarbonisation', tag: 'Demand', v: 7.8 },
  { name: 'Santos', tag: 'Headcount', v: 3.3 },
  { name: 'Electrical Engineering', tag: 'Demand', v: 6.5 },
  { name: 'South32', tag: 'Headcount', v: 2.0 },
  { name: 'Reservoir Engineering', tag: 'Demand', v: 3.1 },
  { name: 'Process Engineering', tag: 'Demand', v: -2.4 },
  { name: 'Rail Systems', tag: 'Demand', v: -4.6 },
  { name: 'Diesel Mechanics', tag: 'Demand', v: -7.9 },
];
