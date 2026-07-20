// Global hubs the jobs pipeline samples for skill demand, mapped to the Adzuna
// country API that covers them. Adzuna only operates in these countries, so the
// hubs it can't reach (Ganzhou, Tokyo, Zurich, Dubai, Hong Kong, Seoul,
// Beijing) are intentionally omitted — they stay dark on the skill heatmap
// rather than showing invented numbers.
//
// Unlike the AU companies (queried by company name), each hub is a whole-market
// city sample: the current advertised roles in that city, mapped to skills, so
// the global view shows where skills are really in demand worldwide.
export interface HubTarget {
  hub: string; // matches the HUB_LNGLAT / skillidx byCity key
  country: string; // Adzuna country code
  where: string; // Adzuna `where` location filter
}

export const GLOBAL_HUB_TARGETS: HubTarget[] = [
  { hub: 'london', country: 'gb', where: 'London' },
  { hub: 'toronto', country: 'ca', where: 'Toronto' },
  { hub: 'johannesburg', country: 'za', where: 'Johannesburg' },
  { hub: 'houston', country: 'us', where: 'Houston' },
  { hub: 'denver', country: 'us', where: 'Denver' },
  { hub: 'newyork', country: 'us', where: 'New York' },
  { hub: 'sanfrancisco', country: 'us', where: 'San Francisco' },
  { hub: 'chicago', country: 'us', where: 'Chicago' },
  { hub: 'seattle', country: 'us', where: 'Seattle' },
  { hub: 'paris', country: 'fr', where: 'Paris' },
];
