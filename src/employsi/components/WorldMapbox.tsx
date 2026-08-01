import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { useAppStore, cityMatchesFilters, type FilterState } from "../state/store";
import { activeSkill, demandByCity, iviCityDemandAt, iviCityChangeAt } from "../lib/skillHeat";
import {
  HUB_LNGLAT,
  AU_CITY_LNGLAT,
  CLICKABLE_CITIES,
  REGION_FRAMES,
  REGION_HUBS,
  GLOBAL_VIEW,
  cityLabel,
  CITY_COUNTRY,
  COUNTRIES,
  COUNTRY_MEMBERS,
} from "../data/mapboxWorldGeo";
import { EU_CITY_LNGLAT } from "../data/euVacancyDemand";
import { buildMarker, MARKER_FOOT, type MarkerShape } from "../lib/mapMarker";
import { SATELLITE_SVG, LOCO_SVG, WAGON_SVG } from "./vehicleSprites";
import { codeFor } from "../data/cityCodes";

// Europe domestic points: the mapped hubs (London/Zurich/Paris) plus every EU
// country that carries Eurostat by-country vacancy data, each on its capital.
// These drive BOTH the skill-demand heat and the labelled markers — the Europe
// view is the only place the per-country Eurostat breakdown can be read, so the
// countries have to be present and named there. (They were briefly heat-only,
// which left them invisible once the global layer clustered Europe into one
// chip: there was then no zoom at which an individual country could be seen.)
// Crowding is handled by the shared label gate — names fade in on zoom-in.
const EUROPE_HEAT_LNGLAT: Record<string, [number, number]> = (() => {
  const t: Record<string, [number, number]> = {};
  (REGION_HUBS.europe || []).forEach((id) => {
    if (HUB_LNGLAT[id]) t[id] = HUB_LNGLAT[id];
  });
  for (const [id, ll] of Object.entries(EU_CITY_LNGLAT)) t[id] = ll;
  return t;
})();

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_ID = "world-hubs";
const HALO_LAYER = "hub-halo";
const CORE_LAYER = "hub-core";
const SKILL_SOURCE = "skill-heat";
const SKILL_LAYER = "skill-heat";

// Neutral dot colour used while a skill search is active — the coloured metric
// heat is replaced by the skill-demand blobs, so the city dots go dark (as they
// do on the SVG layers), keeping the blobs the only colour on the map.
const NEUTRAL_DOT = "rgb(42,42,46)";

// Decorative traffic on the globe: aircraft between city pairs, and container
// ships along real sea lanes.
type TravelMode = "plane" | "ship" | "train";
// Uniform slow-down applied to every traveler's duration (>1 = slower drift).
const TRAVEL_SLOWDOWN = 1.6;

const RAIL_SOURCE = "au-rail";
const RAIL_BED_LAYER = "au-rail-bed";
const RAIL_SLEEPER_LAYER = "au-rail-sleepers";

/**
 * The Australian interstate rail network, as it actually exists.
 *
 * Five lines, each a real corridor with real towns on it — waypoints rather
 * than interpolation, for the same reason the shipping lanes are drawn that
 * way: a straight line between two capitals crosses whatever happens to be in
 * between, and on this continent that is usually desert with no track on it.
 *
 * The shape that surprises people is that Perth and Darwin are NOT connected up
 * the west coast. The Trans-Australian runs due east from Perth across the
 * Nullarbor to Tarcoola, and only there does the Adelaide–Darwin line branch
 * north through Alice Springs. A freight consist making that trip therefore
 * crosses to the middle of the continent before it turns for the Top End.
 */
const RAIL_PERTH_TARCOOLA: [number, number][] = [
  [115.857, -31.953], // Perth
  [116.667, -31.653], // Northam
  [118.279, -31.482], // Merredin
  [121.466, -30.749], // Kalgoorlie
  [125.327, -31.012], // Rawlinna
  [128.9, -30.85], // Nullarbor
  [130.402, -30.617], // Cook
  [134.567, -30.702], // Tarcoola — the Darwin line branches here
];
const RAIL_TARCOOLA_DARWIN: [number, number][] = [
  [134.567, -30.702], // Tarcoola
  [134.755, -29.014], // Manguri (Coober Pedy)
  [133.63, -27.3], // Marla
  [133.3, -25.84], // Kulgera
  [133.881, -23.699], // Alice Springs
  [134.19, -19.652], // Tennant Creek
  [133.54, -17.55], // Elliott
  [132.263, -14.465], // Katherine
  [131.11, -13.24], // Adelaide River
  [130.845, -12.463], // Darwin
];
const RAIL_TARCOOLA_ADELAIDE: [number, number][] = [
  [134.567, -30.702], // Tarcoola
  [135.3, -30.9], // Kingoonya
  [136.8, -31.25], // Pimba
  [137.766, -32.493], // Port Augusta
  [138.017, -33.183], // Port Pirie
  [138.21, -33.35], // Crystal Brook
  [138.75, -34.6], // Gawler
  [138.6, -34.928], // Adelaide
];
const RAIL_ADELAIDE_MELBOURNE: [number, number][] = [
  [138.6, -34.928], // Adelaide
  [139.27, -35.12], // Murray Bridge
  [140.78, -36.31], // Bordertown
  [141.65, -36.33], // Nhill
  [142.2, -36.71], // Horsham
  [142.93, -37.28], // Ararat
  [143.85, -37.56], // Ballarat
  [144.58, -37.68], // Melton
  [144.963, -37.814], // Melbourne
];
const RAIL_MELBOURNE_SYDNEY: [number, number][] = [
  [144.963, -37.814], // Melbourne
  [145.13, -37.03], // Seymour
  [145.98, -36.55], // Benalla
  [146.32, -36.36], // Wangaratta
  [146.92, -36.08], // Albury–Wodonga
  [147.37, -35.11], // Wagga Wagga
  [147.58, -34.87], // Junee
  [148.03, -34.65], // Cootamundra
  [148.91, -34.84], // Yass
  [149.72, -34.75], // Goulburn
  [150.37, -34.55], // Moss Vale
  [151.209, -33.868], // Sydney
];

/** Every line, drawn as track. */
const AU_RAIL_NETWORK: [number, number][][] = [
  RAIL_PERTH_TARCOOLA,
  RAIL_TARCOOLA_DARWIN,
  RAIL_TARCOOLA_ADELAIDE,
  RAIL_ADELAIDE_MELBOURNE,
  RAIL_MELBOURNE_SYDNEY,
];

/**
 * The freight consist's own run: Perth to Darwin, which is two of those lines
 * joined at Tarcoola. The junction is dropped from the second so the train does
 * not sit still for a frame on a duplicated coordinate.
 */
const AU_RAIL_PATH: [number, number][] = [...RAIL_PERTH_TARCOOLA, ...RAIL_TARCOOLA_DARWIN.slice(1)];

/**
 * Satellites, parked out in space around the globe.
 *
 * They do NOT orbit the globe — they sit at fixed points in the black, drifting
 * gently, the way a distant object does against a moving camera. Each is
 * anchored as a fraction of the frame rather than at a pixel, so the
 * arrangement survives a resize.
 *
 * Visibility falls out of the geometry instead of being flagged per layer: a
 * satellite is drawn only while it is genuinely in space, i.e. further from the
 * globe's centre than the globe's own radius. Zooming in grows that radius, so
 * the globe swallows them one by one and they are gone by the time the frame is
 * filled — and zooming back out into space brings them back, in place.
 */
interface SatelliteDrift {
  /** Anchor, as a fraction of the frame. */
  x: number;
  y: number;
  /** Drift amplitude in px, and its period in seconds, per axis. */
  ax: number;
  ay: number;
  px: number;
  py: number;
  /** Seconds per revolution of its own slow tumble; sign sets the direction. */
  spin: number;
}
const SATELLITES: SatelliteDrift[] = [
  { x: 0.13, y: 0.19, ax: 14, ay: 9, px: 17, py: 23, spin: 90 },
  { x: 0.87, y: 0.28, ax: 11, ay: 13, px: 21, py: 15, spin: -120 },
  { x: 0.79, y: 0.83, ax: 13, ay: 10, px: 19, py: 26, spin: 105 },
];

// Aircraft fly hub to hub in a straight line, which is fine — they cross land.
interface PlaneRoute {
  from: string;
  to: string;
  dur: number;
  offset: number;
}
const PLANE_ROUTES: PlaneRoute[] = [
  { from: "perth", to: "singapore", dur: 24000, offset: 0.0 },
  { from: "london", to: "newyork", dur: 30000, offset: 0.35 },
  { from: "tokyo", to: "sydney", dur: 34000, offset: 0.2 },
  { from: "dubai", to: "johannesburg", dur: 27000, offset: 0.6 },
  { from: "sanfrancisco", to: "tokyo", dur: 36000, offset: 0.15 },
];

/**
 * Container-ship lanes, as waypoint paths through open water.
 *
 * Ships used to run hub-to-hub on the same straight line the aircraft use,
 * which sailed them across continents — and three of the "ports" were not ports
 * at all. Ganzhou is 400km inland in Jiangxi, Johannesburg is on the Highveld
 * with no coast within 500km, and a straight Houston→London line crosses
 * Florida. Sea routes cannot be interpolated between two city centres, so each
 * lane is written out as the waypoints a ship would actually steer, through the
 * straits that make the route possible: Malacca, Gibraltar, the Sicily Channel,
 * the Dover Strait.
 *
 * Every waypoint is open water. None of the lanes cross the antimeridian, which
 * is why the path walker below can stay in plain degrees.
 */
interface ShipLane {
  name: string;
  dur: number;
  offset: number;
  path: [number, number][];
}
const SHIP_LANES: ShipLane[] = [
  {
    name: "Rotterdam – New York (North Atlantic)",
    dur: 78000,
    offset: 0.15,
    path: [
      [3.95, 52.0],
      [1.9, 51.2],
      [-1.5, 49.9],
      [-5.5, 48.8],
      [-12.0, 47.5],
      [-25.0, 45.0],
      [-40.0, 42.5],
      [-55.0, 41.0],
      [-68.0, 40.3],
      [-73.85, 40.45],
    ],
  },
  {
    name: "Port Said – Gibraltar (Mediterranean)",
    dur: 62000,
    offset: 0.7,
    path: [
      [32.35, 31.4],
      [30.0, 32.3],
      [25.0, 33.6],
      [20.0, 34.4],
      [15.5, 35.4],
      [12.0, 37.4],
      [6.0, 37.9],
      [0.0, 36.6],
      [-5.4, 35.95],
    ],
  },
  {
    name: "Cape Town – Fremantle (Southern Indian Ocean)",
    dur: 92000,
    offset: 0.55,
    path: [
      [17.6, -34.6],
      [25.0, -37.0],
      [40.0, -38.0],
      [60.0, -37.0],
      [80.0, -36.0],
      [100.0, -35.0],
      [112.0, -33.0],
      [115.2, -32.3],
    ],
  },
  {
    name: "Hong Kong – Kota Kinabalu (South China Sea)",
    dur: 48000,
    offset: 0.3,
    path: [
      [114.3, 21.8],
      [114.8, 18.0],
      [115.3, 14.0],
      [115.7, 10.0],
      [116.0, 7.6],
      [116.1, 6.2],
    ],
  },
  {
    // Longitudes run past 180 rather than wrapping to negative, so the path
    // stays monotonic across the dateline; Mapbox wraps them on render.
    name: "Yokohama – Los Angeles (North Pacific)",
    dur: 104000,
    offset: 0.85,
    path: [
      [140.2, 34.9],
      [146.0, 35.5],
      [156.0, 38.0],
      [170.0, 41.0],
      [185.0, 44.0],
      [200.0, 46.0],
      [215.0, 44.0],
      [228.0, 38.0],
      [237.0, 34.0],
      [241.3, 33.6],
    ],
  },
];

// One traveler, resolved to a path so planes and ships animate identically.
interface Traveler {
  mode: TravelMode;
  path: [number, number][];
  dur: number;
  offset: number;
}

// Top-down 2.5D sprites from `Employsi Map Sprites.html`: a white airliner and
// a blue container ship with a laden, colour-coded deck. Both point north at
// rest, so rotating by the heading aims them along their track.
//
// The design ships the plane as a <defs> silhouette referenced twice by <use>.
// That is fine in a document with one copy, but these strings are injected into
// five plane markers at once and duplicate ids would make every <use> resolve
// against whichever copy the browser saw first. The path is inlined at both
// call sites instead, and the ids are dropped, so no instance depends on any
// other being present.
const PLANE_PATH =
  "M80 8c9 0 15 13 16 32v34l52 34c5 3 4 9-2 8l-50-10v34l24 16c4 3 3 8-2 7l-22-5v9c0 9-7 17-16 " +
  "17s-16-8-16-17v-9l-22 5c-5 1-6-4-2-7l24-16v-34l-50 10c-6 1-7-5-2-8l52-34V40c1-19 7-32 16-32z";
const PLANE_SVG =
  '<svg viewBox="0 0 160 200" width="13" height="16" fill="none">' +
  // Offset copy beneath the airframe, which is what gives the sprite its lift.
  `<g transform="translate(3,5)" fill="#cfc6c2"><path d="${PLANE_PATH}"/></g>` +
  '<g><rect x="41" y="84" width="15" height="30" rx="7.5" fill="#ffffff" stroke="#c2b8b4" stroke-width="3"/>' +
  '<path d="M45 96h7" stroke="#6f5a56" stroke-width="4" stroke-linecap="round"/>' +
  '<rect x="104" y="84" width="15" height="30" rx="7.5" fill="#ffffff" stroke="#c2b8b4" stroke-width="3"/>' +
  '<path d="M108 96h7" stroke="#6f5a56" stroke-width="4" stroke-linecap="round"/></g>' +
  `<g fill="#ffffff" stroke="#c2b8b4" stroke-width="3" stroke-linejoin="round"><path d="${PLANE_PATH}"/></g>` +
  '<path d="M80 8c4.6 0 8.4 5 11 13.6-3.4 2-7 3-11 3s-7.6-1-11-3C71.6 13 75.4 8 80 8z" fill="#4a3b38"/>' +
  '<path d="M80 30v122" stroke="#e6ded9" stroke-width="2.5" stroke-linecap="round"/>' +
  '<g fill="#3c3a42">' +
  '<rect x="70" y="38" width="3.4" height="6" rx="1.7"/><rect x="70" y="50" width="3.4" height="6" rx="1.7"/>' +
  '<rect x="70" y="62" width="3.4" height="6" rx="1.7"/><rect x="70" y="74" width="3.4" height="6" rx="1.7"/>' +
  '<rect x="70" y="112" width="3.4" height="6" rx="1.7"/><rect x="70" y="124" width="3.4" height="6" rx="1.7"/>' +
  '<rect x="86.6" y="38" width="3.4" height="6" rx="1.7"/><rect x="86.6" y="50" width="3.4" height="6" rx="1.7"/>' +
  '<rect x="86.6" y="62" width="3.4" height="6" rx="1.7"/><rect x="86.6" y="74" width="3.4" height="6" rx="1.7"/>' +
  '<rect x="86.6" y="112" width="3.4" height="6" rx="1.7"/><rect x="86.6" y="124" width="3.4" height="6" rx="1.7"/>' +
  "</g></svg>";

const SHIP_HULL =
  "M60 10c14 16 22 40 22 68v192c0 12-9 22-21 22h-2c-12 0-21-10-21-22V78c0-28 8-52 22-68z";
const SHIP_SVG =
  '<svg viewBox="0 0 120 320" width="8" height="20" fill="none">' +
  `<g transform="translate(3.5,5.5)"><path d="${SHIP_HULL}" fill="#1d4f9c"/></g>` +
  `<path d="${SHIP_HULL}" fill="#2b6bc4" stroke="#1d4f9c" stroke-width="3" stroke-linejoin="round"/>` +
  '<path d="M52 62c3-14 5-22 8-26 3 4 5 12 8 26" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>' +
  '<rect x="45" y="92" width="30" height="14" rx="1.5" fill="#2f74c0"/>' +
  '<rect x="45" y="110" width="30" height="14" rx="1.5" fill="#c85a4d"/>' +
  '<rect x="45" y="128" width="30" height="14" rx="1.5" fill="#d9a441"/>' +
  '<rect x="45" y="146" width="30" height="14" rx="1.5" fill="#3f9f74"/>' +
  '<rect x="45" y="164" width="30" height="14" rx="1.5" fill="#c9cdd2"/>' +
  '<rect x="45" y="182" width="30" height="14" rx="1.5" fill="#2f74c0"/>' +
  '<rect x="45" y="200" width="30" height="14" rx="1.5" fill="#d9a441"/>' +
  '<rect x="45" y="218" width="30" height="14" rx="1.5" fill="#c85a4d"/>' +
  '<path d="M60 92v148" stroke="#ffffff" stroke-width="2"/>' +
  '<rect x="44" y="244" width="32" height="30" rx="4" fill="#ffffff"/>' +
  '<rect x="50" y="250" width="20" height="6" rx="2" fill="#5c6672" opacity=".8"/>' +
  '<rect x="55" y="262" width="10" height="9" rx="2" fill="#cf4a3d"/>' +
  "</svg>";

/**
 * Position along a multi-point path at 0..1, plus the heading there.
 *
 * Segments are measured with longitude scaled by cos(lat), so a ship covers the
 * same ground per second near the equator as it does at 46°N instead of racing
 * through the high-latitude legs of a Pacific crossing.
 *
 * Longitudes are taken as continuous, not wrapped: the Pacific lane runs 140 →
 * 241 rather than jumping 180 → −180, which keeps every segment short and the
 * bearing honest across the dateline. Mapbox wraps the rendered position.
 */
function pointOnPath(
  path: [number, number][],
  t: number,
): { pos: [number, number]; bearing: number } {
  if (path.length < 2) return { pos: path[0] ?? [0, 0], bearing: 0 };
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i];
    const [x2, y2] = path[i + 1];
    const k = Math.cos((((y1 + y2) / 2) * Math.PI) / 180);
    const d = Math.hypot((x2 - x1) * k, y2 - y1);
    seg.push(d);
    total += d;
  }
  const want = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  let i = 0;
  for (; i < seg.length - 1 && acc + seg[i] < want; i++) acc += seg[i];
  const local = seg[i] > 0 ? (want - acc) / seg[i] : 0;
  const [x1, y1] = path[i];
  const [x2, y2] = path[i + 1];
  const pos: [number, number] = [x1 + (x2 - x1) * local, y1 + (y2 - y1) * local];
  const bearing =
    (Math.atan2((x2 - x1) * Math.cos((pos[1] * Math.PI) / 180), y2 - y1) * 180) / Math.PI;
  return { pos, bearing };
}

// Layer-crossing zoom thresholds (Mapbox zoom levels). Chosen to leave each
// view's own default framing comfortably inside its band so a programmatic
// flyTo never lands right on a boundary.
// Below this globe zoom the European countries are collapsed into a single
// "Europe" chip: 26 EU countries plus the UK/CH/FR hubs sit inside a few degrees
// and their labels overlap into an unreadable pile when fully zoomed out. Past
// it they expand to individual countries.
const EUROPE_CLUSTER_ZOOM = 2.2;
const EUROPE_CLUSTER_ID = "eu-cluster";

// The North America view has the same crowding problem Europe has, for the
// opposite reason: 22 US metros (plus 5 Canadian) inside one frame, several of
// them within a few degrees — Washington/Philadelphia/New York/Boston stack up
// the eastern seaboard, and San Francisco/San Jose now sit on top of each
// other. Rather than nudge two dozen cities away from their real positions, the
// view opens on the largest metros only and reveals the rest as you zoom in —
// the same progressive-disclosure idea as the Europe cluster, minus the single
// stand-in chip (there is no "United States" to drill into from inside the US
// view; that already happened at the global layer).
const US_TIER2_ZOOM = 3.5;

// Shown at every zoom: the largest US metros by employment, chosen so the
// opening frame reads coast to coast without any two labels colliding. Everything
// else in CITY_COUNTRY['us'] appears past US_TIER2_ZOOM.
const US_PROMINENT = new Set([
  "newyork",
  "losangeles",
  "chicago",
  "dallas",
  "houston",
  "washington",
  "atlanta",
  "seattle",
  "sanfrancisco",
]);
const CROSS_GLOBAL_TO_DOMESTIC = 2.9; // zoom in past this on the globe -> region
const CROSS_DOMESTIC_TO_GLOBAL = 2.15; // zoom out past this in a region -> globe (sooner)
// Zoom in past this in a region -> drill into the nearest city's local view.
// Kept fairly close-in (city noticeably fills the frame) so the hand-off
// doesn't trigger while still surveying the whole region.
const CROSS_DOMESTIC_TO_LOCAL = 7.2;

interface Marker {
  id: string;
  coords: [number, number];
  color: string;
  label: string;
  sub: string;
  clickable: boolean;
  // Set while a skill search is active and this place has NO demand for it —
  // either the skill genuinely isn't sought there, or no labour-market series
  // covers it yet. Faded markers are dimmed and inert, exactly as company pins
  // behave at the local layer, so the places that DO answer the search are the
  // only ones competing for attention.
  faded?: boolean;
  // % change in the searched skill's demand at the current slider month (set
  // only while a skill + the time slider are active), shown as a small callout.
  pct?: number | null;
}

// Green (low) → amber → red (high), matching the heat key ramp. Used to colour
// each city dot by its demand for the searched skill.
const HEAT_RGB: [number, number, number][] = [
  [21, 157, 103],
  [245, 166, 35],
  [224, 82, 74],
];
function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const [a, b, f] = x <= 0.5 ? [0, 1, x / 0.5] : [1, 2, (x - 0.5) / 0.5];
  const c = (i: number) => Math.round(HEAT_RGB[a][i] + (HEAT_RGB[b][i] - HEAT_RGB[a][i]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

// Shared 0..1 position of a city's demand within the visible set. The sqrt
// curve spreads the low end so near-bottom cities (e.g. Perth vs Adelaide)
// separate visibly instead of both flattening to pure green. BOTH the city dot
// colour and the heat-blob weight use this same value, so a dot and its blob
// always tell the same story.
function heatT(v: number, mn: number, mx: number): number {
  const r = (v - mn) / (mx - mn || 1);
  return Math.sqrt(Math.max(0, Math.min(1, r)));
}

// Roll per-city demand up to per-country totals for the global layer. EU-country
// ids (germany, spain, …) are already country-level and map to themselves, so a
// country's total is the sum of every mapped city/territory inside it.
function countryDemand(cityDemand: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(cityDemand)) {
    if (!v) continue;
    const cc = CITY_COUNTRY[id];
    if (cc) out[cc] = (out[cc] || 0) + v;
    else if (COUNTRIES[id]) out[id] = (out[id] || 0) + v; // already a country
  }
  return out;
}

// Which markers to show for the current view. City dots stay neutral until a
// skill is searched (then the skill-demand blobs carry all the colour). Always
// filtered by the active sectors.
//
// Exported because it is the one piece of this component with real decision
// logic in it — which places appear at which zoom, and which fade out on a
// skill search — and it is pure, so it can be checked without a map.
export function computeMarkers(
  mode: "global" | "domestic",
  region: string,
  filterState: FilterState,
  demand: Record<string, number>,
  skillActive: boolean,
  zoom = 99,
): Marker[] {
  // Neutral dot tuned to each backdrop: the global view sits on the dark globe
  // (needs a light dot), the domestic view on the light basemap (needs a dark
  // dot). When a skill is searched the dot is recoloured to its demand below.
  const dotColor = mode === "global" ? "rgb(198,203,214)" : NEUTRAL_DOT;
  const out: Marker[] = [];
  const push = (id: string, coords: [number, number] | undefined) => {
    // Guard against ids that lack coordinates (e.g. a hub without a HUB_LNGLAT
    // entry): a marker with undefined coords would throw in setLngLat and crash
    // the whole view. Skip it instead.
    if (!coords) return;
    // Hide a city that has no company matching the active sector / exchange /
    // slider filters (shows every city when no filter is active).
    if (!cityMatchesFilters(id, filterState)) return;
    out.push({
      id,
      coords,
      color: dotColor,
      label: cityLabel(id),
      sub: "",
      clickable: CLICKABLE_CITIES.has(id),
    });
  };

  if (mode === "global") {
    // Country roll-up: one marker per country carrying its aggregated demand,
    // rather than 49 individual city dots. Clicking drops into that country's
    // domestic layer, where the per-city breakdown is shown as before.
    const clusterEurope = zoom < EUROPE_CLUSTER_ZOOM;
    let euDemand = 0;
    let euAny = false;
    for (const [cc, info] of Object.entries(COUNTRIES)) {
      const members = COUNTRY_MEMBERS[cc] || [];
      // Respect the filters: a country shows if ANY of its cities match.
      if (members.length && !members.some((m) => cityMatchesFilters(m, filterState))) continue;
      if (clusterEurope && info.region === "europe") {
        euDemand += demand[cc] || 0;
        euAny = true;
        continue; // rolled into the single Europe chip below
      }
      out.push({
        id: cc,
        coords: info.center,
        color: dotColor,
        label: info.label,
        sub: "",
        clickable: true,
      });
    }
    if (clusterEurope && euAny) {
      out.push({
        id: EUROPE_CLUSTER_ID,
        coords: [9.5, 50.0],
        color: dotColor,
        label: "Europe",
        sub: "",
        clickable: true,
      });
      // The cluster carries the combined demand so it colours like a country.
      demand[EUROPE_CLUSTER_ID] = euDemand;
    }
  } else {
    // Domestic: the region's own hubs (Melbourne is now a hub too, so it comes
    // through here on the AU view and on the global view; Darwin and Hobart stay
    // omitted).
    (REGION_HUBS[region] || []).forEach((id) => {
      // North America opens on the largest US metros and fills in the rest as
      // you zoom (see US_TIER2_ZOOM). Canada's five hubs are far enough apart
      // to show throughout.
      if (
        region === "northamerica" &&
        zoom < US_TIER2_ZOOM &&
        CITY_COUNTRY[id] === "us" &&
        !US_PROMINENT.has(id)
      ) {
        return;
      }
      push(id, HUB_LNGLAT[id]);
    });
    // Europe additionally shows every EU country carrying Eurostat data, on its
    // capital. They are not in REGION_HUBS (they're countries, not hub cities)
    // and have no local 3D view, so they arrive as labelled, non-clickable dots
    // that carry the country's demand — the per-country breakdown the global
    // layer's Europe cluster drills into.
    if (region === "europe") {
      for (const [id, ll] of Object.entries(EU_CITY_LNGLAT)) push(id, ll);
    }
  }

  // Colour each city dot by its demand for the searched skill, matching the heat
  // key (green low → amber → red high), normalised across the visible cities
  // that carry demand. Cities with no demand for the skill stay neutral.
  if (skillActive) {
    const vals = out.map((m) => demand[m.id] || 0).filter((v) => v > 0);
    const mn = vals.length ? Math.min(...vals) : 0;
    const mx = vals.length ? Math.max(...vals) : 0;
    out.forEach((m) => {
      const v = demand[m.id] || 0;
      if (v > 0) {
        if (vals.length) m.color = heatColor(heatT(v, mn, mx));
        return;
      }
      // No demand for the searched skill here. Fade it back and make it inert
      // rather than hiding it: the place staying on the map (greyed) is itself
      // the answer — "we cover this city, the skill isn't wanted here" reads
      // very differently from the city having vanished. Clicking through would
      // only land on an empty view, so the marker stops being a target too.
      m.faded = true;
      m.clickable = false;
    });
  }
  return out;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Demand-weighted point cloud for the skill heatmap: a small deterministic
// cluster of points around each city, weighted by that city's relative demand
// for the searched skill (normalised across the visible set). Mapbox's heatmap
// layer turns this into the soft green→amber→red blobs, mirroring the SVG
// layers' skill "spikes".
function buildSkillHeat(
  mode: "global" | "domestic",
  region: string,
  skill: string | null,
  demand: Record<string, number>,
): GeoJSON.FeatureCollection {
  if (!skill) return EMPTY_FC;
  // Coordinate table for the current view; the demand values are the REAL
  // per-city counts from the jobs pipeline (Adzuna is AU-only, so outside
  // Australia only AU hubs carry demand and light up — an honest reflection of
  // the data we actually have).
  let table: Record<string, [number, number]>;
  if (mode === "global") {
    // Global heat is per COUNTRY: one blob per country at its anchor, weighted
    // by that country's aggregated demand.
    table = Object.fromEntries(
      Object.entries(COUNTRIES).map(([cc, info]) => [cc, info.center]),
    ) as Record<string, [number, number]>;
    // The Europe cluster (used when zoomed out) needs an anchor of its own.
    table[EUROPE_CLUSTER_ID] = [9.5, 50.0];
  } else if (region === "australia") {
    // All AU capitals are now full cities (Hobart added with TAS gov, Darwin with
    // NT gov), so every one keeps its marker + skill heat.
    table = AU_CITY_LNGLAT;
  } else if (region === "europe") {
    // Hubs + every EU country with Eurostat by-country data (each on its capital).
    table = EUROPE_HEAT_LNGLAT;
  } else {
    table = {};
    (REGION_HUBS[region] || []).forEach((id) => {
      if (HUB_LNGLAT[id]) table[id] = HUB_LNGLAT[id];
    });
  }
  const ids = Object.keys(table).filter((id) => (demand[id] || 0) > 0);
  if (!ids.length) return EMPTY_FC;
  const vals = ids.map((id) => demand[id]);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);

  let seed = 99;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const features: GeoJSON.Feature[] = [];
  ids.forEach((id) => {
    // Same curve as the city dot (heatT) so a hub's dot colour and its blob
    // strength always agree. Small floor so the lowest hub is a faint green
    // wash, not a strong blob.
    const w = 0.1 + 0.9 * heatT(demand[id], mn, mx);
    const [lng, lat] = table[id];
    for (let i = 0; i < 6; i++) {
      const jx = i === 0 ? 0 : (rnd() - 0.5) * 5.4;
      const jy = i === 0 ? 0 : (rnd() - 0.5) * 5.4;
      features.push({
        type: "Feature",
        properties: { w },
        geometry: { type: "Point", coordinates: [lng + jx, lat + jy] },
      });
    }
  });
  return { type: "FeatureCollection", features };
}

function markersGeoJSON(markers: Marker[], selectedId: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: markers.map((m, i) => ({
      type: "Feature",
      id: i,
      properties: {
        id: m.id,
        color: m.color,
        // `dim` = something else is selected; `faded` = no demand for the
        // searched skill. Either one pulls the dot back, so the paint
        // expressions below treat them the same.
        dim: (!!selectedId && selectedId !== m.id) || !!m.faded,
        faded: !!m.faded,
      },
      geometry: { type: "Point", coordinates: m.coords },
    })),
  };
}

// Nearest key in a coord table to a given lng/lat (simple squared-degree
// distance — fine for picking the nearest of a handful of well-separated
// regions/cities).
function nearest(lng: number, lat: number, table: Record<string, [number, number]>): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  Object.entries(table).forEach(([id, [clng, clat]]) => {
    const d = (clng - lng) ** 2 + (clat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  });
  return best;
}

const viewModeOf = (globalOut: boolean): "global" | "domestic" =>
  globalOut ? "global" : "domestic";

export function WorldMapbox() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const labelsRef = useRef<Record<string, mapboxgl.Marker>>({});
  const markersRef = useRef<Marker[]>([]);
  const rebuildMarkersRef = useRef<(() => void) | null>(null);
  const applyViewRef = useRef<(() => void) | null>(null);
  const travelersRef = useRef<
    { marker: mapboxgl.Marker; inner: HTMLElement; traveler: Traveler }[]
  >([]);
  const travelRaf = useRef<number | undefined>(undefined);
  const satLayerRef = useRef<HTMLDivElement | null>(null);
  const haloPulseRaf = useRef<number | undefined>(undefined);
  const programmaticRef = useRef(false);
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastCrossRef = useRef(0);
  const prevZoomRef = useRef(GLOBAL_VIEW.zoom);
  const styleReadyRef = useRef(false);

  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const zoomingIn = useAppStore((s) => s.zoomingIn);
  const globalOut = useAppStore((s) => s.globalOut);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const localCity = useAppStore((s) => s.localCity);
  const selectedId = useAppStore((s) => s.selectedId);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const listingType = useAppStore((s) => s.listingType);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const skillIndex = useAppStore((s) => s.skillIndex);
  const heatMonth = useAppStore((s) => s.heatMonth);

  // Mount once: create the map, add the hub source/layers, and wire clicks +
  // scroll-zoom layer crossing. All reads of live state happen through the
  // store (getState) since these callbacks are registered a single time.
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const map = new mapboxgl.Map({
      container,
      style: "mapbox://styles/mapbox/standard",
      projection: "globe",
      center: GLOBAL_VIEW.center,
      zoom: GLOBAL_VIEW.zoom,
      pitch: 0,
      attributionControl: false,
    });
    mapRef.current = map;

    // The map is an inset card whose size changes with the window AND at the
    // 680px breakpoint (where the frame's gutter is dropped for full-bleed).
    // mapbox-gl observes its own container, so this is belt-and-braces — but it
    // is cheap, and it also covers any future animated frame, where a CSS
    // transition changes the box without a window resize.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(map.getContainer());

    // A programmatic camera move that suppresses the scroll-crossing handler
    // until it settles. Cleared on moveend, with a timeout fallback so a no-op
    // flyTo (which may not emit moveend) can't leave the guard stuck on.
    const flyGuarded = (opts: Parameters<mapboxgl.Map["flyTo"]>[0] & { duration: number }) => {
      programmaticRef.current = true;
      // Also arm the cross cooldown: if the user's own scroll interrupts this
      // flyTo, moveend can fire early and clear programmaticRef while the map
      // is still mid-transition at a zoom that would otherwise trip a crossing.
      lastCrossRef.current = Date.now();
      clearTimeout(programmaticTimer.current);
      programmaticTimer.current = setTimeout(() => {
        programmaticRef.current = false;
      }, opts.duration + 250);
      map.flyTo({ ...opts, essential: true });
    };

    // Activating a marker: at the global layer the markers are COUNTRIES, so we
    // drop to that country's domestic layer (where the city breakdown lives);
    // on a domestic layer the markers are cities, so we fly into the city.
    const activateMarker = (id: string) => {
      const st = useAppStore.getState();
      if (id === EUROPE_CLUSTER_ID) {
        st.goDomestic("europe");
        return;
      }
      const country = COUNTRIES[id];
      if (country) st.goDomestic(country.region);
      else st.zoomInCity(id);
    };

    const renderLabels = (
      markers: Marker[],
      selectedId: string | null,
      demand: Record<string, number>,
    ) => {
      Object.values(labelsRef.current).forEach((m) => m.remove());
      labelsRef.current = {};
      // The global layer is countries, every domestic layer is cities — the two
      // marker shapes the design draws for exactly those two scales.
      const shape: MarkerShape =
        viewModeOf(useAppStore.getState().globalOut) === "global" ? "country" : "city";
      markers.forEach((m) => {
        const el = document.createElement("div");
        el.className = "mkpin";
        const body = buildMarker(shape, {
          name: m.label,
          // A country carries its ISO2 (the Europe cluster its own two letters);
          // a city carries its IATA city code.
          code: shape === "country" ? m.id.slice(0, 2).toUpperCase() : codeFor(m.id, m.label),
          // Set only while a skill is searched: how that skill's demand here has
          // moved over the trailing year at the slider's month.
          delta: typeof m.pct === "number" ? m.pct : null,
          // The vacancy count behind the colour — real job ads, so it is safe to
          // show as a figure. Absent when no skill is searched (there is no
          // single "demand" to count).
          count: demand[m.id] > 0 ? `${Math.round(demand[m.id]).toLocaleString()} ads` : null,
          selected: m.id === selectedId,
          faded: m.faded,
        });
        el.appendChild(body);
        if (m.clickable) {
          const swallow = (ev: Event) => ev.stopPropagation();
          el.addEventListener("mousedown", swallow);
          el.addEventListener("pointerdown", swallow);
          el.onclick = (ev) => {
            ev.stopPropagation();
            activateMarker(m.id);
          };
        } else {
          el.style.cursor = "default";
        }
        // anchor:'top' + the shape's foot offset puts the pin's point (or the
        // bottom of its stalk) on the coordinate, leaving the caption below it.
        const marker = new mapboxgl.Marker({
          element: el,
          anchor: "top",
          offset: [0, -MARKER_FOOT[shape]],
        })
          .setLngLat(m.coords)
          .addTo(map);
        labelsRef.current[m.id] = marker;
      });
    };

    // Update the heat dots + labels + skill blobs for the current view (no
    // camera move).
    const rebuildMarkers = () => {
      if (!styleReadyRef.current) return;
      const s = useAppStore.getState();
      if (!s.zoomedOut || s.zoomingIn) return; // overview not showing
      const mode = viewModeOf(s.globalOut);
      const skill = activeSkill(s.searchQuery);
      let cityDemand = demandByCity(s.skillIndex, skill);
      // Overlay the real Jobs & Skills Australia IVI vacancy demand (whole
      // labour market, with monthly history) on top of the company/Adzuna
      // counts. Applied on the AU domestic view and on the global view (where
      // the Australian hubs are the ones with an IVI time series); other
      // countries light up automatically once their equivalent series is added.
      if (
        skill &&
        (mode === "global" ||
          s.domesticRegion === "australia" ||
          s.domesticRegion === "northamerica" ||
          s.domesticRegion === "asia" ||
          s.domesticRegion === "europe")
      ) {
        const ivi = iviCityDemandAt(skill, s.heatMonth);
        cityDemand = { ...cityDemand };
        for (const [c, v] of Object.entries(ivi)) cityDemand[c] = (cityDemand[c] || 0) + v;
      }
      const fs: FilterState = {
        searchQuery: s.searchQuery,
        activeSectors: s.activeSectors,
        listingType: s.listingType,
        activeExchanges: s.activeExchanges,
        minSalary: s.minSalary,
        minHeadcount: s.minHeadcount,
        minGrowth: s.minGrowth,
        maxAttrition: s.maxAttrition,
      };
      // At the global layer everything is expressed per COUNTRY, so roll the
      // per-city demand up before colouring markers or sizing the heat blobs.
      const demandForView = mode === "global" ? countryDemand(cityDemand) : cityDemand;
      const markers = computeMarkers(
        mode,
        s.domesticRegion,
        fs,
        demandForView,
        !!skill,
        map.getZoom(),
      );
      // Scrub callouts: while a skill + the time slider are active, tag each
      // city with its demand % change at the current month, so the label shows
      // how demand for the skill is moving as the slider is dragged.
      if (
        skill &&
        (mode === "global" ||
          s.domesticRegion === "australia" ||
          s.domesticRegion === "northamerica" ||
          s.domesticRegion === "asia" ||
          s.domesticRegion === "europe")
      ) {
        const change = iviCityChangeAt(skill, s.heatMonth);
        if (mode === "global") {
          // Country-level momentum: demand-weighted mean of its cities' changes,
          // so a country's ▲/▼ reflects where its volume actually sits.
          const num: Record<string, number> = {};
          const den: Record<string, number> = {};
          for (const [city, pct] of Object.entries(change)) {
            const cc = CITY_COUNTRY[city] || (COUNTRIES[city] ? city : null);
            if (!cc) continue;
            const w = cityDemand[city] || 0;
            if (w <= 0) continue;
            num[cc] = (num[cc] || 0) + pct * w;
            den[cc] = (den[cc] || 0) + w;
          }
          for (const m of markers) if (den[m.id]) m.pct = num[m.id] / den[m.id];
        } else {
          for (const m of markers) if (m.id in change) m.pct = change[m.id];
        }
      }
      markersRef.current = markers;
      const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      src?.setData(markersGeoJSON(markers, s.selectedId));
      renderLabels(markers, s.selectedId, demandForView);

      // The dot halo now only appears WITH a skill search — a pulsing, demand-
      // coloured ring that (alongside the gradient) draws the eye to the standout
      // cities. With no skill searched the dots sit plain and static (no halo,
      // no pulse). The demand blobs show only while a skill is active.
      const skillSrc = map.getSource(SKILL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      skillSrc?.setData(buildSkillHeat(mode, s.domesticRegion, skill, demandForView));
      if (map.getLayer(HALO_LAYER)) {
        map.setLayoutProperty(HALO_LAYER, "visibility", skill ? "visible" : "none");
      }
    };
    rebuildMarkersRef.current = rebuildMarkers;

    // Full transition on a state change: rebuild markers AND move the camera.
    const applyView = () => {
      if (!styleReadyRef.current) return;
      const s = useAppStore.getState();

      // Mid fly-in to a local city: fly toward it and let PerthMapbox take over
      // underneath; don't touch the overview markers.
      if (s.zoomingIn) {
        const coords = HUB_LNGLAT[s.localCity] || AU_CITY_LNGLAT[s.localCity];
        // Fly further in than the scroll-crossing threshold so a scroll-driven
        // drill-in still reads as continued forward motion toward the city
        // before PerthMapbox's local view takes over.
        if (coords) flyGuarded({ center: coords, zoom: 9.5, duration: 620 });
        return;
      }
      // Fully in the local view: overview is hidden, nothing to do.
      if (!s.zoomedOut) return;

      rebuildMarkers();
      if (s.globalOut) {
        flyGuarded({ center: GLOBAL_VIEW.center, zoom: GLOBAL_VIEW.zoom, duration: 900 });
      } else {
        const frame = REGION_FRAMES[s.domesticRegion] || REGION_FRAMES.australia;
        flyGuarded({ center: frame.center, zoom: frame.zoom, duration: 900 });
      }
    };
    applyViewRef.current = applyView;

    map.on("style.load", () => {
      map.setConfigProperty("basemap", "lightPreset", "day");
      map.setConfigProperty("basemap", "theme", "faded");
      map.setConfigProperty("basemap", "showPointOfInterestLabels", false);
      map.setConfigProperty("basemap", "showTransitLabels", false);
      map.setConfigProperty("basemap", "showRoadLabels", false);
      map.setConfigProperty("basemap", "showLandmarkIcons", false);
      map.setConfigProperty("basemap", "showPlaceLabels", false);
      // State/province + country borders in a light grey: enough to read the
      // political map, but well behind the city dots and demand blobs, which
      // are what the view is actually about. Charcoal made the borders the
      // loudest thing on screen.
      map.setConfigProperty("basemap", "colorAdminBoundaries", "#b9bfc8");

      // Skill-demand heatmap, added first so it sits beneath the hub dots.
      map.addSource(SKILL_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: SKILL_LAYER,
        type: "heatmap",
        source: SKILL_SOURCE,
        paint: {
          "heatmap-weight": ["get", "w"],
          // Lower intensity so the (now wider) demand range spreads across the
          // whole colour ramp instead of clipping to red — this is what makes
          // the difference between hubs read clearly.
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.95, 4, 1.1, 6, 1.25],
          // Blobs grow with zoom so they stay continent-/region-scaled.
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 34, 3, 72, 5, 130, 7, 210],
          // Fade out as we approach the local-city hand-off zoom. Eased back off
          // full opacity so the basemap still reads through the blobs.
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 5, 0.76, 6.5, 0],
          // Green (low) -> lime -> amber -> red (high), matching the city-dot
          // ramp so a hub's dot and its blob agree.
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(21,157,103,0)",
            0.12,
            "rgba(21,157,103,0.42)",
            0.35,
            "rgba(120,190,60,0.55)",
            0.55,
            "rgba(245,166,35,0.68)",
            0.78,
            "rgba(224,82,74,0.8)",
            1,
            "rgba(214,54,46,0.88)",
          ],
        },
      });

      // The Australian rail corridor the freight consist runs on. Two layers:
      // the ballast bed, and a dashed line over it for sleepers. Both are added
      // before the hub dots so a city marker is never hidden behind track.
      map.addSource(RAIL_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: AU_RAIL_NETWORK.map((line) => ({
            type: "Feature" as const,
            properties: {},
            geometry: { type: "LineString" as const, coordinates: line },
          })),
        },
      });
      map.addLayer({
        id: RAIL_BED_LAYER,
        type: "line",
        source: RAIL_SOURCE,
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#b3aca6",
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.6, 5, 3.4],
          "line-opacity": 0.6,
        },
      });
      map.addLayer({
        id: RAIL_SLEEPER_LAYER,
        type: "line",
        source: RAIL_SOURCE,
        layout: { visibility: "none", "line-cap": "butt" },
        paint: {
          "line-color": "#ded7d1",
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2.6, 5, 5.4],
          // Short ticks across the bed rather than a continuous rail — at these
          // zooms individual sleepers are far below a pixel, so this reads as
          // "railway" by convention instead of pretending to be to scale.
          "line-dasharray": [0.22, 1.1],
          "line-opacity": 0.7,
        },
      });

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: HALO_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 22,
          "circle-color": ["get", "color"],
          "circle-blur": 1,
          "circle-opacity": ["case", ["get", "dim"], 0.1, 0.5],
        },
      });
      map.addLayer({
        id: CORE_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 5.5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["get", "dim"], 0.25, 0.95],
        },
      });

      [CORE_LAYER, HALO_LAYER].forEach((layer) => {
        map.on("mouseenter", layer, (e) => {
          // A no-demand marker is inert, so it must not advertise itself as
          // clickable either.
          if (e.features?.some((f) => f.properties?.faded)) return;
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
        });
      });

      // Click the nearest clickable marker within a generous radius -> drill in.
      const PICK_RADIUS = 34; // px
      map.on("click", (e) => {
        let best: Marker | null = null;
        let bestD = Infinity;
        markersRef.current.forEach((m) => {
          if (!m.clickable) return;
          const pt = map.project(m.coords);
          const d = (pt.x - e.point.x) ** 2 + (pt.y - e.point.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = m;
          }
        });
        if (best && bestD <= PICK_RADIUS * PICK_RADIUS) {
          activateMarker((best as Marker).id);
        }
      });

      // Build the animated air/sea traffic and start its loop. Flights are
      // resolved to a two-point path between their hubs; ships already carry
      // theirs, so from here both animate the same way.
      const travelers: Traveler[] = [
        ...PLANE_ROUTES.flatMap((r): Traveler[] => {
          const a = HUB_LNGLAT[r.from];
          const b = HUB_LNGLAT[r.to];
          if (!a || !b) return [];
          return [{ mode: "plane", path: [a, b], dur: r.dur, offset: r.offset }];
        }),
        ...SHIP_LANES.map((l): Traveler => ({
          mode: "ship",
          path: l.path,
          dur: l.dur,
          offset: l.offset,
        })),
        // The freight consist: a locomotive with two loaded wagons behind it.
        // Each vehicle is its own traveler on the same path, spaced by a small
        // offset in phase, which is what keeps the wagons coupled through the
        // curves — a rigid pixel offset would have them cut the corners.
        ...[0, 1, 2].map((i): Traveler => ({
          mode: "train",
          path: AU_RAIL_PATH,
          dur: 52000,
          offset: 0.12 - i * 0.006,
        })),
      ];
      let trainIndex = 0;
      travelers.forEach((traveler) => {
        const outer = document.createElement("div");
        outer.className = "traveler";
        const inner = document.createElement("span");
        inner.className = `travelericon traveler-${traveler.mode}`;
        if (traveler.mode === "plane") inner.innerHTML = PLANE_SVG;
        else if (traveler.mode === "ship") inner.innerHTML = SHIP_SVG;
        // First vehicle of the consist is the locomotive, the rest are wagons.
        else inner.innerHTML = trainIndex++ === 0 ? LOCO_SVG : WAGON_SVG;
        outer.appendChild(inner);
        const marker = new mapboxgl.Marker({ element: outer, anchor: "center" })
          .setLngLat(traveler.path[0])
          .addTo(map);
        travelersRef.current.push({ marker, inner, traveler });
      });

      // ── Satellites ──────────────────────────────────────────────────────
      // These are NOT map markers. A marker is pinned to a lat/lng on the
      // globe's surface, and a satellite has to ride outside its limb — there
      // is no coordinate for "above the horizon". So they live in a screen-
      // space overlay above the canvas and orbit the globe's projected centre.
      //
      // The globe's radius on screen follows from the projection: its
      // circumference is the world size, so radius = 512 * 2^zoom / 2π. That is
      // clamped to the container as well, because at the domestic zooms the
      // globe is far larger than the viewport and an unclamped orbit would
      // throw the satellites kilometres off-screen.
      const satLayer = document.createElement("div");
      satLayer.className = "satorbit";
      const satEls = SATELLITES.map(() => {
        const el = document.createElement("span");
        el.className = "satellite";
        el.innerHTML = SATELLITE_SVG;
        satLayer.appendChild(el);
        return el;
      });
      container.appendChild(satLayer);
      satLayerRef.current = satLayer;

      const animateSatellites = (now: number, show: boolean) => {
        if (!show) {
          satLayer.style.display = "none";
          return;
        }
        satLayer.style.display = "";
        const w = container.clientWidth;
        const h = container.clientHeight;
        const centre = map.project(map.getCenter());
        // The globe's true projected radius, deliberately NOT clamped to the
        // frame: it is what decides whether a satellite is still in space, and
        // clamping it would stop the globe ever growing past them.
        const globeR = (512 * Math.pow(2, map.getZoom())) / (2 * Math.PI);
        const t = now / 1000;
        SATELLITES.forEach((sat, i) => {
          const x = sat.x * w + Math.sin(t / sat.px) * sat.ax;
          const y = sat.y * h + Math.cos(t / sat.py) * sat.ay;
          // In space, or over the globe? A small margin keeps one from sitting
          // exactly on the limb, where it reads as stuck to the horizon.
          const inSpace = Math.hypot(x - centre.x, y - centre.y) > globeR * 1.04;
          const el = satEls[i];
          el.style.display = inSpace ? "" : "none";
          if (!inSpace) return;
          el.style.transform = `translate(${x}px, ${y}px) rotate(${(t / sat.spin) * 360}deg)`;
        });
      };

      const animateTravelers = () => {
        const now = performance.now();
        const s = useAppStore.getState();
        // Shown on both overviews (global + domestic); hidden only at the local
        // city layer, where WorldMapbox itself is hidden.
        const show = s.zoomedOut && !s.zoomingIn;
        // The freight consist belongs to one country's map, so it rides only on
        // the Australian domestic view — on the globe the corridor would be a
        // few pixels long, and on any other region it is off-screen anyway.
        const showTrain = show && !s.globalOut && s.domesticRegion === "australia";
        if (map.getLayer(RAIL_BED_LAYER)) {
          const railVis = showTrain ? "visible" : "none";
          map.setLayoutProperty(RAIL_BED_LAYER, "visibility", railVis);
          map.setLayoutProperty(RAIL_SLEEPER_LAYER, "visibility", railVis);
        }
        travelersRef.current.forEach(({ marker, inner, traveler }) => {
          const el = marker.getElement();
          if (!show || (traveler.mode === "train" && !showTrain)) {
            el.style.display = "none";
            return;
          }
          el.style.display = "";
          // Ping-pong 0->1->0 so each craft makes a round trip rather than
          // snapping back to the start. TRAVEL_SLOWDOWN stretches every route's
          // duration uniformly so the planes/ships drift more slowly.
          const phase = (now / (traveler.dur * TRAVEL_SLOWDOWN) + traveler.offset) % 2;
          const t = phase < 1 ? phase : 2 - phase;
          const { pos, bearing } = pointOnPath(traveler.path, t);
          marker.setLngLat(pos);
          // On the return leg the craft is travelling back down the path, so
          // the heading is the reverse of the segment's own direction.
          inner.style.transform = `rotate(${phase < 1 ? bearing : bearing + 180}deg)`;
        });
        // No layer gate: whether a satellite is visible is decided by whether
        // it is still out in space (see animateSatellites), which is what makes
        // them fade out on the way in and return on the way back out.
        animateSatellites(now, show);
        travelRaf.current = requestAnimationFrame(animateTravelers);
      };
      animateTravelers();

      // Halo pulse: while a skill search is active the demand-coloured rings
      // breathe (radius + opacity oscillate) so the heat standouts pull the eye;
      // when no skill is searched the halo layer is hidden and this is a no-op.
      const animateHalo = () => {
        if (map.getLayer(HALO_LAYER)) {
          const s = useAppStore.getState();
          const active = !!activeSkill(s.searchQuery) && s.zoomedOut && !s.zoomingIn;
          if (active) {
            const p = 0.5 - 0.5 * Math.cos(performance.now() / 620); // 0..1
            map.setPaintProperty(HALO_LAYER, "circle-radius", 17 + 13 * p);
            map.setPaintProperty(HALO_LAYER, "circle-opacity", [
              "case",
              ["get", "dim"],
              0.06 + 0.06 * p,
              0.28 + 0.28 * p,
            ]);
          }
        }
        haloPulseRaf.current = requestAnimationFrame(animateHalo);
      };
      animateHalo();

      styleReadyRef.current = true;
      applyView();
    });

    // Scroll-zoom layer crossing: zooming in/out past a threshold moves between
    // global, domestic and local, contextually to what's under the camera.
    // Crossings are DIRECTION-AWARE — a layer change only fires in the
    // direction the user is actually zooming (in -> deeper layer, out ->
    // shallower). Merely sitting above/below a threshold isn't enough. This is
    // what stops a zoom-OUT from local->domestic bouncing straight back into
    // local: when the domestic view first appears the map can still be at a
    // high zoom (mid fly-out to the region frame), which is >= the local
    // threshold, but since the user is zooming OUT (dz < 0) it won't re-cross.
    map.on("zoom", () => {
      const z = map.getZoom();
      const dz = z - prevZoomRef.current;
      // Expand / collapse the Europe cluster as the globe zoom crosses the
      // threshold (markers are otherwise only rebuilt on state changes).
      const wasClustered = prevZoomRef.current < EUROPE_CLUSTER_ZOOM;
      const nowClustered = z < EUROPE_CLUSTER_ZOOM;
      if (wasClustered !== nowClustered && useAppStore.getState().globalOut) {
        rebuildMarkersRef.current?.();
      }
      // Same for the North America view's second tier of US metros.
      const wasTier1 = prevZoomRef.current < US_TIER2_ZOOM;
      const nowTier1 = z < US_TIER2_ZOOM;
      if (wasTier1 !== nowTier1) {
        const st = useAppStore.getState();
        if (!st.globalOut && st.domesticRegion === "northamerica") {
          rebuildMarkersRef.current?.();
        }
      }
      prevZoomRef.current = z; // track direction even while guarded
      if (programmaticRef.current) return;
      if (Date.now() - lastCrossRef.current < 700) return;
      const s = useAppStore.getState();
      if (!s.zoomedOut || s.zoomingIn) return;
      const c = map.getCenter();
      if (s.globalOut) {
        if (dz > 0 && z >= CROSS_GLOBAL_TO_DOMESTIC) {
          // The global layer shows COUNTRIES, so scrolling in should land on the
          // domestic layer of whichever country you zoomed toward. Fall back to
          // the nearest region frame if no country is close.
          const cc = nearest(
            c.lng,
            c.lat,
            Object.fromEntries(Object.entries(COUNTRIES).map(([k, v]) => [k, v.center])),
          );
          const region =
            (cc && COUNTRIES[cc]?.region) ||
            nearest(
              c.lng,
              c.lat,
              Object.fromEntries(Object.entries(REGION_FRAMES).map(([r, f]) => [r, f.center])),
            ) ||
            "australia";
          lastCrossRef.current = Date.now();
          s.goDomestic(region);
        }
        return;
      }
      if (dz < 0 && z <= CROSS_DOMESTIC_TO_GLOBAL) {
        lastCrossRef.current = Date.now();
        s.setGlobalOut(true);
        applyViewRef.current?.();
      } else if (dz > 0 && z >= CROSS_DOMESTIC_TO_LOCAL) {
        const table: Record<string, [number, number]> = {};
        markersRef.current.forEach((m) => {
          if (m.clickable) table[m.id] = m.coords;
        });
        const city = nearest(c.lng, c.lat, table);
        if (city) {
          lastCrossRef.current = Date.now();
          s.zoomInCity(city);
        }
      }
    });

    return () => {
      clearTimeout(programmaticTimer.current);
      if (travelRaf.current) cancelAnimationFrame(travelRaf.current);
      if (haloPulseRaf.current) cancelAnimationFrame(haloPulseRaf.current);
      travelersRef.current.forEach(({ marker }) => marker.remove());
      travelersRef.current = [];
      satLayerRef.current?.remove();
      satLayerRef.current = null;
      Object.values(labelsRef.current).forEach((m) => m.remove());
      labelsRef.current = {};
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // React to any state change that alters which view/markers should show (this
  // is what moves the camera between global / domestic / local).
  useEffect(() => {
    applyViewRef.current?.();
  }, [zoomedOut, zoomingIn, globalOut, domesticRegion, localCity]);

  // Recolour / re-dim markers when the metric, selection or sector filter change
  // — markers only, no camera move (so toggling a metric doesn't snap the view).
  useEffect(() => {
    rebuildMarkersRef.current?.();
  }, [
    selectedId,
    activeSectors,
    listingType,
    activeExchanges,
    minSalary,
    minHeadcount,
    minGrowth,
    maxAttrition,
    searchQuery,
    skillIndex,
    heatMonth,
  ]);

  // Hide the whole overview once fully in a local city (PerthMapbox owns it).
  const hidden = !zoomedOut && !zoomingIn;
  return (
    <div className={`mount worldmount${hidden ? " worldmount-hidden" : ""}`} ref={containerRef} />
  );
}
