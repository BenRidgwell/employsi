// Real-world lng/lat for the global-hub and domestic-city markers, used by the
// Mapbox-based global + domestic layers (WorldMapbox) in the Mapbox trial. The
// SVG layers (GlobeMap / AustraliaMap / RegionMap) use illustrative viewBox
// coordinates instead; this file is the real-geo equivalent for the trial.
import { CITY_VIEWS } from './mapboxGeo';
import { CITY_CONTINENT, CITY_LABEL, GLOBAL_HUB_LABEL } from './geo';

// Every global hub already has real head-office coordinates in CITY_VIEWS
// (they double as the local 3D-city camera centres), so the hub lng/lat is
// just each city's CITY_VIEWS centre — no separate geocoding needed.
export const HUB_LNGLAT: Record<string, [number, number]> = Object.fromEntries(
  Object.keys(GLOBAL_HUB_LABEL).map((id) => [id, CITY_VIEWS[id].center]),
);

// AU domestic cities. Perth/Adelaide/Brisbane/Sydney are also global hubs (and
// clickable through to their local 3D view); Darwin/Melbourne/Hobart are
// domestic-only heat markers with no local view, so they're shown but not
// clickable (there's no CITY_VIEWS entry to fly into for them).
export const AU_CITY_LNGLAT: Record<string, [number, number]> = {
  perth: CITY_VIEWS.perth.center,
  adelaide: CITY_VIEWS.adelaide.center,
  brisbane: CITY_VIEWS.brisbane.center,
  sydney: CITY_VIEWS.sydney.center,
  darwin: [130.8456, -12.4634],
  melbourne: [144.9631, -37.8136],
  hobart: [147.3272, -42.8821],
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
  australia: { center: [134, -27], zoom: 2.85 },
  asia: { center: [104, 24], zoom: 2.3 },
  northamerica: { center: [-96, 41], zoom: 2.6 },
  europe: { center: [7, 48], zoom: 3.6 },
  africa: { center: [26, -14], zoom: 3.0 },
};

// Which hubs belong to each domestic region (reverse of CITY_CONTINENT), so a
// region view can show just its own hubs.
export const REGION_HUBS: Record<string, string[]> = Object.entries(
  CITY_CONTINENT,
).reduce<Record<string, string[]>>((acc, [hub, region]) => {
  (acc[region] ||= []).push(hub);
  return acc;
}, {});

// Display label for any hub or domestic-only city id.
export function cityLabel(id: string): string {
  return GLOBAL_HUB_LABEL[id] || CITY_LABEL[id] || id;
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
