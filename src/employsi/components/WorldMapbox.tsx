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

// Which markers to show for the current view, coloured by the active metric and
// filtered by the active sectors.
function computeMarkers(
  mode: 'global' | 'domestic',
  region: string,
  heat: HeatMetric,
  activeSectors: string[],
): Marker[] {
  const globalHeat = computeGlobalHeat(heat);
  const cityHeat = computeCityHeat(heat);
  const out: Marker[] = [];

  if (mode === 'global') {
    Object.keys(HUB_LNGLAT).forEach((id) => {
      if (!cityMatchesSectors(id, activeSectors)) return;
      out.push({
        id,
        coords: HUB_LNGLAT[id],
        color: globalHeat[id]?.color || 'rgb(150,150,150)',
        label: cityLabel(id),
        sub: metricLabel(id, heat, true),
        clickable: CLICKABLE_CITIES.has(id),
      });
    });
    return out;
  }

  // Domestic: the region's own hubs, plus (Australia only) its non-hub cities.
  (REGION_HUBS[region] || []).forEach((id) => {
    if (!cityMatchesSectors(id, activeSectors)) return;
    out.push({
      id,
      coords: HUB_LNGLAT[id],
      color: globalHeat[id]?.color || 'rgb(150,150,150)',
      label: cityLabel(id),
      sub: metricLabel(id, heat, true),
      clickable: CLICKABLE_CITIES.has(id),
    });
  });
  if (region === 'australia') {
    ['darwin', 'melbourne', 'hobart'].forEach((id) => {
      if (!cityMatchesSectors(id, activeSectors)) return;
      out.push({
        id,
        coords: AU_CITY_LNGLAT[id],
        color: cityHeat[id]?.color || 'rgb(150,150,150)',
        label: cityLabel(id),
        sub: metricLabel(id, heat, false),
        clickable: CLICKABLE_CITIES.has(id), // false for these three
      });
    });
  }
  return out;
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

    // Update just the heat dots + labels for the current view (no camera move).
    const rebuildMarkers = () => {
      if (!styleReadyRef.current) return;
      const s = useAppStore.getState();
      if (!s.zoomedOut || s.zoomingIn) return; // overview not showing
      const markers = computeMarkers(viewModeOf(s.globalOut), s.domesticRegion, s.heat, s.activeSectors);
      markersRef.current = markers;
      const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      src?.setData(markersGeoJSON(markers, s.selectedId));
      renderLabels(markers);
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
  }, [heat, selectedId, activeSectors]);

  // Hide the whole overview once fully in a local city (PerthMapbox owns it).
  const hidden = !zoomedOut && !zoomingIn;
  return <div className={`mount worldmount${hidden ? ' worldmount-hidden' : ''}`} ref={containerRef} />;
}
