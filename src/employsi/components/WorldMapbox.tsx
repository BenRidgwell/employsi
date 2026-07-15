import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';
import { useAppStore } from '../state/store';
import { computeGlobalHeat, computeCityHeat, type HeatMetric } from '../lib/heat';
import {
  GLOBAL_STATS,
  STATE_STATS,
  CITY_STATE,
  cityMatchesSectors,
  activeSkillKey,
  SKILL_DEMAND,
  GLOBAL_SKILL_DEMAND,
} from '../data/geo';
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

// Layer-crossing zoom thresholds (Mapbox zoom levels). Chosen to leave each
// view's own default framing comfortably inside its band so a programmatic
// flyTo never lands right on a boundary.
const CROSS_GLOBAL_TO_DOMESTIC = 2.9; // zoom in past this on the globe -> region
const CROSS_DOMESTIC_TO_GLOBAL = 1.9; // zoom out past this in a region -> globe
const CROSS_DOMESTIC_TO_LOCAL = 5.4; // zoom in past this in a region -> city

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
  activeSectors: string[],
  skill: string | null,
): Marker[] {
  const globalHeat = computeGlobalHeat(heat);
  const cityHeat = computeCityHeat(heat);
  const out: Marker[] = [];
  const push = (id: string, coords: [number, number], metricColor: string, hub: boolean) => {
    if (!cityMatchesSectors(id, activeSectors)) return;
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

  // Domestic: the region's own hubs, plus (Australia only) its non-hub cities.
  (REGION_HUBS[region] || []).forEach((id) =>
    push(id, HUB_LNGLAT[id], globalHeat[id]?.color || 'rgb(150,150,150)', true),
  );
  if (region === 'australia') {
    ['darwin', 'melbourne', 'hobart'].forEach((id) =>
      push(id, AU_CITY_LNGLAT[id], cityHeat[id]?.color || 'rgb(150,150,150)', false),
    );
  }
  return out;
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

// Demand-weighted point cloud for the skill heatmap: a small deterministic
// cluster of points around each city, weighted by that city's relative demand
// for the searched skill (normalised across the visible set). Mapbox's heatmap
// layer turns this into the soft green→amber→red blobs, mirroring the SVG
// layers' skill "spikes".
function buildSkillHeat(mode: 'global' | 'domestic', region: string, skill: string | null): GeoJSON.FeatureCollection {
  if (!skill) return EMPTY_FC;
  let table: Record<string, [number, number]>;
  let demand: Record<string, number> | undefined;
  if (mode === 'global') {
    table = HUB_LNGLAT;
    demand = GLOBAL_SKILL_DEMAND[skill];
  } else if (region === 'australia') {
    table = AU_CITY_LNGLAT;
    demand = SKILL_DEMAND[skill];
  } else {
    demand = GLOBAL_SKILL_DEMAND[skill];
    table = {};
    (REGION_HUBS[region] || []).forEach((id) => { if (HUB_LNGLAT[id]) table[id] = HUB_LNGLAT[id]; });
  }
  if (!demand) return EMPTY_FC;
  const ids = Object.keys(table).filter((id) => demand![id] != null);
  if (!ids.length) return EMPTY_FC;
  const vals = ids.map((id) => demand![id]);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);

  let seed = 99;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const features: GeoJSON.Feature[] = [];
  ids.forEach((id) => {
    const t = (demand![id] - mn) / ((mx - mn) || 1);
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
  const programmaticRef = useRef(false);
  const programmaticTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastCrossRef = useRef(0);
  const styleReadyRef = useRef(false);

  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const zoomingIn = useAppStore((s) => s.zoomingIn);
  const globalOut = useAppStore((s) => s.globalOut);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const localCity = useAppStore((s) => s.localCity);
  const heat = useAppStore((s) => s.heat);
  const selectedId = useAppStore((s) => s.selectedId);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const searchQuery = useAppStore((s) => s.searchQuery);

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
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    mapRef.current = map;

    // A programmatic camera move that suppresses the scroll-crossing handler
    // until it settles. Cleared on moveend, with a timeout fallback so a no-op
    // flyTo (which may not emit moveend) can't leave the guard stuck on.
    const flyGuarded = (opts: Parameters<mapboxgl.Map['flyTo']>[0] & { duration: number }) => {
      programmaticRef.current = true;
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
      const skill = activeSkillKey(s.searchQuery);
      const markers = computeMarkers(mode, s.domesticRegion, s.heat, s.activeSectors, skill);
      markersRef.current = markers;
      const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      src?.setData(markersGeoJSON(markers, s.selectedId));
      renderLabels(markers);

      // Skill search active -> show the demand blobs and hide the metric halo
      // (the dots are already neutralised in computeMarkers); otherwise clear
      // the blobs and restore the metric halo.
      const skillSrc = map.getSource(SKILL_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      skillSrc?.setData(buildSkillHeat(mode, s.domesticRegion, skill));
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
        if (coords) flyGuarded({ center: coords, zoom: 7.5, duration: 620 });
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

      styleReadyRef.current = true;
      applyView();
    });

    // Scroll-zoom layer crossing: zooming in/out past a threshold moves between
    // global, domestic and local, contextually to what's under the camera.
    map.on('zoom', () => {
      if (programmaticRef.current) return;
      if (Date.now() - lastCrossRef.current < 700) return;
      const s = useAppStore.getState();
      if (!s.zoomedOut || s.zoomingIn) return;
      const z = map.getZoom();
      const c = map.getCenter();
      if (s.globalOut) {
        if (z >= CROSS_GLOBAL_TO_DOMESTIC) {
          const region =
            nearest(c.lng, c.lat, Object.fromEntries(Object.entries(REGION_FRAMES).map(([r, f]) => [r, f.center]))) ||
            'australia';
          lastCrossRef.current = Date.now();
          s.goDomestic(region);
        }
        return;
      }
      if (z <= CROSS_DOMESTIC_TO_GLOBAL) {
        lastCrossRef.current = Date.now();
        s.setGlobalOut(true);
        applyViewRef.current?.();
      } else if (z >= CROSS_DOMESTIC_TO_LOCAL) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomedOut, zoomingIn, globalOut, domesticRegion, localCity]);

  // Recolour / re-dim markers when the metric, selection or sector filter change
  // — markers only, no camera move (so toggling a metric doesn't snap the view).
  useEffect(() => {
    rebuildMarkersRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heat, selectedId, activeSectors, searchQuery]);

  // Hide the whole overview once fully in a local city (PerthMapbox owns it).
  const hidden = !zoomedOut && !zoomingIn;
  return <div className={`mount worldmount${hidden ? ' worldmount-hidden' : ''}`} ref={containerRef} />;
}
