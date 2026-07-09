export interface CityStat {
  salary: number;
  growth: number;
  turnover: number;
}

export const STATE_STATS: Record<string, CityStat> = {
  WA: { salary: 146, growth: 5.6, turnover: 11.3 },
  NT: { salary: 138, growth: 4.2, turnover: 13.5 },
  QLD: { salary: 122, growth: 6.8, turnover: 12.0 },
  SA: { salary: 118, growth: 3.1, turnover: 10.2 },
  NSW: { salary: 128, growth: 3.5, turnover: 9.5 },
  VIC: { salary: 112, growth: 2.8, turnover: 8.9 },
  TAS: { salary: 98, growth: 2.2, turnover: 9.0 },
};

export const CITY_STATE: Record<string, string> = {
  perth: 'WA', darwin: 'NT', adelaide: 'SA', melbourne: 'VIC', sydney: 'NSW', brisbane: 'QLD', hobart: 'TAS',
};

// Pixel coords in the 250x230 AustraliaMap viewBox, projected from each city's
// real lng/lat with the same Web-Mercator fit used for AU_STATE_PATHS.
export const CITY_XY: Record<string, [number, number]> = {
  perth: [29.4, 140.5], darwin: [111.6, 24.3], adelaide: [154.2, 160], melbourne: [189.1, 179.7], sydney: [223.3, 153], brisbane: [233.3, 112.2], hobart: [202, 216.4],
};

export const CITY_LABEL: Record<string, string> = {
  perth: 'Perth', darwin: 'Darwin', adelaide: 'Adelaide', melbourne: 'Melbourne', sydney: 'Sydney', brisbane: 'Brisbane', hobart: 'Hobart',
};

export const GLOBAL_HUB_XY: Record<string, [number, number]> = {
  perth: [435.1, 223.1],
  santiago: [109, 226.2],
  toronto: [93.7, 79.1],
  johannesburg: [281.6, 211.6],
  london: [232.3, 58.7],
  houston: [65.8, 109.5],
  singapore: [414, 161.7],
};

export const GLOBAL_HUB_LABEL: Record<string, string> = {
  perth: 'Perth', santiago: 'Santiago', toronto: 'Toronto', johannesburg: 'Johannesburg', london: 'London', houston: 'Houston', singapore: 'Singapore',
};

export const GLOBAL_STATS: Record<string, CityStat> = {
  perth: { salary: 146, growth: 5.6, turnover: 11.3 },
  santiago: { salary: 98, growth: 4.2, turnover: 13.0 },
  toronto: { salary: 132, growth: 3.0, turnover: 9.0 },
  johannesburg: { salary: 74, growth: 2.6, turnover: 14.5 },
  london: { salary: 118, growth: 2.2, turnover: 8.5 },
  houston: { salary: 128, growth: 4.8, turnover: 10.2 },
  singapore: { salary: 110, growth: 3.8, turnover: 9.6 },
};

export const SKILL_DEMAND: Record<string, Record<string, number>> = {
  HSE: { perth: 100, darwin: 58, brisbane: 64, adelaide: 46, sydney: 30, melbourne: 26, hobart: 20 },
  Maintenance: { perth: 100, brisbane: 70, darwin: 52, adelaide: 44, sydney: 28, melbourne: 24, hobart: 18 },
  Metallurgy: { perth: 100, adelaide: 74, brisbane: 56, darwin: 22, sydney: 18, melbourne: 16, hobart: 14 },
  Sustainability: { perth: 82, sydney: 78, melbourne: 74, brisbane: 52, adelaide: 40, darwin: 24, hobart: 48 },
  Automation: { perth: 100, brisbane: 44, sydney: 34, adelaide: 30, melbourne: 30, darwin: 26, hobart: 16 },
  'Autonomous Haulage': { perth: 100, brisbane: 38, darwin: 24, adelaide: 20, sydney: 14, melbourne: 12, hobart: 10 },
  'Battery Metals': { perth: 100, adelaide: 58, sydney: 42, melbourne: 38, brisbane: 36, darwin: 34, hobart: 28 },
  'Carbon Capture': { perth: 100, darwin: 64, brisbane: 48, sydney: 44, melbourne: 40, adelaide: 30, hobart: 26 },
};

export const GLOBAL_SKILL_DEMAND: Record<string, Record<string, number>> = {
  HSE: { perth: 100, santiago: 62, toronto: 58, johannesburg: 70, london: 40, houston: 66, singapore: 48 },
  Maintenance: { perth: 100, santiago: 58, toronto: 62, johannesburg: 64, london: 36, houston: 60, singapore: 44 },
  Metallurgy: { perth: 100, santiago: 74, toronto: 56, johannesburg: 68, london: 30, houston: 38, singapore: 34 },
  Sustainability: { perth: 78, santiago: 44, toronto: 56, johannesburg: 40, london: 82, houston: 52, singapore: 64 },
  Automation: { perth: 100, santiago: 42, toronto: 50, johannesburg: 38, london: 46, houston: 62, singapore: 58 },
  'Autonomous Haulage': { perth: 100, santiago: 48, toronto: 30, johannesburg: 44, london: 20, houston: 36, singapore: 26 },
  'Battery Metals': { perth: 100, santiago: 82, toronto: 48, johannesburg: 40, london: 38, houston: 34, singapore: 56 },
  'Carbon Capture': { perth: 100, santiago: 38, toronto: 56, johannesburg: 34, london: 64, houston: 78, singapore: 46 },
};

export function activeSkillKey(query: string | null | undefined): string | null {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  return Object.keys(SKILL_DEMAND).find((k) => k.toLowerCase() === q) || null;
}
