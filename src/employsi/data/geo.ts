
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
export const CITY_LABEL: Record<string, string> = {
  perth: 'Perth', darwin: 'Darwin', adelaide: 'Adelaide', melbourne: 'Melbourne', sydney: 'Sydney', brisbane: 'Brisbane', hobart: 'Hobart',
};

export const GLOBAL_HUB_LABEL: Record<string, string> = {
  perth: 'Perth', santiago: 'Santiago', toronto: 'Toronto', johannesburg: 'Johannesburg', london: 'London', houston: 'Houston', singapore: 'Singapore',
  denver: 'Denver', ganzhou: 'Ganzhou', brisbane: 'Brisbane', adelaide: 'Adelaide', melbourne: 'Melbourne', sydney: 'Sydney',
  newyork: 'New York', sanfrancisco: 'San Francisco', chicago: 'Chicago', tokyo: 'Tokyo', zurich: 'Zurich', dubai: 'Dubai', hongkong: 'Hong Kong',
  seattle: 'Seattle', paris: 'Paris', seoul: 'Seoul', beijing: 'Beijing',
};

// Which domestic/regional view each local city belongs to, so scrolling out of
// a city's local layer drops back into its own continent rather than always
// defaulting to Australia.
export const CITY_CONTINENT: Record<string, string> = {
  perth: 'australia',
  adelaide: 'australia',
  brisbane: 'australia',
  melbourne: 'australia',
  sydney: 'australia',
  singapore: 'asia',
  ganzhou: 'asia',
  tokyo: 'asia',
  hongkong: 'asia',
  dubai: 'asia',
  toronto: 'northamerica',
  houston: 'northamerica',
  denver: 'northamerica',
  newyork: 'northamerica',
  sanfrancisco: 'northamerica',
  chicago: 'northamerica',
  seattle: 'northamerica',
  johannesburg: 'africa',
  london: 'europe',
  zurich: 'europe',
  paris: 'europe',
  seoul: 'asia',
  beijing: 'asia',
  santiago: 'southamerica',
};

export const GLOBAL_STATS: Record<string, CityStat> = {
  perth: { salary: 146, growth: 5.6, turnover: 11.3 },
  santiago: { salary: 98, growth: 4.2, turnover: 13.0 },
  toronto: { salary: 132, growth: 3.0, turnover: 9.0 },
  johannesburg: { salary: 74, growth: 2.6, turnover: 14.5 },
  london: { salary: 118, growth: 2.2, turnover: 8.5 },
  houston: { salary: 128, growth: 4.8, turnover: 10.2 },
  singapore: { salary: 110, growth: 3.8, turnover: 9.6 },
  denver: { salary: 120, growth: 3.4, turnover: 9.8 },
  ganzhou: { salary: 68, growth: 5.0, turnover: 13.8 },
  seattle: { salary: 168, growth: 4.4, turnover: 11.5 },
  paris: { salary: 122, growth: 2.4, turnover: 8.6 },
  seoul: { salary: 118, growth: 3.0, turnover: 9.2 },
  beijing: { salary: 92, growth: 5.2, turnover: 12.5 },
  brisbane: { salary: 124, growth: 4.5, turnover: 10.8 },
  adelaide: { salary: 118, growth: 3.1, turnover: 10.2 },
  melbourne: { salary: 132, growth: 3.0, turnover: 8.9 },
  sydney: { salary: 128, growth: 3.5, turnover: 9.5 },
  newyork: { salary: 165, growth: 3.2, turnover: 11.0 },
  sanfrancisco: { salary: 185, growth: 4.0, turnover: 12.5 },
  chicago: { salary: 140, growth: 2.6, turnover: 10.0 },
  tokyo: { salary: 120, growth: 2.0, turnover: 7.5 },
  zurich: { salary: 175, growth: 2.2, turnover: 8.0 },
  dubai: { salary: 145, growth: 5.5, turnover: 13.0 },
  hongkong: { salary: 150, growth: 2.8, turnover: 10.5 },
};
