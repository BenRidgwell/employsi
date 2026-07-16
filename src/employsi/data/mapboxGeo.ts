// Real-world Perth head-office coordinates for each company, geocoded from
// their actual HQ street addresses via the Mapbox Geocoding API. The default
// camera is framed to fit the whole spread — most sit along St Georges
// Terrace, but Fortescue (East Perth) and Sandfire (West Perth) are ~1.5km
// either side of the CBD cluster.
export const PERTH_CENTER: [number, number] = [115.8552, -31.9542];
// Bumped from 15.3 so 3D extruded buildings are clearly visible on arrival,
// not just at street level once you zoom in further yourself.
export const PERTH_DEFAULT_ZOOM = 16.6;
export const PERTH_DEFAULT_PITCH = 60;
export const PERTH_DEFAULT_BEARING = -17.6;

// Local city views. Only Perth has companies mapped for now; the others open
// the same 3D city look with no company pins yet.
export interface CityView {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}
export const CITY_VIEWS: Record<string, CityView> = {
  perth: { center: PERTH_CENTER, zoom: PERTH_DEFAULT_ZOOM, pitch: PERTH_DEFAULT_PITCH, bearing: PERTH_DEFAULT_BEARING },
  melbourne: { center: [144.9640, -37.8155], zoom: 16.4, pitch: 60, bearing: -18 },
  brisbane: { center: [153.026, -27.4705], zoom: 16.5, pitch: 60, bearing: -18 },
  adelaide: { center: [138.6007, -34.9285], zoom: 16.5, pitch: 60, bearing: -16 },
  sydney: { center: [151.2093, -33.8688], zoom: 16.5, pitch: 60, bearing: -18 },
  singapore: { center: [103.8519, 1.29], zoom: 16.4, pitch: 60, bearing: -12 },
  ganzhou: { center: [114.9333, 25.83], zoom: 16.1, pitch: 60, bearing: -14 },
  toronto: { center: [-79.3832, 43.6532], zoom: 16.4, pitch: 60, bearing: -18 },
  houston: { center: [-95.3698, 29.7604], zoom: 16.3, pitch: 60, bearing: -14 },
  denver: { center: [-104.9903, 39.7392], zoom: 16.3, pitch: 60, bearing: -16 },
  johannesburg: { center: [28.0473, -26.2041], zoom: 16.3, pitch: 60, bearing: -15 },
  lubumbashi: { center: [27.4794, -11.66], zoom: 16.2, pitch: 60, bearing: -12 },
  london: { center: [-0.1276, 51.5072], zoom: 16.4, pitch: 60, bearing: -20 },
  santiago: { center: [-70.6693, -33.4489], zoom: 16.3, pitch: 60, bearing: -16 },
  newyork: { center: [-74.006, 40.7128], zoom: 16.4, pitch: 60, bearing: -20 },
  sanfrancisco: { center: [-122.4194, 37.7749], zoom: 16.4, pitch: 60, bearing: -18 },
  chicago: { center: [-87.6298, 41.8781], zoom: 16.4, pitch: 60, bearing: -18 },
  tokyo: { center: [139.6917, 35.6895], zoom: 16.4, pitch: 60, bearing: -14 },
  zurich: { center: [8.5417, 47.3769], zoom: 16.3, pitch: 60, bearing: -16 },
  geneva: { center: [6.1432, 46.2044], zoom: 16.3, pitch: 60, bearing: -16 },
  dubai: { center: [55.2708, 25.2048], zoom: 16.3, pitch: 60, bearing: -12 },
  hongkong: { center: [114.1694, 22.3193], zoom: 16.4, pitch: 60, bearing: -16 },
};

// A company placed on a city map: its id plus that city's head-office coords.
// The same company can appear in several cities (e.g. BHP in Perth, Adelaide
// and Brisbane) with different coordinates in each.
export interface CityCompany {
  id: string;
  coords: [number, number];
}

// Companies pinned per local city. Perth, Adelaide and Brisbane each have their
// own head-office spread; the remaining cities open the 3D view with no pins.
export const CITY_COMPANIES: Record<string, CityCompany[]> = {
  // Real HQ coordinates, geocoded (via OpenStreetMap Nominatim) from each
  // company's current registered head-office address — building-level where
  // OSM has the building. Note several sit well outside the CBD: IGO is across
  // the river in South Perth, Mineral Resources is in Osborne Park (~5km NW),
  // Northern Star in Subiaco, and the lithium juniors along Colin/Ord St in
  // West Perth — so they fall outside the default CBD camera frame and are
  // reached by panning or by opening the company from search.
  perth: [
    { id: 'rio', coords: [115.85582, -31.95409] }, // Central Park, 152 St Georges Tce
    { id: 'bhp', coords: [115.85455, -31.95471] }, // Brookfield Place, 125 St Georges Tce
    { id: 's32', coords: [115.856832, -31.954441] }, // South32 — 108 St Georges Tce
    { id: 'fmg', coords: [115.850038, -31.952205] }, // Fortescue — 256 St Georges Tce
    { id: 'wds', coords: [115.849832, -31.953822] }, // Woodside — Mia Yellagonga, 11 Mount St
    { id: 'sto', coords: [115.850857, -31.952325] }, // Santos — QV1, 250 St Georges Tce
    { id: 'chevron', coords: [115.858352, -31.957165] }, // Chevron HQ — 1 The Esplanade, Elizabeth Quay
    { id: 'sfr', coords: [115.841389, -31.952468] }, // Sandfire — 10 Kings Park Rd, West Perth
    { id: 'igo', coords: [115.853211, -31.972235] }, // IGO — 85 South Perth Esplanade, South Perth
    { id: 'min', coords: [115.808277, -31.909375] }, // Mineral Resources — 20 Walters Dr, Osborne Park
    { id: 'pls', coords: [115.842641, -31.947562] }, // Pilbara Minerals — 146 Colin St, West Perth
    { id: 'ltr', coords: [115.840467, -31.950194] }, // Liontown — 32 Ord St, West Perth
    { id: 'ilu', coords: [115.851839, -31.952745] }, // Iluka — 240 St Georges Tce
    { id: 'nst', coords: [115.822660, -31.946683] }, // Northern Star — 500 Hay St, Subiaco
    // Additional Perth-listed names. Coordinates place each at its real
    // head-office suburb (West Perth / Subiaco cluster, CBD, or further out for
    // Austal at Henderson and the services firms east of the river).
    { id: 'pdn', coords: [115.84050, -31.94900] }, // Paladin Energy — West Perth
    { id: 'wgx', coords: [115.84200, -31.94750] }, // Westgold — West Perth
    { id: 'stx', coords: [115.83950, -31.95050] }, // Strike Energy — West Perth
    { id: 'alk', coords: [115.84380, -31.94980] }, // Alkane Resources — West Perth
    { id: 'rrl', coords: [115.83000, -31.94700] }, // Regis Resources — Subiaco
    { id: 'pru', coords: [115.83850, -31.94820] }, // Perseus Mining — West Perth
    { id: 'rms', coords: [115.84120, -31.95120] }, // Ramelius — West Perth
    { id: 'deg', coords: [115.85600, -31.95250] }, // De Grey Mining — Perth CBD
    { id: 'gmd', coords: [115.84280, -31.94680] }, // Genesis Minerals — West Perth
    { id: 'gor', coords: [115.83780, -31.94950] }, // Gold Road — West Perth
    { id: 'cmm', coords: [115.84420, -31.95080] }, // Capricorn Metals — West Perth
    { id: 'dyl', coords: [115.83600, -31.94780] }, // Deep Yellow — Subiaco/West Perth
    { id: 'bmn', coords: [115.84020, -31.95180] }, // Bannerman Energy — West Perth
    { id: 'boe', coords: [115.83220, -31.94880] }, // Boss Energy — Subiaco
    { id: 'cvn', coords: [115.83900, -31.94600] }, // Carnarvon Energy — West Perth
    { id: 'cxo', coords: [115.84550, -31.94850] }, // Core Lithium — West Perth
    { id: 'jms', coords: [115.85480, -31.95350] }, // Jupiter Mines — Perth CBD
    { id: 'sgq', coords: [115.83680, -31.95020] }, // St George Mining — West Perth
    { id: 'del', coords: [115.83400, -31.94550] }, // Delorean — West Perth
    { id: 'asb', coords: [115.76490, -32.15800] }, // Austal — Henderson shipyard
    { id: 'mnd', coords: [115.89650, -31.97550] }, // Monadelphous — Victoria Park
    { id: 'nwh', coords: [115.93300, -31.94300] }, // NRW Holdings — Belmont
    { id: 'mah', coords: [115.94200, -31.99050] }, // Macmahon — Welshpool
    { id: 'wes', coords: [115.85850, -31.95850] }, // Wesfarmers — 40 The Esplanade, CBD
    { id: 'ccv', coords: [115.86200, -31.95050] }, // Cash Converters — Perth CBD
    { id: 'swm', coords: [115.81450, -31.90100] }, // Seven West Media — Osborne Park
    { id: 'sw1', coords: [115.82300, -31.87700] }, // Swift Networks — Balcatta
  ],
  // Melbourne is the miners' corporate-HQ city: BHP's global head office and
  // Rio Tinto's principal Australian office are both on Collins Street. The
  // other three are illustrative corporate/registered offices placed along the
  // Collins/Bourke St spine, in keeping with how Adelaide and Brisbane are set.
  melbourne: [
    { id: 'bhp', coords: [144.96700, -37.81560] }, // BHP global HQ — 171 Collins St
    { id: 'rio', coords: [144.96180, -37.81680] }, // Rio Tinto — 360 Collins St
    { id: 's32', coords: [144.97250, -37.81450] }, // South32 — Collins St (corporate office)
    { id: 'wds', coords: [144.94900, -37.81800] }, // Woodside — Docklands (corporate office)
    { id: 'ilu', coords: [144.96900, -37.81150] }, // Iluka — Exhibition St (corporate office)
  ],
  adelaide: [
    { id: 'bhp', coords: [138.60190, -34.92450] }, // 55 Grenfell St
    { id: 'sto', coords: [138.60420, -34.92655] }, // Santos — 60 Flinders St
    { id: 'beach', coords: [138.61780, -34.93540] }, // Beach Energy — 25 Conyngham St, Glenside
    { id: 'mgt', coords: [138.59870, -34.92150] }, // Magnetite Mines
    { id: 'hgo', coords: [138.60010, -34.93010] }, // Hillgrove Resources
  ],
  brisbane: [
    { id: 'bhp', coords: [153.02950, -27.46700] }, // 480 Queen St
    { id: 'rio', coords: [153.02700, -27.46850] }, // Central Plaza, 345 Queen St
    { id: 'smr', coords: [153.02900, -27.46830] }, // Stanmore — 12 Creek St
    { id: 'nhc', coords: [153.02470, -27.47200] }, // New Hope Group
    { id: 'shell', coords: [153.02230, -27.46950] }, // Shell / QGC — 275 George St
    { id: 'aow', coords: [153.03160, -27.46950] }, // Arrow Energy — 1 Eagle St
    { id: 'mmi', coords: [153.03300, -27.45700] }, // Metro Mining — Fortitude Valley
    { id: 'jellinbah', coords: [153.02380, -27.46620] }, // Jellinbah Group
  ],
};

// Flat lookup of every company's coords across all cities. Where a company sits
// in multiple cities the last-listed city wins; only used as a fallback (the
// map tracks the active city's coords directly).
export const COMPANY_COORDS: Record<string, [number, number]> = Object.values(
  CITY_COMPANIES,
).reduce<Record<string, [number, number]>>((acc, list) => {
  list.forEach((c) => { acc[c.id] = c.coords; });
  return acc;
}, {});

// The local city whose map actually plots this company. Prefers the city
// already being viewed (so navigating there doesn't jump unnecessarily),
// otherwise the first city that lists it, defaulting to Perth.
export function cityForCompany(id: string, currentCity?: string): string {
  if (currentCity && CITY_COMPANIES[currentCity]?.some((c) => c.id === id)) return currentCity;
  const hit = Object.entries(CITY_COMPANIES).find(([, list]) => list.some((c) => c.id === id));
  return hit ? hit[0] : 'perth';
}
