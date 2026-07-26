// Real-world lng/lat for the global-hub and domestic-city markers, used by the
// Mapbox-based global + domestic layers (WorldMapbox) in the Mapbox trial. The
// SVG layers (GlobeMap / AustraliaMap / RegionMap) use illustrative viewBox
// coordinates instead; this file is the real-geo equivalent for the trial.
import { CITY_VIEWS } from "./mapboxGeo";
import { EU_CITY_LABEL, EU_CITY_LNGLAT } from "./euVacancyDemand";
import { CITY_CONTINENT, CITY_LABEL, GLOBAL_HUB_LABEL } from "./geo";

// Marker-position nudges, applied to the map DOT only — CITY_VIEWS keeps every
// city's true centre, so flying into a local view still lands on the real CBD.
// Same treatment (and same reason) as the South Korea / Japan country chips:
// Sydney and Canberra sit ~2.4° apart, which at the Australasia frame's zoom
// puts their chips on top of each other and leaves Canberra unreadable — and
// unclickable — behind Sydney. Sydney is pulled north-east and Canberra
// south-west so both stay legible.
const MARKER_NUDGE: Record<string, [number, number]> = {
  sydney: [151.95, -33.45],
  canberra: [148.35, -35.85],
};

// Every global hub already has real head-office coordinates in CITY_VIEWS
// (they double as the local 3D-city camera centres), so the hub lng/lat is
// just each city's CITY_VIEWS centre — no separate geocoding needed, bar the
// handful of nudges above.
export const HUB_LNGLAT: Record<string, [number, number]> = Object.fromEntries(
  Object.keys(GLOBAL_HUB_LABEL).map((id) => [id, MARKER_NUDGE[id] ?? CITY_VIEWS[id].center]),
);

// AU domestic cities. Perth/Adelaide/Brisbane/Sydney are also global hubs (and
// clickable through to their local 3D view); Darwin/Melbourne/Hobart are
// domestic-only heat markers with no local view, so they're shown but not
// clickable (there's no CITY_VIEWS entry to fly into for them).
//
// These are the skill-heat blob anchors, and they deliberately reuse HUB_LNGLAT
// for the nudged cities so a city's dot and its blob never drift apart.
export const AU_CITY_LNGLAT: Record<string, [number, number]> = {
  perth: CITY_VIEWS.perth.center,
  adelaide: CITY_VIEWS.adelaide.center,
  brisbane: CITY_VIEWS.brisbane.center,
  sydney: HUB_LNGLAT.sydney,
  canberra: HUB_LNGLAT.canberra,
  darwin: [130.8456, -12.4634],
  melbourne: [144.9631, -37.8136],
  hobart: [147.3272, -42.8821],
  // New Zealand sits in the Australasia domestic view (see REGION_FRAMES).
  auckland: [174.7645, -36.8485],
  wellington: [174.7759, -41.2865],
};

// Cities that open a local 3D view when clicked (they have a CITY_VIEWS entry).
export const CLICKABLE_CITIES = new Set(Object.keys(CITY_VIEWS));

// Camera frame for each domestic region — chosen to fit that region's hubs
// comfortably in view. Used with map.flyTo when entering a domestic view.
export interface RegionFrame {
  center: [number, number];
  zoom: number;
}
export const REGION_FRAMES: Record<string, RegionFrame> = {
  // Widened east + pulled back a touch so New Zealand (Auckland) sits in frame
  // alongside the Australian capitals — an Australasia view.
  australia: { center: [146, -31], zoom: 2.55 },
  asia: { center: [104, 24], zoom: 2.3 },
  northamerica: { center: [-96, 41], zoom: 2.6 },
  europe: { center: [7, 48], zoom: 3.6 },
  africa: { center: [26, -14], zoom: 3.0 },
};

// Which hubs belong to each domestic region (reverse of CITY_CONTINENT), so a
// region view can show just its own hubs.
export const REGION_HUBS: Record<string, string[]> = Object.entries(CITY_CONTINENT).reduce<
  Record<string, string[]>
>((acc, [hub, region]) => {
  (acc[region] ||= []).push(hub);
  return acc;
}, {});

// Display label for any hub, domestic-only city, or EU country id. The Eurostat
// ids are country-level ('germany', 'spain', …) and appear as their own markers
// on the Europe domestic view, so they need a proper name here too — without
// this they fall through to the raw id.
export function cityLabel(id: string): string {
  return GLOBAL_HUB_LABEL[id] || CITY_LABEL[id] || EU_CITY_LABEL[id] || id;
}

// The default global-view camera: fully zoomed out so the whole globe is in
// view, framed on Perth / the Asia-Pacific (this app's focus) — the rest of
// the world is a drag/spin away.
export const GLOBAL_VIEW = {
  center: [100, -10] as [number, number],
  // Slightly tighter than a full pull-back so the Asia-Pacific fills more of
  // the frame on arrival.
  zoom: 1.05,
};

// ── Country roll-up for the global layer ─────────────────────────────────────
// At the global layer we don't want 49 city dots — we want one marker per
// COUNTRY carrying that country's aggregated demand, labelled with the country
// name. Clicking (or scrolling into) a country drops to its domestic layer,
// where the per-city breakdown is presented exactly as it is today.
//
// Every hub city maps to its country; the EU-country entries (which are already
// country-level, from the Eurostat wiring) map to themselves.
export const CITY_COUNTRY: Record<string, string> = {
  // Australia / New Zealand
  perth: "au",
  adelaide: "au",
  brisbane: "au",
  melbourne: "au",
  sydney: "au",
  canberra: "au",
  darwin: "au",
  hobart: "au",
  auckland: "nz",
  wellington: "nz",
  // Asia
  singapore: "sg",
  tokyo: "jp",
  hongkong: "hk",
  dubai: "ae",
  seoul: "kr",
  ganzhou: "cn",
  shanghai: "cn",
  shenzhen: "cn",
  beijing: "cn",
  // North America
  toronto: "ca",
  calgary: "ca",
  montreal: "ca",
  vancouver: "ca",
  ottawa: "ca",
  houston: "us",
  denver: "us",
  newyork: "us",
  sanfrancisco: "us",
  sanjose: "us",
  chicago: "us",
  seattle: "us",
  austin: "us",
  atlanta: "us",
  bentonville: "us",
  omaha: "us",
  indianapolis: "us",
  sandiego: "us",
  losangeles: "us",
  charlotte: "us",
  minneapolis: "us",
  cincinnati: "us",
  boston: "us",
  dallas: "us",
  washington: "us",
  philadelphia: "us",
  portland: "us",
  // Europe
  london: "gb",
  zurich: "ch",
  paris: "fr",
  // Africa
  johannesburg: "za",
  // EU countries (already country-level ids from the Eurostat wiring). France
  // shares 'fr' with Paris so the two sources combine into one country total.
  belgium: "be",
  bulgaria: "bg",
  czechia: "cz",
  germany: "de",
  estonia: "ee",
  ireland: "ie",
  greece: "gr",
  spain: "es",
  france: "fr",
  croatia: "hr",
  italy: "it",
  cyprus: "cy",
  latvia: "lv",
  lithuania: "lt",
  luxembourg: "lu",
  hungary: "hu",
  malta: "mt",
  netherlands: "nl",
  austria: "at",
  poland: "pl",
  portugal: "pt",
  romania: "ro",
  slovenia: "si",
  slovakia: "sk",
  finland: "fi",
  sweden: "se",
};

export interface CountryInfo {
  label: string;
  region: string; // domestic layer entered on click / scroll-in
  center: [number, number]; // where the country marker sits
}

// Countries that carry mapped hubs. The EU-only countries (Germany, Spain, …)
// are added below from the Eurostat coordinate table so their demand also rolls
// up at the global layer.
export const COUNTRIES: Record<string, CountryInfo> = {
  au: { label: "Australia", region: "australia", center: [134.0, -25.6] },
  nz: { label: "New Zealand", region: "australia", center: [172.8, -41.2] },
  sg: { label: "Singapore", region: "asia", center: [103.82, 1.35] },
  jp: { label: "Japan", region: "asia", center: [139.6, 34.9] },
  hk: { label: "Hong Kong", region: "asia", center: [114.17, 22.32] },
  ae: { label: "United Arab Emirates", region: "asia", center: [54.0, 24.3] },
  // Pulled north-west (and Japan south-east) so the two chips don't collide
  // at global zoom — they sit only ~10° apart on the real map.
  kr: { label: "South Korea", region: "asia", center: [126.6, 38.6] },
  cn: { label: "China", region: "asia", center: [104.2, 35.0] },
  ca: { label: "Canada", region: "northamerica", center: [-98.0, 56.0] },
  us: { label: "United States", region: "northamerica", center: [-98.5, 39.0] },
  gb: { label: "United Kingdom", region: "europe", center: [-1.9, 53.0] },
  ch: { label: "Switzerland", region: "europe", center: [8.23, 46.8] },
  fr: { label: "France", region: "europe", center: [2.45, 46.6] },
  za: { label: "South Africa", region: "africa", center: [24.7, -29.0] },
  // EU countries carrying Eurostat demand — their marker sits on the capital
  // already geocoded for the Europe domestic view.
  be: { label: "Belgium", region: "europe", center: EU_CITY_LNGLAT.belgium },
  bg: { label: "Bulgaria", region: "europe", center: EU_CITY_LNGLAT.bulgaria },
  cz: { label: "Czechia", region: "europe", center: EU_CITY_LNGLAT.czechia },
  de: { label: "Germany", region: "europe", center: EU_CITY_LNGLAT.germany },
  ee: { label: "Estonia", region: "europe", center: EU_CITY_LNGLAT.estonia },
  ie: { label: "Ireland", region: "europe", center: EU_CITY_LNGLAT.ireland },
  gr: { label: "Greece", region: "europe", center: EU_CITY_LNGLAT.greece },
  es: { label: "Spain", region: "europe", center: EU_CITY_LNGLAT.spain },
  hr: { label: "Croatia", region: "europe", center: EU_CITY_LNGLAT.croatia },
  it: { label: "Italy", region: "europe", center: EU_CITY_LNGLAT.italy },
  cy: { label: "Cyprus", region: "europe", center: EU_CITY_LNGLAT.cyprus },
  lv: { label: "Latvia", region: "europe", center: EU_CITY_LNGLAT.latvia },
  lt: { label: "Lithuania", region: "europe", center: EU_CITY_LNGLAT.lithuania },
  lu: { label: "Luxembourg", region: "europe", center: EU_CITY_LNGLAT.luxembourg },
  hu: { label: "Hungary", region: "europe", center: EU_CITY_LNGLAT.hungary },
  mt: { label: "Malta", region: "europe", center: EU_CITY_LNGLAT.malta },
  nl: { label: "Netherlands", region: "europe", center: EU_CITY_LNGLAT.netherlands },
  at: { label: "Austria", region: "europe", center: EU_CITY_LNGLAT.austria },
  pl: { label: "Poland", region: "europe", center: EU_CITY_LNGLAT.poland },
  pt: { label: "Portugal", region: "europe", center: EU_CITY_LNGLAT.portugal },
  ro: { label: "Romania", region: "europe", center: EU_CITY_LNGLAT.romania },
  si: { label: "Slovenia", region: "europe", center: EU_CITY_LNGLAT.slovenia },
  sk: { label: "Slovakia", region: "europe", center: EU_CITY_LNGLAT.slovakia },
  fi: { label: "Finland", region: "europe", center: EU_CITY_LNGLAT.finland },
  se: { label: "Sweden", region: "europe", center: EU_CITY_LNGLAT.sweden },
};

// Which cities/among-country ids roll up into each country.
export const COUNTRY_MEMBERS: Record<string, string[]> = Object.entries(CITY_COUNTRY).reduce<
  Record<string, string[]>
>((acc, [city, cc]) => {
  (acc[cc] ||= []).push(city);
  return acc;
}, {});
