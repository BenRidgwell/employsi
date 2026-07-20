// Maps each map city to the job-market it should be queried in, so live
// vacancy data (Adzuna + The Muse) works for every company in the app, not just
// the Australian ones.
//
//  • country — the Adzuna country API code that covers the city, or null where
//    Adzuna doesn't operate (Japan, Korea, China, Switzerland, the UAE, Hong
//    Kong). For those, only The Muse is queried.
//  • where   — the Adzuna `where` location filter (a city/country string).
//  • region  — matches a job's location text so The Muse's global results are
//    narrowed to roles actually in this city's country.

export interface CityMarket {
  country: string | null;
  where: string;
  region: RegExp;
}

// Australian cities all resolve to the national Adzuna market.
const AU: CityMarket = {
  country: 'au',
  where: 'Australia',
  region: /australia|sydney|melbourne|perth|brisbane|adelaide|canberra|hobart|darwin/i,
};

export const CITY_MARKET: Record<string, CityMarket> = {
  // Australia
  perth: AU,
  sydney: AU,
  melbourne: AU,
  brisbane: AU,
  adelaide: AU,
  // Adzuna-covered global hubs
  london: { country: 'gb', where: 'London', region: /united kingdom|england|london|\buk\b/i },
  toronto: { country: 'ca', where: 'Toronto', region: /canada|toronto|ontario/i },
  houston: { country: 'us', where: 'Houston', region: /united states|\busa?\b|houston|texas/i },
  denver: { country: 'us', where: 'Denver', region: /united states|\busa?\b|denver|colorado/i },
  seattle: { country: 'us', where: 'Seattle', region: /united states|\busa?\b|seattle|washington/i },
  newyork: { country: 'us', where: 'New York', region: /united states|\busa?\b|new york|\bny\b/i },
  sanfrancisco: { country: 'us', where: 'San Francisco', region: /united states|\busa?\b|san francisco|california|bay area/i },
  chicago: { country: 'us', where: 'Chicago', region: /united states|\busa?\b|chicago|illinois/i },
  austin: { country: 'us', where: 'Austin', region: /united states|\busa?\b|austin|texas/i },
  atlanta: { country: 'us', where: 'Atlanta', region: /united states|\busa?\b|atlanta|georgia/i },
  singapore: { country: 'sg', where: 'Singapore', region: /singapore/i },
  paris: { country: 'fr', where: 'Paris', region: /france|paris/i },
  johannesburg: { country: 'za', where: 'Johannesburg', region: /south africa|johannesburg|gauteng/i },
  // Hubs Adzuna doesn't cover → The Muse only, narrowed to the country.
  tokyo: { country: null, where: 'Tokyo', region: /japan|tokyo/i },
  seoul: { country: null, where: 'Seoul', region: /korea|seoul/i },
  beijing: { country: null, where: 'Beijing', region: /china|beijing/i },
  ganzhou: { country: null, where: 'Ganzhou', region: /china|ganzhou|jiangxi/i },
  zurich: { country: null, where: 'Zurich', region: /switzerland|zurich|zürich/i },
  dubai: { country: null, where: 'Dubai', region: /united arab emirates|\buae\b|dubai/i },
  hongkong: { country: null, where: 'Hong Kong', region: /hong kong/i },
};

// The market for a company, resolved from the city it's currently plotted in.
// Defaults to the Australian market when the city is unknown (all hand-placed
// companies live in a mapped city).
export function marketForCity(city: string | null | undefined): CityMarket {
  return (city && CITY_MARKET[city]) || AU;
}
