import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { useAppStore, cityMatchesFilters, type FilterState } from '../state/store';
import { computeGlobalHeat, type HeatMetric } from '../lib/heat';
import { GLOBAL_STATS, STATE_STATS, CITY_STATE } from '../data/geo';
import { activeSkill, demandByCity } from '../lib/skillHeat';
import {
  HUB_LNGLAT,
  AU_CITY_LNGLAT,
  CLICKABLE_CITIES,
  REGION_FRAMES,
  REGION_HUBS,
  GLOBAL_VIEW,
  cityLabel,
} from '../data/mapboxWorldGeo';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_ID = 'world-hubs';
const HALO_LAYER = 'hub-halo';
const CORE_LAYER = 'hub-core';
const SKILL_SOURCE = 'skill-heat';
const SKILL_LAYER = 'skill-heat';

// Neutral dot colour used while a skill search is active — the coloured metric
// heat is replaced by the skill-demand blobs, so the city dots go dark (as they
// do on the SVG layers), keeping the blobs the only colour on the map.
const NEUTRAL_DOT = 'rgb(42,42,46)';

// Decorative traffic on the globe: aircraft between city pairs and container
// ships between port hubs, each drifting back and forth along its route.
type TravelMode = 'plane' | 'ship';
interface TravelRoute { from: string; to: string; mode: TravelMode; dur: number; offset: number; }
const TRAVEL_ROUTES: TravelRoute[] = [
  { from: 'perth', to: 'singapore', mode: 'plane', dur: 24000, offset: 0.0 },
  { from: 'london', to: 'newyork', mode: 'plane', dur: 30000, offset: 0.35 },
  { from: 'tokyo', to: 'sydney', mode: 'plane', dur: 34000, offset: 0.2 },
  { from: 'dubai', to: 'johannesburg', mode: 'plane', dur: 27000, offset: 0.6 },
  { from: 'sanfrancisco', to: 'tokyo', mode: 'plane', dur: 36000, offset: 0.15 },
  { from: 'santiago', to: 'houston', mode: 'plane', dur: 32000, offset: 0.5 },
  { from: 'singapore', to: 'ganzhou', mode: 'ship', dur: 44000, offset: 0.3 },
  { from: 'perth', to: 'johannesburg', mode: 'ship', dur: 60000, offset: 0.5 },
  { from: 'houston', to: 'london', mode: 'ship', dur: 56000, offset: 0.15 },
  { from: 'hongkong', to: 'singapore', mode: 'ship', dur: 40000, offset: 0.7 },
];

// Detailed top-down icons (as a ship-tracking / flight-radar map would show
// them), pointing "north" (up) so a bearing rotation aims them along their
// heading — a metallic airliner and a container ship with a laden deck.
const PLANE_SVG =
  '<svg viewBox="0 0 28 28" width="21" height="21">' +
  '<defs><linearGradient id="plg" x1="0" y1="0" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#c7ccd3"/><stop offset="0.5" stop-color="#f6f8fa"/><stop offset="1" stop-color="#aeb3bb"/>' +
  '</linearGradient></defs>' +
  '<path fill="url(#plg)" stroke="#5c616b" stroke-width="0.5" stroke-linejoin="round" ' +
  'd="M14 2c1.1 0 1.7 1.3 1.7 3.2v5.9l9 5.2v2.4l-9-2.9v4.6l2.5 1.8v2l-4.2-1.2-4.2 1.2v-2l2.5-1.8v-4.6l-9 2.9v-2.4l9-5.2V5.2C12.3 3.3 12.9 2 14 2z"/>' +
  '<line x1="14" y1="6" x2="14" y2="21" stroke="#8b909a" stroke-width="0.5"/>' +
  '</svg>';
const SHIP_SVG =
  '<svg viewBox="0 0 18 44" width="8" height="20">' +
  '<defs><linearGradient id="shg" x1="0" y1="0" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#565b64"/><stop offset="0.5" stop-color="#727782"/><stop offset="1" stop-color="#3f434b"/>' +
  '</linearGradient></defs>' +
  // hull (pointed bow up, rounded stern)
  '<path d="M9 1 L14 9 L14 39 Q14 43 10.5 43 L7.5 43 Q4 43 4 39 L4 9 Z" fill="url(#shg)" stroke="#2b2e34" stroke-width="0.6"/>' +
  // hatch outline / deck edge
  '<path d="M6 11 L12 11 L12 34 L6 34 Z" fill="#33363d"/>' +
  // stacked containers (two columns, varied colours)
  '<g stroke="#26282d" stroke-width="0.25">' +
  '<rect x="6.2" y="11.4" width="2.6" height="2.4" fill="#c0562e"/><rect x="9.2" y="11.4" width="2.6" height="2.4" fill="#2e6fc0"/>' +
  '<rect x="6.2" y="14.2" width="2.6" height="2.4" fill="#2fa36a"/><rect x="9.2" y="14.2" width="2.6" height="2.4" fill="#c9a13a"/>' +
  '<rect x="6.2" y="17" width="2.6" height="2.4" fill="#2e6fc0"/><rect x="9.2" y="17" width="2.6" height="2.4" fill="#b23b3b"/>' +
  '<rect x="6.2" y="19.8" width="2.6" height="2.4" fill="#c9a13a"/><rect x="9.2" y="19.8" width="2.6" height="2.4" fill="#2fa36a"/>' +
  '<rect x="6.2" y="22.6" width="2.6" height="2.4" fill="#b23b3b"/><rect x="9.2" y="22.6" width="2.6" height="2.4" fill="#c0562e"/>' +
  '<rect x="6.2" y="25.4" width="2.6" height="2.4" fill="#2fa36a"/><rect x="9.2" y="25.4" width="2.6" height="2.4" fill="#2e6fc0"/>' +
  '<rect x="6.2" y="28.2" width="2.6" height="2.4" fill="#c9a13a"/><rect x="9.2" y="28.2" width="2.6" height="2.4" fill="#b23b3b"/>' +
  '<rect x="6.2" y="31" width="2.6" height="2.4" fill="#2e6fc0"/><rect x="9.2" y="31" width="2.6" height="2.4" fill="#2fa36a"/>' +
  '</g>' +
  // superstructure / bridge near the stern
  '<rect x="5.6" y="35.4" width="6.8" height="4" rx="0.6" fill="#e7e9ec" stroke="#9aa0a8" stroke-width="0.4"/>' +
  '<rect x="7" y="36.3" width="4" height="1.2" fill="#aeb4bd"/>' +
  '</svg>';

// Antimeridian-aware linear interpolation between two lng/lat points (takes the
// shorter way around, so e.g. a San Francisco -> Tokyo route crosses the
// Pacific rather than wrapping the long way round the globe).
function lerpLngLat(a: [number, number], b: [number, number], t: number): [number, number] {
  let dLng = b[0] - a[0];
  if (dLng > 180) dLng -= 360;
  else if (dLng < -180) dLng += 360;
  let lng = a[0] + dLng * t;
  if (lng > 180) lng -= 360;
  else if (lng < -180) lng += 360;
  return [lng, a[1] + (b[1] - a[1]) * t];
}

// Layer-crossing zoom thresholds (Mapbox zoom levels). Chosen to leave each
// view's own default framing comfortably inside its band so a programmatic
// flyTo never lands right on a boundary.
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
}

// Short "active metric" string shown under each city name in its pill.
function metricLabel(id: string, heat: HeatMetric, hub: boolean): string {
  const stat = hub ? GLOBAL_STATS[id] : STATE_STATS[CITY_STATE[id]];
  if (!stat) return '';
  if (heat === 'salary') return '$' + stat.salary + 'K';
  if (heat === 'growth') return (stat.growth >= 0 ? '+' : '') + stat.growth.toFixed(1) + '%';
  return stat.turnover.toFixed(1) + '%';
}

// Which markers to show for the current view. Normally coloured by the active
// metric; while a skill search is active the dots go neutral (the skill-demand
// blobs carry the colour instead) and the metric sub-label is dropped. Always
// filtered by the active sectors.
function computeMarkers(
  mode: 'global' | 'domestic',
  region: string,
  heat: HeatMetric,
  filterState: FilterState,
  skill: string | null,
): Marker[] {
  const globalHeat = computeGlobalHeat(heat);
  const out: Marker[] = [];
  const push = (id: string, coords: [number, number] | undefined, metricColor: string, hub: boolean) => {
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
      color: skill ? NEUTRAL_DOT : metricColor,
      label: cityLabel(id),
      sub: skill ? '' : metricLabel(id, heat, hub),
      clickable: CLICKABLE_CITIES.has(id),
    });
  };

  if (mode === 'global') {
    Object.keys(HUB_LNGLAT).forEach((id) =>
      push(id, HUB_LNGLAT[id], globalHeat[id]?.color || 'rgb(150,150,150)', true),
    );
    return out;
  }

  // Domestic: the region's own hubs (Melbourne is now a hub too, so it comes
  // through here on the AU view and on the global view; Darwin and Hobart stay
  // omitted).
  (REGION_HUBS[region] || []).forEach((id) =>
    push(id, HUB_LNGLAT[id], globalHeat[id]?.color || 'rgb(150,150,150)', true),
  );
  return out;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// Demand-weighted point cloud for the skill heatmap: a small deterministic
// cluster of points around each city, weighted by that city's relative demand
// for the searched skill (normalised across the visible set). Mapbox's heatmap
// layer turns this into the soft green→amber→red blobs, mirroring the SVG
// layers' skill "spikes".
function buildSkillHeat(
  mode: 'global' | 'domestic',
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
  if (mode === 'global') {
    table = HUB_LNGLAT;
  } else if (region === 'australia') {
    // Darwin and Hobart are omitted from the AU markers, so drop their skill
    // heat too — no stray blobs over their old spots.
    table = Object.fromEntries(
      Object.entries(AU_CITY_LNGLAT).filter(([id]) => id !== 'darwin' && id !== 'hobart'),
    );
  } else {
    table = {};
    (REGION_HUBS[region] || []).forEach((id) => { if (HUB_LNGLAT[id]) table[id] = HUB_LNGLAT[id]; });
  }
  const ids = Object.keys(table).filter((id) => (demand[id] || 0) > 0);
  if (!ids.length) return EMPTY_FC;
  const vals = ids.map((id) => demand[id]);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);

  let seed = 99;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const features: GeoJSON.Feature[] = [];
  ids.forEach((id) => {
    const t = (demand[id] - mn) / ((mx - mn) || 1);
    const w = 0.2 + 0.8 * t; // keep a green floor so low-demand hubs still show
    const [lng, lat] = table[id];
    for (let i = 0; i < 6; i++) {
      const jx = i === 0 ? 0 : (rnd() - 0.5) * 5.4;
      const jy = i === 0 ? 0 : (rnd() - 0.5) * 5.4;
      features.push({
        type: 'Feature',
        properties: { w },
        geometry: { type: 'Point', coordinates: [lng + jx, lat + jy] },
      });
    }
  });
  return { type: 'FeatureCollection', features };
}

function markersGeoJSON(markers: Marker[], selectedId: string | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.map((m, i) => ({
      type: 'Feature',
      id: i,
      properties: {
        id: m.id,
        color: m.color,
        dim: !!selectedId && selectedId !== m.id,
      },
      geometry: { type: 'Point', coordinates: m.coords },
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

const viewModeOf = (globalOut: boolean): 'global' | 'domestic' => (globalOut ? 'global' : 'domestic');

export function WorldMapbox() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const labelsRef = useRef<Record<string, mapboxgl.Marker>>({});
  const markersRef = useRef<Marker[]>([]);
  const rebuildMarkersRef = useRef<(() => void) | null>(null);
  const applyViewRef = useRef<(() => void) | null>(null);
  const sampleHeaderBgRef = useRef<(() => void) | null>(null);
  const travelersRef = useRef<{ marker: mapboxgl.Marker; inner: HTMLElement; route: TravelRoute }[]>([]);
  const travelRaf = useRef<number | undefined>(undefined);
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
  const heat = useAppStore((s) => s.heat);
  const selectedId = useAppStore((s) => s.selectedId);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const skillIndex = useAppStore((s) => s.skillIndex);

  // Mount once: create the map, add the hub source/layers, and wire clicks +
  // scroll-zoom layer crossing. All reads of live state happen through the
  // store (getState) since these callbacks are registered a single time.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      projection: 'globe',
      center: GLOBAL_VIEW.center,
      zoom: GLOBAL_VIEW.zoom,
      pitch: 0,
      attributionControl: false,
      // Needed so we can read a pixel back from the canvas to decide the search
      // header's colour (see sampleHeaderBg) — without it the WebGL drawing
      // buffer is cleared after compositing and readPixels returns zeros.
      preserveDrawingBuffer: true,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    mapRef.current = map;

    // Keep the "Explore the world of work today" header legible over the globe:
    // sample the map pixel directly behind it and flip .app.gshd-onlight when
    // that pixel is light, so the header reads dark over the light globe and
    // white over the dark space around it. (mix-blend-mode can't do this here —
    // the header sits in its own stacking context, so it never blends against
    // the map canvas.)
    let lastSample = 0;
    const sampleHeaderBg = () => {
      const s = useAppStore.getState();
      const appEl = containerRef.current?.closest('.app') as HTMLElement | null;
      if (!appEl) return;
      if (!(s.globalOut && s.zoomedOut) || s.zoomingIn) return;
      const hd = document.querySelector('.gsearchhd') as HTMLElement | null;
      if (!hd) return;
      const canvas = map.getCanvas();
      const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
      if (!gl) return;
      const cRect = canvas.getBoundingClientRect();
      const hRect = hd.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const x = Math.round((hRect.left + hRect.width / 2 - cRect.left) * dpr);
      const yTop = Math.round((hRect.top + hRect.height / 2 - cRect.top) * dpr);
      const y = gl.drawingBufferHeight - yTop; // WebGL y-origin is bottom-left
      if (x < 0 || y < 0 || x >= gl.drawingBufferWidth || y >= gl.drawingBufferHeight) return;
      const px = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
      appEl.classList.toggle('gshd-onlight', lum > 140);
    };
    sampleHeaderBgRef.current = sampleHeaderBg;
    map.on('render', () => {
      const now = performance.now();
      if (now - lastSample < 120) return; // throttle — 1px read, but cheap-guard
      lastSample = now;
      sampleHeaderBg();
    });

    // A programmatic camera move that suppresses the scroll-crossing handler
    // until it settles. Cleared on moveend, with a timeout fallback so a no-op
    // flyTo (which may not emit moveend) can't leave the guard stuck on.
    const flyGuarded = (opts: Parameters<mapboxgl.Map['flyTo']>[0] & { duration: number }) => {
      programmaticRef.current = true;
      // Also arm the cross cooldown: if the user's own scroll interrupts this
      // flyTo, moveend can fire early and clear programmaticRef while the map
      // is still mid-transition at a zoom that would otherwise trip a crossing.
      lastCrossRef.current = Date.now();
      clearTimeout(programmaticTimer.current);
      programmaticTimer.current = setTimeout(() => { programmaticRef.current = false; }, opts.duration + 250);
      map.flyTo({ ...opts, essential: true });
    };

    const renderLabels = (markers: Marker[]) => {
      Object.values(labelsRef.current).forEach((m) => m.remove());
      labelsRef.current = {};
      markers.forEach((m) => {
        const el = document.createElement('button');
        el.className = 'mbchip';
        el.innerHTML = `<span class="chipdot"></span><span class="chiptk"></span><span class="chipsub"></span>`;
        (el.querySelector('.chiptk') as HTMLElement).textContent = m.label;
        (el.querySelector('.chipsub') as HTMLElement).textContent = m.sub;
        (el.querySelector('.chipdot') as HTMLElement).style.background = m.color;
        if (m.clickable) {
          const swallow = (ev: Event) => ev.stopPropagation();
          el.addEventListener('mousedown', swallow);
          el.addEventListener('pointerdown', swallow);
          el.onclick = (ev) => {
            ev.stopPropagation();
            useAppStore.getState().zoomInCity(m.id);
          };
        } else {
          el.style.cursor = 'default';
        }
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom', offset: [0, -8] })
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
      const cityDemand = demandByCity(s.skillIndex, skill);
      const fs: FilterState = {
        searchQuery: s.searchQuery,
        activeSectors: s.activeSectors,
        activeExchanges: s.activeExchanges,
        minSalary: s.minSalary,
        minHeadcount: s.minHeadcount,
        minGrowth: s.minGrowth,
        maxAttrition: s.maxAttrition,
      };
      const markers = computeMarkers(mode, s.domesticRegion, s.heat, fs, skill);
      markersRef.current = markers;
      const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      src?.setData(markersGeoJSON(markers, s.selectedId));
      renderLabels(markers);

      // Skill search active -> show the demand blobs and hide the metric halo
      // (the dots are already neutralised in computeMarkers); otherwise clear
      // the blobs and restore the metric halo.
      const skillSrc = map.getSource(SKILL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      skillSrc?.setData(buildSkillHeat(mode, s.domesticRegion, skill, cityDemand));
      if (map.getLayer(HALO_LAYER)) {
        map.setLayoutProperty(HALO_LAYER, 'visibility', skill ? 'none' : 'visible');
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

    map.on('style.load', () => {
      map.setConfigProperty('basemap', 'lightPreset', 'day');
      map.setConfigProperty('basemap', 'theme', 'monochrome');
      map.setConfigProperty('basemap', 'showPointOfInterestLabels', false);
      map.setConfigProperty('basemap', 'showTransitLabels', false);
      map.setConfigProperty('basemap', 'showRoadLabels', false);
      map.setConfigProperty('basemap', 'showLandmarkIcons', false);
      map.setConfigProperty('basemap', 'showPlaceLabels', false);

      // Skill-demand heatmap, added first so it sits beneath the hub dots.
      map.addSource(SKILL_SOURCE, { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: SKILL_LAYER,
        type: 'heatmap',
        source: SKILL_SOURCE,
        paint: {
          'heatmap-weight': ['get', 'w'],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 1, 0.9, 4, 1.1, 6, 1.25],
          // Blobs grow with zoom so they stay continent-/region-scaled.
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 30, 3, 64, 5, 120, 7, 200],
          // Fade out as we approach the local-city hand-off zoom.
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.78, 5, 0.72, 6.5, 0],
          // Green (low demand) -> amber -> red (high), matching the app ramp.
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(21,157,103,0)',
            0.18, 'rgba(21,157,103,0.35)',
            0.45, 'rgba(245,166,35,0.45)',
            0.72, 'rgba(224,82,74,0.55)',
            1, 'rgba(224,82,74,0.62)',
          ],
        },
      });

      map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: HALO_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': 22,
          'circle-color': ['get', 'color'],
          'circle-blur': 1,
          'circle-opacity': ['case', ['get', 'dim'], 0.1, 0.5],
        },
      });
      map.addLayer({
        id: CORE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': 5.5,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': ['case', ['get', 'dim'], 0.25, 0.95],
        },
      });

      [CORE_LAYER, HALO_LAYER].forEach((layer) => {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      });

      // Click the nearest clickable marker within a generous radius -> drill in.
      const PICK_RADIUS = 34; // px
      map.on('click', (e) => {
        let best: Marker | null = null;
        let bestD = Infinity;
        markersRef.current.forEach((m) => {
          if (!m.clickable) return;
          const pt = map.project(m.coords);
          const d = (pt.x - e.point.x) ** 2 + (pt.y - e.point.y) ** 2;
          if (d < bestD) { bestD = d; best = m; }
        });
        if (best && bestD <= PICK_RADIUS * PICK_RADIUS) {
          useAppStore.getState().zoomInCity((best as Marker).id);
        }
      });

      // Build the animated air/sea traffic and start its loop.
      TRAVEL_ROUTES.forEach((route) => {
        const a = HUB_LNGLAT[route.from];
        const b = HUB_LNGLAT[route.to];
        if (!a || !b) return;
        const outer = document.createElement('div');
        outer.className = 'traveler';
        const inner = document.createElement('span');
        inner.className = `travelericon traveler-${route.mode}`;
        inner.innerHTML = route.mode === 'plane' ? PLANE_SVG : SHIP_SVG;
        outer.appendChild(inner);
        const marker = new mapboxgl.Marker({ element: outer, anchor: 'center' }).setLngLat(a).addTo(map);
        travelersRef.current.push({ marker, inner, route });
      });

      const animateTravelers = () => {
        const now = performance.now();
        const s = useAppStore.getState();
        // Shown on both overviews (global + domestic); hidden only at the local
        // city layer, where WorldMapbox itself is hidden.
        const show = s.zoomedOut && !s.zoomingIn;
        travelersRef.current.forEach(({ marker, inner, route }) => {
          const el = marker.getElement();
          if (!show) { el.style.display = 'none'; return; }
          el.style.display = '';
          const a = HUB_LNGLAT[route.from];
          const b = HUB_LNGLAT[route.to];
          // Ping-pong 0->1->0 so each craft makes a round trip rather than
          // snapping back to the start.
          const phase = ((now / route.dur) + route.offset) % 2;
          const t = phase < 1 ? phase : 2 - phase;
          const eased = t; // linear is fine at this scale
          const pos = lerpLngLat(a, b, eased);
          marker.setLngLat(pos);
          // Point the icon along its current heading (bearing on screen).
          const ahead = lerpLngLat(a, b, Math.min(1, Math.max(0, eased + (phase < 1 ? 0.01 : -0.01))));
          const dx = ahead[0] - pos[0];
          const dy = ahead[1] - pos[1];
          const bearing = (Math.atan2(dx * Math.cos((pos[1] * Math.PI) / 180), dy) * 180) / Math.PI;
          inner.style.transform = `rotate(${bearing}deg)`;
        });
        travelRaf.current = requestAnimationFrame(animateTravelers);
      };
      animateTravelers();

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
    map.on('zoom', () => {
      const z = map.getZoom();
      const dz = z - prevZoomRef.current;
      prevZoomRef.current = z; // track direction even while guarded
      if (programmaticRef.current) return;
      if (Date.now() - lastCrossRef.current < 700) return;
      const s = useAppStore.getState();
      if (!s.zoomedOut || s.zoomingIn) return;
      const c = map.getCenter();
      if (s.globalOut) {
        if (dz > 0 && z >= CROSS_GLOBAL_TO_DOMESTIC) {
          const region =
            nearest(c.lng, c.lat, Object.fromEntries(Object.entries(REGION_FRAMES).map(([r, f]) => [r, f.center]))) ||
            'australia';
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
        markersRef.current.forEach((m) => { if (m.clickable) table[m.id] = m.coords; });
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
      travelersRef.current.forEach(({ marker }) => marker.remove());
      travelersRef.current = [];
      Object.values(labelsRef.current).forEach((m) => m.remove());
      labelsRef.current = {};
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to any state change that alters which view/markers should show (this
  // is what moves the camera between global / domestic / local).
  useEffect(() => {
    applyViewRef.current?.();
    const onGlobal = globalOut && zoomedOut && !zoomingIn;
    if (onGlobal) {
      sampleHeaderBgRef.current?.();
    } else {
      // Leaving the global view — clear the header-contrast flag so it doesn't
      // linger into a view where the header isn't shown.
      containerRef.current?.closest('.app')?.classList.remove('gshd-onlight');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomedOut, zoomingIn, globalOut, domesticRegion, localCity]);

  // Recolour / re-dim markers when the metric, selection or sector filter change
  // — markers only, no camera move (so toggling a metric doesn't snap the view).
  useEffect(() => {
    rebuildMarkersRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heat, selectedId, activeSectors, activeExchanges, minSalary, minHeadcount, minGrowth, maxAttrition, searchQuery, skillIndex]);

  // Hide the whole overview once fully in a local city (PerthMapbox owns it).
  const hidden = !zoomedOut && !zoomingIn;
  return <div className={`mount worldmount${hidden ? ' worldmount-hidden' : ''}`} ref={containerRef} />;
}
