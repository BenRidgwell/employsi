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
  /** Top-level sector group used by the sector filter. Defaults to Energy &
   *  Natural Resources when omitted (every current company is a resources name). */
  group?: string;
  /** Stock exchange the company lists on (ASX, NYSE, NASDAQ, LSE, JPX, SSE,
   *  HKEX, …). Used by the exchange filter. Defaults to ASX. */
  exchange?: string;
  /** Privately-held (not listed on any exchange). Defaults to false — every
   *  current company is publicly listed. Drives the Public/Private master
   *  filter; the exchange filter only applies to public companies. */
  private?: boolean;
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
  /** Optional short label shown on the map pill instead of the ticker (e.g. a
   *  name acronym for markets whose tickers are numeric). The ticker is still
   *  used for search, so a user can find the company either way. */
  pill?: string;
}

export const COMPANIES: Company[] = [
  { id: 'rio', ticker: 'RIO', name: 'Rio Tinto', domain: 'riotinto.com', sector: 'Iron Ore & Metals', headcount: 11500, growth: 4.1, openRoles: 268, salary: '$152,000', salaryShort: '$152K', salaryNum: 152000, turnover: 9.8, salaryDelta: '+13%', metroDelta: '+13% vs metro', trend: [92, 93, 94, 95, 96, 97, 99, 100], revPerEmp: 1.01, ebitdaPerEmp: 0.44, timeToFill: '52 days', competition: 'High', skills: ['Geoscience', 'Process Engineering', 'Remote Operations', 'Rail Systems', 'Decarbonisation'], roles: [{ title: 'Engineering', count: 57 }, { title: 'Geoscience', count: 39 }, { title: 'Rail & Logistics', count: 33 }] },
  // BHP is the real-data pilot: revPerEmp/ebitdaPerEmp are the real FY2024
  // group ratios (US$55.7B revenue, US$29.0B underlying EBITDA, >90,000
  // employees+contractors — bhp.com FY2024 results). headcount stays the
  // illustrative Perth-office figure (it also drives the local workforce
  // summary bar, which is scoped per-city, not group-wide).
  { id: 'bhp', ticker: 'BHP', name: 'BHP', domain: 'bhp.com', sector: 'Diversified Mining', headcount: 9200, growth: 6.4, openRoles: 312, salary: '$148,000', salaryShort: '$148K', salaryNum: 148000, turnover: 11.2, salaryDelta: '+10%', metroDelta: '+10% vs metro', trend: [86, 88, 89, 91, 93, 95, 98, 100], revPerEmp: 0.62, ebitdaPerEmp: 0.32, timeToFill: '47 days', competition: 'High', skills: ['Mining Engineering', 'Autonomous Haulage', 'Data Analytics', 'HSE', 'Maintenance Planning'], roles: [{ title: 'Maintenance & Trades', count: 84 }, { title: 'Engineering', count: 61 }, { title: 'Operations', count: 48 }] },
  { id: 's32', ticker: 'S32', name: 'South32', domain: 'south32.net', sector: 'Metals & Mining', headcount: 3400, growth: 2.0, openRoles: 124, salary: '$141,000', salaryShort: '$141K', salaryNum: 141000, turnover: 12.5, salaryDelta: '+4%', metroDelta: '+4% vs metro', trend: [95, 96, 96, 97, 98, 98, 99, 100], revPerEmp: 0.43, ebitdaPerEmp: 0.14, timeToFill: '44 days', competition: 'Medium', skills: ['Metallurgy', 'Supply Chain', 'Sustainability', 'Finance', 'Maintenance'], roles: [{ title: 'Metallurgy & Processing', count: 31 }, { title: 'Maintenance', count: 27 }, { title: 'Corporate', count: 22 }] },
  { id: 'fmg', ticker: 'FMG', name: 'Fortescue', domain: 'fortescue.com', sector: 'Iron Ore & Green Energy', headcount: 7800, growth: 12.3, openRoles: 415, salary: '$139,000', salaryShort: '$139K', salaryNum: 139000, turnover: 14.6, salaryDelta: '+3%', metroDelta: '+3% vs metro', trend: [70, 74, 79, 83, 87, 92, 96, 100], revPerEmp: 1.33, ebitdaPerEmp: 0.78, timeToFill: '39 days', competition: 'Very high', skills: ['Renewable Energy', 'Hydrogen', 'Electrical Engineering', 'Project Delivery', 'Automation'], roles: [{ title: 'Renewables & Electrical', count: 96 }, { title: 'Project Delivery', count: 71 }, { title: 'Operations', count: 58 }] },
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

  // ── Additional Perth-listed companies. Records/coords/sector groups are wired;
  // financial figures are illustrative estimates pending the same real-data pass
  // applied to BHP/Rio (share ranges + live news). ──
  { id: 'pdn', ticker: 'PDN', name: 'Paladin Energy', domain: 'paladinenergy.com.au', sector: 'Uranium', headcount: 640, growth: 11.5, openRoles: 58, salary: '$146,000', salaryShort: '$146K', salaryNum: 146000, turnover: 12.5, salaryDelta: '+8%', metroDelta: '+8% vs metro', trend: [70, 76, 82, 87, 91, 95, 98, 100], revPerEmp: 0.9, ebitdaPerEmp: 0.36, timeToFill: '44 days', competition: 'High', skills: ['Uranium Processing', 'Metallurgy', 'Radiation Safety', 'Maintenance', 'HSE'], roles: [{ title: 'Processing', count: 16 }, { title: 'Maintenance', count: 12 }, { title: 'HSE', count: 8 }] },
  { id: 'wgx', ticker: 'WGX', name: 'Westgold Resources', domain: 'westgold.com.au', sector: 'Gold', headcount: 1900, growth: 8.4, openRoles: 132, salary: '$141,000', salaryShort: '$141K', salaryNum: 141000, turnover: 13.0, salaryDelta: '+6%', metroDelta: '+6% vs metro', trend: [80, 84, 88, 91, 94, 96, 98, 100], revPerEmp: 0.62, ebitdaPerEmp: 0.22, timeToFill: '41 days', competition: 'High', skills: ['Underground Mining', 'Gold Processing', 'Geology', 'Maintenance', 'HSE'], roles: [{ title: 'Underground Mining', count: 40 }, { title: 'Processing', count: 28 }, { title: 'Geology', count: 18 }] },
  { id: 'stx', ticker: 'STX', name: 'Strike Energy', domain: 'strikeenergy.com.au', sector: 'Gas', headcount: 210, growth: 9.0, openRoles: 34, salary: '$152,000', salaryShort: '$152K', salaryNum: 152000, turnover: 10.5, salaryDelta: '+11%', metroDelta: '+11% vs metro', trend: [72, 78, 83, 88, 92, 95, 98, 100], revPerEmp: 1.1, ebitdaPerEmp: 0.5, timeToFill: '46 days', competition: 'High', skills: ['Reservoir Engineering', 'Drilling', 'Gas Processing', 'Commercial', 'HSE'], roles: [{ title: 'Subsurface', count: 12 }, { title: 'Commercial', count: 8 }, { title: 'Operations', count: 6 }] },
  { id: 'alk', ticker: 'ALK', name: 'Alkane Resources', domain: 'alkane.com.au', sector: 'Gold', headcount: 320, growth: 7.2, openRoles: 36, salary: '$139,000', salaryShort: '$139K', salaryNum: 139000, turnover: 12.2, salaryDelta: '+5%', metroDelta: '+5% vs metro', trend: [78, 82, 86, 90, 93, 96, 98, 100], revPerEmp: 0.8, ebitdaPerEmp: 0.3, timeToFill: '43 days', competition: 'Medium', skills: ['Gold Processing', 'Geology', 'Metallurgy', 'Maintenance', 'Environmental'], roles: [{ title: 'Processing', count: 12 }, { title: 'Geology', count: 10 }, { title: 'Maintenance', count: 7 }] },
  { id: 'rrl', ticker: 'RRL', name: 'Regis Resources', domain: 'regisresources.com.au', sector: 'Gold', headcount: 1400, growth: 6.0, openRoles: 96, salary: '$140,000', salaryShort: '$140K', salaryNum: 140000, turnover: 12.6, salaryDelta: '+6%', metroDelta: '+6% vs metro', trend: [84, 87, 90, 92, 94, 96, 98, 100], revPerEmp: 0.7, ebitdaPerEmp: 0.28, timeToFill: '42 days', competition: 'High', skills: ['Open Pit Mining', 'Gold Processing', 'Geology', 'Maintenance', 'HSE'], roles: [{ title: 'Mining', count: 34 }, { title: 'Processing', count: 24 }, { title: 'Geology', count: 16 }] },
  { id: 'pru', ticker: 'PRU', name: 'Perseus Mining', domain: 'perseusmining.com', sector: 'Gold', headcount: 2600, growth: 7.8, openRoles: 120, salary: '$142,000', salaryShort: '$142K', salaryNum: 142000, turnover: 12.0, salaryDelta: '+7%', metroDelta: '+7% vs metro', trend: [82, 86, 89, 92, 95, 97, 99, 100], revPerEmp: 0.68, ebitdaPerEmp: 0.3, timeToFill: '45 days', competition: 'High', skills: ['Gold Processing', 'West Africa Operations', 'Geology', 'Metallurgy', 'HSE'], roles: [{ title: 'Operations', count: 44 }, { title: 'Processing', count: 32 }, { title: 'Geology', count: 22 }] },
  { id: 'rms', ticker: 'RMS', name: 'Ramelius Resources', domain: 'rameliusresources.com.au', sector: 'Gold', headcount: 1050, growth: 6.8, openRoles: 82, salary: '$140,000', salaryShort: '$140K', salaryNum: 140000, turnover: 12.4, salaryDelta: '+6%', metroDelta: '+6% vs metro', trend: [83, 86, 89, 92, 94, 97, 99, 100], revPerEmp: 0.72, ebitdaPerEmp: 0.31, timeToFill: '42 days', competition: 'High', skills: ['Underground Mining', 'Gold Processing', 'Geology', 'Maintenance', 'HSE'], roles: [{ title: 'Mining', count: 28 }, { title: 'Processing', count: 20 }, { title: 'Geology', count: 14 }] },
  { id: 'deg', ticker: 'DEG', name: 'De Grey Mining', domain: 'degreymining.com.au', sector: 'Gold', headcount: 280, growth: 14.0, openRoles: 52, salary: '$144,000', salaryShort: '$144K', salaryNum: 144000, turnover: 13.2, salaryDelta: '+8%', metroDelta: '+8% vs metro', trend: [58, 67, 75, 82, 88, 93, 97, 100], revPerEmp: 0.5, ebitdaPerEmp: 0.2, timeToFill: '44 days', competition: 'Very high', skills: ['Project Delivery', 'Gold Processing', 'Geology', 'Metallurgy', 'Studies'], roles: [{ title: 'Project Delivery', count: 18 }, { title: 'Geology', count: 14 }, { title: 'Metallurgy', count: 9 }] },
  { id: 'gmd', ticker: 'GMD', name: 'Genesis Minerals', domain: 'genesisminerals.com.au', sector: 'Gold', headcount: 900, growth: 10.2, openRoles: 74, salary: '$141,000', salaryShort: '$141K', salaryNum: 141000, turnover: 12.8, salaryDelta: '+7%', metroDelta: '+7% vs metro', trend: [72, 78, 84, 89, 92, 96, 98, 100], revPerEmp: 0.66, ebitdaPerEmp: 0.27, timeToFill: '43 days', competition: 'High', skills: ['Underground Mining', 'Gold Processing', 'Geology', 'Maintenance', 'HSE'], roles: [{ title: 'Mining', count: 24 }, { title: 'Processing', count: 18 }, { title: 'Geology', count: 12 }] },
  { id: 'gor', ticker: 'GOR', name: 'Gold Road Resources', domain: 'goldroad.com.au', sector: 'Gold', headcount: 480, growth: 6.4, openRoles: 44, salary: '$142,000', salaryShort: '$142K', salaryNum: 142000, turnover: 11.6, salaryDelta: '+6%', metroDelta: '+6% vs metro', trend: [84, 87, 90, 92, 94, 96, 98, 100], revPerEmp: 0.9, ebitdaPerEmp: 0.42, timeToFill: '43 days', competition: 'Medium', skills: ['Open Pit Mining', 'Gold Processing', 'Geology', 'Exploration', 'HSE'], roles: [{ title: 'Operations', count: 16 }, { title: 'Exploration', count: 12 }, { title: 'Processing', count: 9 }] },
  { id: 'cmm', ticker: 'CMM', name: 'Capricorn Metals', domain: 'capricornmetals.com.au', sector: 'Gold', headcount: 420, growth: 9.6, openRoles: 46, salary: '$141,000', salaryShort: '$141K', salaryNum: 141000, turnover: 12.0, salaryDelta: '+6%', metroDelta: '+6% vs metro', trend: [74, 80, 85, 89, 93, 96, 98, 100], revPerEmp: 0.86, ebitdaPerEmp: 0.4, timeToFill: '42 days', competition: 'High', skills: ['Open Pit Mining', 'Gold Processing', 'Geology', 'Project Delivery', 'HSE'], roles: [{ title: 'Mining', count: 16 }, { title: 'Processing', count: 12 }, { title: 'Project Delivery', count: 9 }] },
  { id: 'dyl', ticker: 'DYL', name: 'Deep Yellow', domain: 'deepyellow.com.au', sector: 'Uranium', headcount: 180, growth: 12.5, openRoles: 30, salary: '$145,000', salaryShort: '$145K', salaryNum: 145000, turnover: 12.8, salaryDelta: '+7%', metroDelta: '+7% vs metro', trend: [64, 72, 80, 86, 91, 95, 98, 100], revPerEmp: 0.4, ebitdaPerEmp: 0.15, timeToFill: '45 days', competition: 'High', skills: ['Uranium Processing', 'Project Delivery', 'Geology', 'Metallurgy', 'Studies'], roles: [{ title: 'Project Delivery', count: 12 }, { title: 'Geology', count: 8 }, { title: 'Studies', count: 6 }] },
  { id: 'bmn', ticker: 'BMN', name: 'Bannerman Energy', domain: 'bannermanenergy.com', sector: 'Uranium', headcount: 120, growth: 13.0, openRoles: 26, salary: '$144,000', salaryShort: '$144K', salaryNum: 144000, turnover: 12.6, salaryDelta: '+7%', metroDelta: '+7% vs metro', trend: [60, 69, 77, 84, 90, 94, 98, 100], revPerEmp: 0.35, ebitdaPerEmp: 0.12, timeToFill: '46 days', competition: 'High', skills: ['Uranium Processing', 'Project Delivery', 'Metallurgy', 'Studies', 'HSE'], roles: [{ title: 'Project Delivery', count: 10 }, { title: 'Metallurgy', count: 7 }, { title: 'Studies', count: 5 }] },
  { id: 'boe', ticker: 'BOE', name: 'Boss Energy', domain: 'bossenergy.com', sector: 'Uranium', headcount: 260, growth: 11.8, openRoles: 38, salary: '$146,000', salaryShort: '$146K', salaryNum: 146000, turnover: 12.4, salaryDelta: '+8%', metroDelta: '+8% vs metro', trend: [66, 74, 82, 88, 92, 96, 98, 100], revPerEmp: 0.7, ebitdaPerEmp: 0.28, timeToFill: '44 days', competition: 'High', skills: ['Uranium Processing', 'Hydromet', 'Metallurgy', 'Maintenance', 'HSE'], roles: [{ title: 'Processing', count: 14 }, { title: 'Maintenance', count: 10 }, { title: 'HSE', count: 7 }] },
  { id: 'cvn', ticker: 'CVN', name: 'Carnarvon Energy', domain: 'carnarvon.com.au', sector: 'Oil & Gas', headcount: 90, growth: 5.5, openRoles: 18, salary: '$151,000', salaryShort: '$151K', salaryNum: 151000, turnover: 10.2, salaryDelta: '+10%', metroDelta: '+10% vs metro', trend: [82, 85, 88, 91, 94, 96, 98, 100], revPerEmp: 0.6, ebitdaPerEmp: 0.22, timeToFill: '47 days', competition: 'Medium', skills: ['Reservoir Engineering', 'Subsurface', 'Commercial', 'Drilling', 'HSE'], roles: [{ title: 'Subsurface', count: 8 }, { title: 'Commercial', count: 5 }, { title: 'Operations', count: 4 }] },
  { id: 'cxo', ticker: 'CXO', name: 'Core Lithium', domain: 'corelithium.com.au', sector: 'Lithium', headcount: 240, growth: 8.5, openRoles: 34, salary: '$146,000', salaryShort: '$146K', salaryNum: 146000, turnover: 13.0, salaryDelta: '+8%', metroDelta: '+8% vs metro', trend: [70, 76, 82, 87, 92, 95, 98, 100], revPerEmp: 0.9, ebitdaPerEmp: 0.3, timeToFill: '43 days', competition: 'High', skills: ['Lithium Processing', 'Metallurgy', 'Open Pit Mining', 'Maintenance', 'HSE'], roles: [{ title: 'Processing', count: 12 }, { title: 'Mining', count: 9 }, { title: 'Maintenance', count: 6 }] },
  { id: 'jms', ticker: 'JMS', name: 'Jupiter Mines', domain: 'jupitermines.com', sector: 'Manganese', headcount: 150, growth: 4.5, openRoles: 20, salary: '$138,000', salaryShort: '$138K', salaryNum: 138000, turnover: 11.2, salaryDelta: '+4%', metroDelta: '+4% vs metro', trend: [86, 88, 90, 92, 94, 96, 98, 100], revPerEmp: 1.0, ebitdaPerEmp: 0.4, timeToFill: '43 days', competition: 'Medium', skills: ['Manganese Processing', 'Metallurgy', 'Commercial', 'Logistics', 'HSE'], roles: [{ title: 'Commercial', count: 7 }, { title: 'Operations', count: 6 }, { title: 'Logistics', count: 4 }] },
  { id: 'sgq', ticker: 'SGQ', name: 'St George Mining', domain: 'stgeorgemining.com.au', sector: 'Battery Metals', headcount: 60, growth: 10.0, openRoles: 14, salary: '$137,000', salaryShort: '$137K', salaryNum: 137000, turnover: 12.5, salaryDelta: '+4%', metroDelta: '+4% vs metro', trend: [62, 70, 78, 85, 90, 95, 98, 100], revPerEmp: 0.3, ebitdaPerEmp: 0.1, timeToFill: '45 days', competition: 'Medium', skills: ['Exploration', 'Geology', 'Project Delivery', 'Studies', 'Environmental'], roles: [{ title: 'Exploration', count: 6 }, { title: 'Geology', count: 4 }, { title: 'Studies', count: 3 }] },
  { id: 'del', ticker: 'DEL', name: 'Delorean Corporation', domain: 'delorean.net.au', sector: 'Bioenergy & Gas', headcount: 110, growth: 9.5, openRoles: 22, salary: '$140,000', salaryShort: '$140K', salaryNum: 140000, turnover: 11.5, salaryDelta: '+6%', metroDelta: '+6% vs metro', trend: [70, 76, 82, 87, 92, 95, 98, 100], revPerEmp: 0.7, ebitdaPerEmp: 0.2, timeToFill: '44 days', competition: 'Medium', skills: ['Renewable Gas', 'Project Delivery', 'Electrical Engineering', 'Commercial', 'HSE'], roles: [{ title: 'Project Delivery', count: 9 }, { title: 'Engineering', count: 7 }, { title: 'Commercial', count: 4 }] },
  { id: 'asb', ticker: 'ASB', name: 'Austal', domain: 'austal.com', sector: 'Shipbuilding', group: 'Industrial Manufacturing', headcount: 4200, growth: 7.0, openRoles: 210, salary: '$132,000', salaryShort: '$132K', salaryNum: 132000, turnover: 10.0, salaryDelta: '+2%', metroDelta: '+2% vs metro', trend: [84, 87, 90, 92, 94, 96, 98, 100], revPerEmp: 0.42, ebitdaPerEmp: 0.05, timeToFill: '46 days', competition: 'High', skills: ['Shipbuilding', 'Naval Architecture', 'Welding & Fabrication', 'Project Delivery', 'Defence'], roles: [{ title: 'Fabrication & Trades', count: 88 }, { title: 'Engineering', count: 52 }, { title: 'Project Delivery', count: 34 }] },
  { id: 'mnd', ticker: 'MND', name: 'Monadelphous Group', domain: 'monadelphous.com.au', sector: 'Engineering Services', group: 'Industrial Manufacturing', headcount: 6800, growth: 5.5, openRoles: 260, salary: '$138,000', salaryShort: '$138K', salaryNum: 138000, turnover: 12.0, salaryDelta: '+5%', metroDelta: '+5% vs metro', trend: [86, 88, 90, 92, 94, 96, 98, 100], revPerEmp: 0.34, ebitdaPerEmp: 0.03, timeToFill: '40 days', competition: 'Very high', skills: ['Mechanical Engineering', 'Construction', 'Maintenance', 'Welding & Fabrication', 'HSE'], roles: [{ title: 'Trades & Construction', count: 96 }, { title: 'Engineering', count: 58 }, { title: 'Maintenance', count: 44 }] },
  { id: 'nwh', ticker: 'NWH', name: 'NRW Holdings', domain: 'nrw.com.au', sector: 'Mining & Civil Services', group: 'Infrastructure and Government', headcount: 8500, growth: 6.2, openRoles: 300, salary: '$134,000', salaryShort: '$134K', salaryNum: 134000, turnover: 12.5, salaryDelta: '+4%', metroDelta: '+4% vs metro', trend: [85, 88, 90, 92, 94, 96, 98, 100], revPerEmp: 0.32, ebitdaPerEmp: 0.04, timeToFill: '39 days', competition: 'Very high', skills: ['Civil Construction', 'Heavy Diesel', 'Earthworks', 'Project Delivery', 'HSE'], roles: [{ title: 'Operators & Trades', count: 120 }, { title: 'Civil & Earthworks', count: 74 }, { title: 'Project Delivery', count: 48 }] },
  { id: 'mah', ticker: 'MAH', name: 'Macmahon Holdings', domain: 'macmahon.com.au', sector: 'Mining Services', group: 'Infrastructure and Government', headcount: 9200, growth: 5.8, openRoles: 280, salary: '$133,000', salaryShort: '$133K', salaryNum: 133000, turnover: 12.8, salaryDelta: '+4%', metroDelta: '+4% vs metro', trend: [86, 88, 90, 92, 94, 96, 98, 100], revPerEmp: 0.24, ebitdaPerEmp: 0.04, timeToFill: '39 days', competition: 'Very high', skills: ['Mining Services', 'Heavy Diesel', 'Drill & Blast', 'Maintenance', 'HSE'], roles: [{ title: 'Operators & Trades', count: 128 }, { title: 'Maintenance', count: 66 }, { title: 'Mine Planning', count: 40 }] },
  { id: 'wes', ticker: 'WES', name: 'Wesfarmers', domain: 'wesfarmers.com.au', sector: 'Diversified Retail', group: 'Consumer and Retail', headcount: 12000, growth: 4.0, openRoles: 420, salary: '$128,000', salaryShort: '$128K', salaryNum: 128000, turnover: 14.0, salaryDelta: '−2%', metroDelta: '−2% vs metro', trend: [90, 92, 94, 95, 97, 98, 99, 100], revPerEmp: 0.4, ebitdaPerEmp: 0.05, timeToFill: '35 days', competition: 'High', skills: ['Retail Operations', 'Supply Chain', 'Data Analytics', 'Merchandising', 'Finance'], roles: [{ title: 'Retail & Store Ops', count: 160 }, { title: 'Supply Chain', count: 96 }, { title: 'Corporate & Finance', count: 72 }] },
  { id: 'ccv', ticker: 'CCV', name: 'Cash Converters', domain: 'cashconverters.com', sector: 'Consumer Finance & Retail', group: 'Consumer and Retail', headcount: 1300, growth: 3.5, openRoles: 70, salary: '$110,000', salaryShort: '$110K', salaryNum: 110000, turnover: 15.5, salaryDelta: '−12%', metroDelta: '−12% vs metro', trend: [91, 93, 94, 96, 97, 98, 99, 100], revPerEmp: 0.24, ebitdaPerEmp: 0.06, timeToFill: '33 days', competition: 'Medium', skills: ['Retail Operations', 'Consumer Lending', 'Risk & Compliance', 'Customer Service', 'Data Analytics'], roles: [{ title: 'Store & Customer Ops', count: 40 }, { title: 'Lending & Risk', count: 20 }, { title: 'Corporate', count: 12 }] },
  { id: 'swm', ticker: 'SWM', name: 'Seven West Media', domain: 'sevenwestmedia.com.au', sector: 'Media', group: 'Technology, Media and Telecommunications', headcount: 2900, growth: 2.0, openRoles: 110, salary: '$118,000', salaryShort: '$118K', salaryNum: 118000, turnover: 14.5, salaryDelta: '−8%', metroDelta: '−8% vs metro', trend: [96, 96, 97, 98, 98, 99, 99, 100], revPerEmp: 0.5, ebitdaPerEmp: 0.08, timeToFill: '38 days', competition: 'Medium', skills: ['Broadcast Production', 'Digital Media', 'Journalism', 'Advertising Sales', 'Data Analytics'], roles: [{ title: 'Production & Editorial', count: 52 }, { title: 'Digital & Product', count: 30 }, { title: 'Sales & Commercial', count: 24 }] },
  { id: 'sw1', ticker: 'SW1', name: 'Swift Networks Group', domain: 'swiftnetworks.com.au', sector: 'Telecommunications', group: 'Technology, Media and Telecommunications', headcount: 220, growth: 6.5, openRoles: 30, salary: '$122,000', salaryShort: '$122K', salaryNum: 122000, turnover: 13.5, salaryDelta: '−4%', metroDelta: '−4% vs metro', trend: [80, 84, 88, 91, 94, 96, 98, 100], revPerEmp: 0.3, ebitdaPerEmp: 0.05, timeToFill: '40 days', competition: 'Medium', skills: ['Network Engineering', 'Telecommunications', 'Software', 'Field Services', 'Customer Support'], roles: [{ title: 'Network & Field', count: 14 }, { title: 'Software', count: 9 }, { title: 'Support', count: 6 }] },
];

// Resources sit in one combined bucket — mining, metals, oil, gas and LNG all
// fold into "Energy & Natural Resources". Companies in other industries carry
// an explicit `group`; everything else defaults to resources.
export const RESOURCES_SECTOR = 'Energy & Natural Resources';

// The full sector taxonomy offered by the filter, in display order.
export const SECTOR_GROUPS: string[] = [
  'Energy & Natural Resources',
  'Financial Services',
  'Technology, Media and Telecommunications',
  'Consumer and Retail',
  'Industrial Manufacturing',
  'Healthcare and Life Sciences',
  'Infrastructure and Government',
];

// A company's filter group (its own `group`, or resources by default).
export function companyGroup(c: Company): string {
  return c.group ?? RESOURCES_SECTOR;
}

// Stock exchanges offered by the exchange filter, in display order.
export const EXCHANGES: string[] = [
  'ASX', 'NYSE', 'NASDAQ', 'TSX', 'LSE', 'EPA', 'SIX',
  'JPX', 'HKEX', 'SSE', 'SZSE', 'SGX', 'KRX', 'DFM', 'ADX', 'JSE',
];

// A company's listing exchange (its own `exchange`, or ASX by default).
export function companyExchange(c: Company): string {
  return c.exchange ?? 'ASX';
}

export type ListingType = 'public' | 'private';

// Public (exchange-listed) vs private. Every current company is public unless
// explicitly flagged `private`.
export function companyListing(c: Company): ListingType {
  return c.private ? 'private' : 'public';
}
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

// Global company rosters: compact per-city listings expanded into full records
// (see rosters.ts / cityRosters.ts). Appended to COMPANIES so every downstream
// consumer (search, filters, cards, live data) treats them like any other
// company. Their coordinates are added in mapboxGeo.ts.
import { CITY_ROSTERS } from './cityRosters';
import { buildRosterCompany } from './rosters';

export const ROSTER_COMPANIES: Company[] = Object.entries(CITY_ROSTERS).flatMap(([city, r]) =>
  r.companies.map((e) => buildRosterCompany(city, r.exchange, e)),
);
COMPANIES.push(...ROSTER_COMPANIES);

// Perth WA government agencies (private / public-sector).
import { PERTH_GOV_COMPANIES } from './perthGov';
COMPANIES.push(...PERTH_GOV_COMPANIES);
