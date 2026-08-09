// Real-world Perth head-office coordinates for each company, geocoded from
// their actual HQ street addresses via the Mapbox Geocoding API. The default
// camera is framed to fit the whole spread — most sit along St Georges
// Terrace, but Fortescue (East Perth) and Sandfire (West Perth) are ~1.5km
// either side of the CBD cluster.
import { CITY_ROSTERS } from "./cityRosters";
import { spreadCoords, spreadCoordsCity, CITY_PLACEMENT, rosterId } from "./rosters";
import { PERTH_GOV_IDS } from "./perthGov";
import { ADELAIDE_GOV_IDS } from "./adelaideGov";
import { MELBOURNE_GOV_IDS } from "./melbourneGov";
import { BRISBANE_GOV_IDS } from "./brisbaneGov";
import { APS_GOV_IDS, APS_GOV_HUB } from "./canberraGov";
import { DARWIN_GOV_IDS } from "./darwinGov";
import { HOBART_GOV_IDS } from "./hobartGov";
import { SYDNEY_GOV_IDS } from "./sydneyGov";
import { TOP_PRIVATE_BY_CITY } from "./topPrivateCompanies";
import { NZ_BY_CITY } from "./nzCompanies";
import { NZ_GOV_IDS, NZ_GOV_HUB } from "./nzGov";
import { PERTH_REAL_COORDS } from "./perthRealCoords";
import { AU_REAL_COORDS } from "./auRealCoords";
import { SAN_JOSE_REAL_COORDS } from "./sanJoseRealCoords";
import { SECONDARY_OFFICES, HQ_OVERRIDE } from "./secondaryOffices";
import { CITY_CONTINENT } from "./geo";

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
  perth: {
    center: PERTH_CENTER,
    zoom: PERTH_DEFAULT_ZOOM,
    pitch: PERTH_DEFAULT_PITCH,
    bearing: PERTH_DEFAULT_BEARING,
  },
  melbourne: { center: [144.964, -37.8155], zoom: 16.4, pitch: 60, bearing: -18 },
  brisbane: { center: [153.026, -27.4705], zoom: 16.5, pitch: 60, bearing: -18 },
  adelaide: { center: [138.6007, -34.9285], zoom: 16.5, pitch: 60, bearing: -16 },
  canberra: { center: [149.1289, -35.282], zoom: 16.1, pitch: 60, bearing: -15 },
  darwin: { center: [130.8418, -12.4611], zoom: 16.2, pitch: 60, bearing: -20 },
  hobart: { center: [147.3257, -42.8826], zoom: 16.3, pitch: 60, bearing: -16 },
  auckland: { center: [174.7645, -36.8485], zoom: 16.2, pitch: 60, bearing: -18 },
  wellington: { center: [174.7759, -41.2865], zoom: 16.2, pitch: 60, bearing: -20 },
  sydney: { center: [151.2093, -33.8688], zoom: 16.5, pitch: 60, bearing: -18 },
  // Centred on the COMPANIES, not on the city. The camera used to sit at
  // 103.8519,1.29 — a kilometre north-east of where the 25 Singapore pins
  // actually fall (median 103.8479,1.2811, all inside 103.8449..103.8503 /
  // 1.2764..1.2865), which opened the local view on empty ground with the
  // roster off to one side.
  singapore: { center: [103.8479, 1.2811], zoom: 16.4, pitch: 60, bearing: -12 },
  // KLCC — the corporate core, around the Petronas Towers and Jalan Ampang.
  kualalumpur: { center: [101.7115, 3.1578], zoom: 16.0, pitch: 60, bearing: -15 },
  // Makati, not the City of Manila: the offices these companies run are in the
  // Makati/BGC business districts, ~6km inland from Manila Bay.
  manila: { center: [121.0244, 14.5547], zoom: 15.8, pitch: 60, bearing: -10 },
  ganzhou: { center: [114.9333, 25.83], zoom: 16.1, pitch: 60, bearing: -14 },
  toronto: { center: [-79.3832, 43.6532], zoom: 16.4, pitch: 60, bearing: -18 },
  houston: { center: [-95.3698, 29.7604], zoom: 16.3, pitch: 60, bearing: -14 },
  austin: { center: [-97.7431, 30.2672], zoom: 16.3, pitch: 60, bearing: -15 },
  atlanta: { center: [-84.388, 33.749], zoom: 16.3, pitch: 60, bearing: -16 },
  bentonville: { center: [-94.2088, 36.3729], zoom: 16.2, pitch: 60, bearing: -14 },
  omaha: { center: [-95.9345, 41.2565], zoom: 16.3, pitch: 60, bearing: -15 },
  indianapolis: { center: [-86.1581, 39.7684], zoom: 16.3, pitch: 60, bearing: -16 },
  sandiego: { center: [-117.1611, 32.7157], zoom: 16.3, pitch: 60, bearing: -14 },
  losangeles: { center: [-118.2437, 34.0522], zoom: 16.3, pitch: 60, bearing: -18 },
  charlotte: { center: [-80.8431, 35.2271], zoom: 16.3, pitch: 60, bearing: -15 },
  minneapolis: { center: [-93.265, 44.9778], zoom: 16.3, pitch: 60, bearing: -16 },
  cincinnati: { center: [-84.512, 39.1031], zoom: 16.3, pitch: 60, bearing: -15 },
  boston: { center: [-71.0589, 42.3601], zoom: 16.4, pitch: 60, bearing: -18 },
  dallas: { center: [-96.797, 32.7767], zoom: 16.3, pitch: 60, bearing: -15 },
  washington: { center: [-77.0369, 38.9072], zoom: 16.3, pitch: 60, bearing: -18 },
  philadelphia: { center: [-75.1652, 39.9526], zoom: 16.3, pitch: 60, bearing: -16 },
  portland: { center: [-122.6765, 45.5231], zoom: 16.3, pitch: 60, bearing: -14 },
  calgary: { center: [-114.0719, 51.0447], zoom: 16.3, pitch: 60, bearing: -15 },
  montreal: { center: [-73.5674, 45.5019], zoom: 16.4, pitch: 60, bearing: -17 },
  vancouver: { center: [-123.1207, 49.2827], zoom: 16.3, pitch: 60, bearing: -14 },
  ottawa: { center: [-75.6972, 45.4215], zoom: 16.3, pitch: 60, bearing: -16 },
  shanghai: { center: [121.4737, 31.2304], zoom: 16.2, pitch: 60, bearing: -14 },
  shenzhen: { center: [114.0579, 22.5431], zoom: 16.2, pitch: 60, bearing: -14 },
  denver: { center: [-104.9903, 39.7392], zoom: 16.3, pitch: 60, bearing: -16 },
  seattle: { center: [-122.3321, 47.6062], zoom: 16.3, pitch: 60, bearing: -16 },
  johannesburg: { center: [28.0473, -26.2041], zoom: 16.3, pitch: 60, bearing: -15 },
  london: { center: [-0.1276, 51.5072], zoom: 16.4, pitch: 60, bearing: -20 },
  paris: { center: [2.3522, 48.8566], zoom: 16.3, pitch: 60, bearing: -18 },
  newyork: { center: [-74.006, 40.7128], zoom: 16.4, pitch: 60, bearing: -20 },
  sanfrancisco: { center: [-122.4194, 37.7749], zoom: 16.4, pitch: 60, bearing: -18 },
  // Silicon Valley is not a CBD — its head offices run ~30 km from Palo Alto in
  // the north-west down to Los Gatos in the south, so a street-level frame over
  // downtown San Jose would open on an empty map with every company off-screen.
  // Centre on the cluster instead and pull back to valley scale; individual
  // campuses are reached by zooming in or from search.
  sanjose: { center: [-122.0, 37.375], zoom: 12.4, pitch: 50, bearing: -15 },
  chicago: { center: [-87.6298, 41.8781], zoom: 16.4, pitch: 60, bearing: -18 },
  tokyo: { center: [139.6917, 35.6895], zoom: 16.4, pitch: 60, bearing: -14 },
  seoul: { center: [126.978, 37.5665], zoom: 16.4, pitch: 60, bearing: -16 },
  beijing: { center: [116.4074, 39.9042], zoom: 16.2, pitch: 60, bearing: -14 },
  zurich: { center: [8.5417, 47.3769], zoom: 16.3, pitch: 60, bearing: -16 },
  dubai: { center: [55.2708, 25.2048], zoom: 16.3, pitch: 60, bearing: -12 },
  hongkong: { center: [114.1694, 22.3193], zoom: 16.4, pitch: 60, bearing: -16 },
  // Nariman Point / Bandra-Kurla side of the Mumbai CBD.
  mumbai: { center: [72.8347, 18.9256], zoom: 16.2, pitch: 60, bearing: -15 },
  // MG Road / Cubbon Park, central Bengaluru.
  bengaluru: { center: [77.6033, 12.9757], zoom: 16.2, pitch: 60, bearing: -12 },
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
    { id: "rio", coords: [115.85582, -31.95409] }, // Central Park, 152 St Georges Tce
    { id: "bhp", coords: [115.85455, -31.95471] }, // Brookfield Place, 125 St Georges Tce
    { id: "s32", coords: [115.856832, -31.954441] }, // South32 — 108 St Georges Tce
    { id: "fmg", coords: [115.850038, -31.952205] }, // Fortescue — 256 St Georges Tce
    { id: "wds", coords: [115.849832, -31.953822] }, // Woodside — Mia Yellagonga, 11 Mount St
    { id: "sto", coords: [115.850857, -31.952325] }, // Santos — QV1, 250 St Georges Tce
    { id: "chevron", coords: [115.858352, -31.957165] }, // Chevron HQ — 1 The Esplanade, Elizabeth Quay
    { id: "sfr", coords: [115.841389, -31.952468] }, // Sandfire — 10 Kings Park Rd, West Perth
    { id: "igo", coords: [115.853211, -31.972235] }, // IGO — 85 South Perth Esplanade, South Perth
    { id: "min", coords: [115.808277, -31.909375] }, // Mineral Resources — 20 Walters Dr, Osborne Park
    { id: "pls", coords: [115.842641, -31.947562] }, // Pilbara Minerals — 146 Colin St, West Perth
    { id: "ltr", coords: [115.840467, -31.950194] }, // Liontown — 32 Ord St, West Perth
    { id: "ilu", coords: [115.851839, -31.952745] }, // Iluka — 240 St Georges Tce
    { id: "nst", coords: [115.82266, -31.946683] }, // Northern Star — 500 Hay St, Subiaco
    // Additional Perth-listed names. Coordinates place each at its real
    // head-office suburb (West Perth / Subiaco cluster, CBD, or further out for
    // Austal at Henderson and the services firms east of the river).
    { id: "pdn", coords: [115.8405, -31.949] }, // Paladin Energy — West Perth
    { id: "wgx", coords: [115.842, -31.9475] }, // Westgold — West Perth
    { id: "stx", coords: [115.8395, -31.9505] }, // Strike Energy — West Perth
    { id: "alk", coords: [115.8438, -31.9498] }, // Alkane Resources — West Perth
    { id: "rrl", coords: [115.83, -31.947] }, // Regis Resources — Subiaco
    { id: "pru", coords: [115.8385, -31.9482] }, // Perseus Mining — West Perth
    { id: "rms", coords: [115.8412, -31.9512] }, // Ramelius — West Perth
    { id: "gmd", coords: [115.8428, -31.9468] }, // Genesis Minerals — West Perth
    { id: "gor", coords: [115.8378, -31.9495] }, // Gold Road — West Perth
    { id: "cmm", coords: [115.8442, -31.9508] }, // Capricorn Metals — West Perth
    { id: "dyl", coords: [115.836, -31.9478] }, // Deep Yellow — Subiaco/West Perth
    { id: "bmn", coords: [115.8402, -31.9518] }, // Bannerman Energy — West Perth
    { id: "boe", coords: [115.8322, -31.9488] }, // Boss Energy — Subiaco
    { id: "cvn", coords: [115.839, -31.946] }, // Carnarvon Energy — West Perth
    { id: "cxo", coords: [115.8455, -31.9485] }, // Core Lithium — West Perth
    { id: "jms", coords: [115.8548, -31.9535] }, // Jupiter Mines — Perth CBD
    { id: "sgq", coords: [115.8368, -31.9502] }, // St George Mining — West Perth
    { id: "del", coords: [115.834, -31.9455] }, // Delorean — West Perth
    { id: "asb", coords: [115.7649, -32.158] }, // Austal — Henderson shipyard
    { id: "mnd", coords: [115.8965, -31.9755] }, // Monadelphous — Victoria Park
    { id: "nwh", coords: [115.933, -31.943] }, // NRW Holdings — Belmont
    { id: "mah", coords: [115.942, -31.9905] }, // Macmahon — Welshpool
    { id: "wes", coords: [115.8585, -31.9585] }, // Wesfarmers — 40 The Esplanade, CBD
    { id: "ccv", coords: [115.862, -31.9505] }, // Cash Converters — Perth CBD
    { id: "swm", coords: [115.8145, -31.901] }, // Seven West Media — Osborne Park
    { id: "sw1", coords: [115.823, -31.877] }, // Swift Networks — Balcatta
  ],
  // Melbourne is the miners' corporate-HQ city: BHP's global head office and
  // Rio Tinto's principal Australian office are both on Collins Street. The
  // other three are illustrative corporate/registered offices placed along the
  // Collins/Bourke St spine, in keeping with how Adelaide and Brisbane are set.
  melbourne: [
    { id: "bhp", coords: [144.967, -37.8156] }, // BHP global HQ — 171 Collins St
    { id: "rio", coords: [144.9618, -37.8168] }, // Rio Tinto — 360 Collins St
    { id: "s32", coords: [144.9725, -37.8145] }, // South32 — Collins St (corporate office)
  ],
  adelaide: [
    { id: "bhp", coords: [138.6019, -34.9245] }, // 55 Grenfell St
    { id: "sto", coords: [138.6042, -34.92655] }, // Santos — 60 Flinders St
    { id: "beach", coords: [138.6178, -34.9354] }, // Beach Energy — 25 Conyngham St, Glenside
    { id: "mgt", coords: [138.5987, -34.9215] }, // Magnetite Mines
    { id: "hgo", coords: [138.6001, -34.9301] }, // Hillgrove Resources
  ],
  brisbane: [
    { id: "bhp", coords: [153.0295, -27.467] }, // 480 Queen St
    { id: "rio", coords: [153.027, -27.4685] }, // Central Plaza, 345 Queen St
    { id: "smr", coords: [153.029, -27.4683] }, // Stanmore — 12 Creek St
    { id: "nhc", coords: [153.0247, -27.472] }, // New Hope Group
    { id: "shell", coords: [153.0223, -27.4695] }, // Shell / QGC — 275 George St
    // Arrow Energy — Waterfront Place, 1 Eagle St. The previous coordinate was
    // ~130 m east of the building, which put the pin in the Brisbane River
    // (tested against the river's OSM geometry); this is OSM's own point for
    // Waterfront Place.
    { id: "aow", coords: [153.030524, -27.470296] },
    { id: "mmi", coords: [153.033, -27.457] }, // Metro Mining — Fortitude Valley
    { id: "jellinbah", coords: [153.0238, -27.4662] }, // Jellinbah Group
  ],
};

// Several Perth entities share a head-office building — Dumas House (140 William
// St) alone houses five departments, and the West Perth juniors cluster in a few
// serviced-office towers. Their geocoded coordinates are therefore IDENTICAL,
// which would stack the markers exactly on top of each other and make all but
// the top one unclickable. Nudge each subsequent occupant onto a small
// deterministic ring (~20 m) around the true address: the pin stays at the right
// building, but every tenant stays individually selectable.
// Every hand-geocoded head office, keyed by company id. Perth's agencies and
// juniors were the first set; the San Jose roster joined them when the Silicon
// Valley companies were moved out of San Francisco to their real metro; the
// non-Perth Australian majors followed (scripts/geocode-au.py), each geocoded
// from a street address and checked to land on that street.
const REAL_COORDS: Record<string, [number, number]> = {
  ...PERTH_REAL_COORDS,
  ...AU_REAL_COORDS,
  ...SAN_JOSE_REAL_COORDS,
};

const _realSeen = new Map<string, number>();
/**
 * A company's verified coordinate for the city it is being drawn on.
 *
 * "<city>:<id>" is tried before "<id>". A company plotted on one map keeps a
 * plain company key; one plotted on several — the Commonwealth Bank is on five,
 * Telstra on seven — gets city-scoped keys only, because a single coordinate
 * per company means its Adelaide office IS its Sydney pin. That is how BHP came
 * to sit at 171 Collins Street on the Perth, Brisbane, Manila and Kuala Lumpur
 * maps.
 *
 * A multi-city company with no coordinate for the city being drawn falls back
 * to the generated fan, which is honest: we do not know where its office in
 * that city is.
 */
function realCoord(id: string, city?: string): [number, number] | undefined {
  const base = (city ? REAL_COORDS[`${city}:${id}`] : undefined) ?? REAL_COORDS[id];
  if (!base) return undefined;
  const key = `${base[0]},${base[1]}`;
  const n = _realSeen.get(key) ?? 0;
  _realSeen.set(key, n + 1);
  if (n === 0) return base;
  const R = 0.00022; // ~20 m
  const a = (n * 2 * Math.PI) / 6 + (n > 6 ? 0.5 : 0);
  const r = R * (1 + Math.floor((n - 1) / 6) * 0.8);
  return [
    base[0] + (r * Math.cos(a)) / Math.cos((base[1] * Math.PI) / 180),
    base[1] + r * Math.sin(a),
  ];
}

// Merge in the compact global rosters: each roster company gets a generated
// head-office coordinate fanned out around its city centre (spreadCoords),
// offset past any hand-placed companies already in that city.
for (const [city, roster] of Object.entries(CITY_ROSTERS)) {
  const view = CITY_VIEWS[city];
  if (!view) continue;
  const existing = (CITY_COMPANIES[city] ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(view.center, offset + roster.companies.length, CITY_PLACEMENT[city]);
  roster.companies.forEach((entry, i) => {
    const id = rosterId(city, entry[0]);
    existing.push({ id, coords: realCoord(id, city) ?? pts[offset + i] });
  });
}

// Perth WA government agencies: fan their office pins around the Perth centre,
// offset past everything already placed there.
{
  const view = CITY_VIEWS.perth;
  const existing = (CITY_COMPANIES.perth ||= []);
  const offset = existing.length;
  const pts = spreadCoords(view.center, offset + PERTH_GOV_IDS.length);
  PERTH_GOV_IDS.forEach((id, i) =>
    existing.push({ id, coords: realCoord(id, "perth") ?? pts[offset + i] }),
  );
}

// Adelaide SA government agencies: fan their office pins around the Adelaide
// centre, offset past everything already placed there.
{
  const view = CITY_VIEWS.adelaide;
  const existing = (CITY_COMPANIES.adelaide ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(
    view.center,
    offset + ADELAIDE_GOV_IDS.length,
    CITY_PLACEMENT.adelaide,
  );
  ADELAIDE_GOV_IDS.forEach((id, i) =>
    existing.push({ id, coords: realCoord(id, "adelaide") ?? pts[offset + i] }),
  );
}

// Melbourne VIC government agencies: fan pins around the Melbourne centre.
{
  const view = CITY_VIEWS.melbourne;
  const existing = (CITY_COMPANIES.melbourne ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(
    view.center,
    offset + MELBOURNE_GOV_IDS.length,
    CITY_PLACEMENT.melbourne,
  );
  MELBOURNE_GOV_IDS.forEach((id, i) =>
    existing.push({ id, coords: realCoord(id, "melbourne") ?? pts[offset + i] }),
  );
}

// Brisbane QLD government agencies: fan pins around the Brisbane centre.
{
  const view = CITY_VIEWS.brisbane;
  const existing = (CITY_COMPANIES.brisbane ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(
    view.center,
    offset + BRISBANE_GOV_IDS.length,
    CITY_PLACEMENT.brisbane,
  );
  BRISBANE_GOV_IDS.forEach((id, i) =>
    existing.push({ id, coords: realCoord(id, "brisbane") ?? pts[offset + i] }),
  );
}

// APS federal agencies: grouped by their HQ city (Canberra for most, a few in
// Sydney/Melbourne/Adelaide) and fanned around that city's centre.
{
  const byHub: Record<string, string[]> = {};
  for (const id of APS_GOV_IDS) (byHub[APS_GOV_HUB[id] || "canberra"] ||= []).push(id);
  for (const [hub, ids] of Object.entries(byHub)) {
    const view = CITY_VIEWS[hub];
    if (!view) continue;
    const existing = (CITY_COMPANIES[hub] ||= []);
    const offset = existing.length;
    const pts = spreadCoordsCity(view.center, offset + ids.length, CITY_PLACEMENT[hub]);
    ids.forEach((id, i) => existing.push({ id, coords: pts[offset + i] }));
  }
}

// Northern Territory government agencies: all plotted in Darwin, fanned around
// the Darwin centre (mirrors how the WA agencies all sit in Perth).
{
  const view = CITY_VIEWS.darwin;
  const existing = (CITY_COMPANIES.darwin ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(view.center, offset + DARWIN_GOV_IDS.length, CITY_PLACEMENT.darwin);
  DARWIN_GOV_IDS.forEach((id, i) =>
    existing.push({ id, coords: realCoord(id, "darwin") ?? pts[offset + i] }),
  );
}

// Tasmanian government agencies: all plotted in Hobart, fanned around the Hobart
// centre (mirrors how the WA agencies all sit in Perth).
{
  const view = CITY_VIEWS.hobart;
  const existing = (CITY_COMPANIES.hobart ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(view.center, offset + HOBART_GOV_IDS.length, CITY_PLACEMENT.hobart);
  HOBART_GOV_IDS.forEach((id, i) =>
    existing.push({ id, coords: realCoord(id, "hobart") ?? pts[offset + i] }),
  );
}

// New South Wales government agencies: all plotted in Sydney, fanned around the
// Sydney centre (mirrors how the WA agencies all sit in Perth).
{
  const view = CITY_VIEWS.sydney;
  const existing = (CITY_COMPANIES.sydney ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(view.center, offset + SYDNEY_GOV_IDS.length, CITY_PLACEMENT.sydney);
  SYDNEY_GOV_IDS.forEach((id, i) =>
    existing.push({ id, coords: realCoord(id, "sydney") ?? pts[offset + i] }),
  );
}

// Top-150 private companies. The Perth set now has real geocoded head-office
// coordinates (scripts/geocode-perth.py), so those are used directly; the other
// cities' sets have no verified street address yet and stay fanned around the
// centre like the government rosters.
for (const [city, ids] of Object.entries(TOP_PRIVATE_BY_CITY)) {
  const view = CITY_VIEWS[city];
  if (!view) continue;
  const existing = (CITY_COMPANIES[city] ||= []);
  const offset = existing.length;
  const pts = spreadCoordsCity(view.center, offset + ids.length, CITY_PLACEMENT[city]);
  ids.forEach((id, i) => existing.push({ id, coords: realCoord(id, city) ?? pts[offset + i] }));
}

// New Zealand companies: plotted at their real geocoded HQ coordinates on the
// Auckland + Wellington local views (no fan — these are verified addresses).
for (const [city, entries] of Object.entries(NZ_BY_CITY)) {
  if (!CITY_VIEWS[city]) continue;
  const existing = (CITY_COMPANIES[city] ||= []);
  entries.forEach(({ id, coords }) => existing.push({ id, coords }));
}

// New Zealand government agencies: grouped by the city each one actually
// advertises in (Wellington for the central public service, Auckland for the
// northern health districts) and fanned around that city's centre — no street
// address is verified for these, unlike the NZ companies above.
{
  const byHub: Record<string, string[]> = {};
  for (const id of NZ_GOV_IDS) (byHub[NZ_GOV_HUB[id] || "wellington"] ||= []).push(id);
  for (const [hub, ids] of Object.entries(byHub)) {
    const view = CITY_VIEWS[hub];
    if (!view) continue;
    const existing = (CITY_COMPANIES[hub] ||= []);
    const offset = existing.length;
    const pts = spreadCoordsCity(view.center, offset + ids.length, CITY_PLACEMENT[hub]);
    ids.forEach((id, i) => existing.push({ id, coords: pts[offset + i] }));
  }
}

// ── Head offices and secondary offices ──────────────────────────────────────
// Snapshot BEFORE the secondary offices are added: whichever city already holds
// a company is its head office, unless secondaryOffices.ts overrides it. Taking
// it here rather than after is the whole point — once a company is plotted in
// five cities there is no way to tell from CITY_COMPANIES which one is home.
export const HQ_CITY: Record<string, string> = {};
for (const [city, list] of Object.entries(CITY_COMPANIES)) {
  for (const c of list) if (!(c.id in HQ_CITY)) HQ_CITY[c.id] = city;
}
for (const [id, city] of Object.entries(HQ_OVERRIDE)) {
  if (CITY_VIEWS[city]) HQ_CITY[id] = city;
}

// Secondary offices: a real presence in a city, without a verified street
// address, so each is fanned around the city centre rather than given a
// building. Skipped where the company is already plotted in that city with a
// geocoded pin — that pin is better than anything this could add.
{
  const byCity: Record<string, string[]> = {};
  for (const [id, cities] of Object.entries(SECONDARY_OFFICES)) {
    for (const city of cities) {
      if (!CITY_VIEWS[city]) continue;
      if (CITY_COMPANIES[city]?.some((c) => c.id === id)) continue;
      (byCity[city] ||= []).push(id);
    }
  }
  for (const [city, ids] of Object.entries(byCity)) {
    const existing = (CITY_COMPANIES[city] ||= []);
    const offset = existing.length;
    const pts = spreadCoordsCity(
      CITY_VIEWS[city].center,
      offset + ids.length,
      CITY_PLACEMENT[city],
    );
    ids.forEach((id, i) => existing.push({ id, coords: pts[offset + i] }));
  }
}

// Every city a company is plotted in, head office first.
export function officeCitiesFor(id: string): string[] {
  const hq = HQ_CITY[id];
  const all = Object.entries(CITY_COMPANIES)
    .filter(([, list]) => list.some((c) => c.id === id))
    .map(([city]) => city);
  return hq ? [hq, ...all.filter((c) => c !== hq)] : all;
}

const RAD = Math.PI / 180;
/** Great-circle distance in km between two city centres. */
function cityDistance(a: string, b: string): number {
  const va = CITY_VIEWS[a];
  const vb = CITY_VIEWS[b];
  if (!va || !vb) return Number.POSITIVE_INFINITY;
  const [lng1, lat1] = va.center;
  const [lng2, lat2] = vb.center;
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Where selecting a company from search should take you.
 *
 * From the global layer there is no regional context, so it is the head office —
 * searching "Westpac" from the globe should land on Westpac, not on whichever
 * branch office happens to sort first.
 *
 * From a domestic layer the user has already chosen a region, and taking them
 * out of it would throw away that choice. So it is the company's office within
 * that region — the one nearest whatever city they were last looking at, when
 * there are several — and only falls back to the head office when the company
 * has no presence in the region at all.
 */
export function searchCityFor(id: string, opts: { region?: string; near?: string } = {}): string {
  const cities = officeCitiesFor(id);
  if (!cities.length) return "perth";
  const hq = cities[0];
  if (!opts.region) return hq;
  const inRegion = cities.filter((c) => CITY_CONTINENT[c] === opts.region);
  if (!inRegion.length) return hq;
  if (inRegion.length === 1 || !opts.near) return inRegion[0];
  return inRegion.reduce((best, c) =>
    cityDistance(c, opts.near!) < cityDistance(best, opts.near!) ? c : best,
  );
}

// Flat lookup of every company's coords across all cities. Where a company sits
// in multiple cities the last-listed city wins; only used as a fallback (the
// map tracks the active city's coords directly).
export const COMPANY_COORDS: Record<string, [number, number]> = Object.values(
  CITY_COMPANIES,
).reduce<Record<string, [number, number]>>((acc, list) => {
  list.forEach((c) => {
    acc[c.id] = c.coords;
  });
  return acc;
}, {});

// The local city whose map actually plots this company. Prefers the city
// already being viewed (so navigating there doesn't jump unnecessarily),
// otherwise the first city that lists it, defaulting to Perth.
export function cityForCompany(id: string, currentCity?: string): string {
  if (currentCity && CITY_COMPANIES[currentCity]?.some((c) => c.id === id)) return currentCity;
  const hit = Object.entries(CITY_COMPANIES).find(([, list]) => list.some((c) => c.id === id));
  return hit ? hit[0] : "perth";
}
