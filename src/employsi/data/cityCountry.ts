/**
 * Hub city → ISO 3166-1 alpha-2 country code.
 *
 * Written for the news pool: an article about a Perth employer is far likelier
 * to appear in the Australian press than in the Indian press, so the shared
 * outlet pool fetches a company's OWN country rather than all of them. Without
 * this map the choice would be "every feed for every company", which is ~94
 * requests per refresh to answer a question about one city.
 *
 * Kept separate from CITY_CONTINENT (data/geo.ts), which groups cities into the
 * map's six domestic REGIONS. Those regions are a camera concept — 'australia'
 * contains Auckland and Wellington — and reusing them here would ask New
 * Zealand companies to be covered by Australian newspapers.
 *
 * Every city in CITY_COMPANIES is listed; scripts/check-city-country.ts fails if
 * one is added without a country, because the silent consequence is a company
 * quietly losing its national press rather than anything visibly breaking.
 */
export const CITY_COUNTRY: Record<string, string> = {
  // Australia
  perth: "au",
  adelaide: "au",
  brisbane: "au",
  melbourne: "au",
  sydney: "au",
  canberra: "au",
  darwin: "au",
  hobart: "au",
  // New Zealand
  auckland: "nz",
  wellington: "nz",
  // Europe
  london: "gb",
  paris: "fr",
  zurich: "ch",
  // Middle East / Africa
  dubai: "ae",
  johannesburg: "za",
  // Asia
  tokyo: "jp",
  seoul: "kr",
  beijing: "cn",
  shanghai: "cn",
  shenzhen: "cn",
  ganzhou: "cn",
  hongkong: "hk",
  singapore: "sg",
  kualalumpur: "my",
  manila: "ph",
  mumbai: "in",
  bengaluru: "in",
  // Canada
  toronto: "ca",
  montreal: "ca",
  vancouver: "ca",
  calgary: "ca",
  ottawa: "ca",
  // United States
  newyork: "us",
  houston: "us",
  sanfrancisco: "us",
  sanjose: "us",
  seattle: "us",
  chicago: "us",
  denver: "us",
  boston: "us",
  dallas: "us",
  atlanta: "us",
  minneapolis: "us",
  washington: "us",
  losangeles: "us",
  charlotte: "us",
  indianapolis: "us",
  sandiego: "us",
  cincinnati: "us",
  philadelphia: "us",
  austin: "us",
  bentonville: "us",
  omaha: "us",
  portland: "us",
};
