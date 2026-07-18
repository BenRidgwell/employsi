// Global hubs Adzuna can't reach, sampled instead through Jooble's REST API — a
// job-board aggregator covering 70+ countries including Japan, South Korea,
// China, Hong Kong, the UAE and Switzerland (all outside Adzuna's footprint).
// Each hub is a whole-market city sample (current advertised roles in that city,
// mapped to skills), the same shape as the Adzuna hub samples in
// globalHubTargets.ts, so both feeds merge into the one global skill heatmap.
//
// Jooble has a single endpoint (https://jooble.org/api/{key}); the market is
// selected purely by the free-text `location`, so each target carries a
// fully-qualified "City, Country" string to disambiguate. Coverage is strong for
// Tokyo / Seoul / Hong Kong / Dubai / Zurich; mainland China (Beijing, Ganzhou)
// is thinner and may stay sparse until a China-native board is added — those
// degrade to an empty sample rather than inventing numbers.
export interface JoobleHubTarget {
  hub: string; // matches the HUB_LNGLAT / skillidx byCity key
  location: string; // Jooble free-text `location` (City, Country)
}

export const JOOBLE_HUB_TARGETS: JoobleHubTarget[] = [
  { hub: 'tokyo', location: 'Tokyo, Japan' },
  { hub: 'seoul', location: 'Seoul, South Korea' },
  { hub: 'hongkong', location: 'Hong Kong' },
  { hub: 'dubai', location: 'Dubai, United Arab Emirates' },
  { hub: 'zurich', location: 'Zurich, Switzerland' },
  { hub: 'beijing', location: 'Beijing, China' },
  { hub: 'ganzhou', location: 'Ganzhou, China' },
];
