import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef } from 'react';
import { useAppStore, companyMatches, type FilterState } from '../state/store';
import { COMPANIES } from '../data/companies';
import { COMPANY_COORDS, CITY_VIEWS, PERTH_CENTER, PERTH_DEFAULT_ZOOM, PERTH_DEFAULT_PITCH, PERTH_DEFAULT_BEARING } from '../data/mapboxGeo';
import { chipMetric, type HeatMetric } from '../lib/heat';
import { heatColor, rgbCss } from '../lib/color';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_ID = 'companies';
const HALO_LAYER = 'company-halo';
const CORE_LAYER = 'company-core';
const PULSE_LAYER = 'company-pulse';
const LABEL_LAYER = 'company-label';
const PULSE_MS = 2200;
const ZOOM_OUT_THRESHOLD = 11;

function metricKeyFor(heat: HeatMetric) {
  return heat === 'salary' ? 'salaryNum' : heat === 'growth' ? 'growth' : 'turnover';
}

function buildGeoJSON(heat: HeatMetric, selectedId: string | null, filterState: FilterState): GeoJSON.FeatureCollection {
  const key = metricKeyFor(heat);
  const vals = COMPANIES.map((c) => c[key] as number);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  return {
    type: 'FeatureCollection',
    features: COMPANIES.map((c, i) => {
      const t = ((c[key] as number) - mn) / ((mx - mn) || 1);
      const color = rgbCss(heatColor(t));
      return {
        type: 'Feature',
        id: i,
        properties: {
          id: c.id,
          color,
          label: c.ticker,
          sub: chipMetric(c, heat),
          selected: c.id === selectedId,
          dim: !companyMatches(c, filterState),
        },
        geometry: { type: 'Point', coordinates: COMPANY_COORDS[c.id] },
      };
    }),
  };
}

export function PerthMapbox() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const crossedRef = useRef(false);
  const interactedLocalRef = useRef(false);
  const autoRotateRaf = useRef<number | undefined>(undefined);
  const pulseRaf = useRef<number | undefined>(undefined);
  const focusUpdaterRef = useRef<(() => void) | null>(null);

  const selectedId = useAppStore((s) => s.selectedId);
  const heat = useAppStore((s) => s.heat);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);

  const filterState: FilterState = useMemo(
    () => ({ searchQuery, activeSectors, minSalary, minHeadcount, minGrowth, maxAttrition }),
    [searchQuery, activeSectors, minSalary, minHeadcount, minGrowth, maxAttrition],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      center: PERTH_CENTER,
      zoom: PERTH_DEFAULT_ZOOM,
      pitch: PERTH_DEFAULT_PITCH,
      bearing: PERTH_DEFAULT_BEARING,
      antialias: true,
      // Replace the default expanded attribution with a compact "ⓘ" control.
      // The credit stays (required by Mapbox ToS + OpenStreetMap's ODbL), just
      // collapsed out of the way.
      attributionControl: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    mapRef.current = map;

    const stopAutoRotate = () => {
      if (autoRotateRaf.current) cancelAnimationFrame(autoRotateRaf.current);
      if (!interactedLocalRef.current) {
        interactedLocalRef.current = true;
        useAppStore.getState().setInteracted();
      }
    };
    (['dragstart', 'zoomstart', 'rotatestart', 'pitchstart', 'wheel'] as const).forEach((evt) => map.on(evt, stopAutoRotate));

    map.on('style.load', () => {
      map.setConfigProperty('basemap', 'lightPreset', 'day');
      // Monochrome basemap theme, and strip label/POI clutter so the company
      // pins are the only points of interest on the map.
      map.setConfigProperty('basemap', 'theme', 'monochrome');
      map.setConfigProperty('basemap', 'showPointOfInterestLabels', false);
      map.setConfigProperty('basemap', 'showTransitLabels', false);
      map.setConfigProperty('basemap', 'showRoadLabels', false);
      map.setConfigProperty('basemap', 'showLandmarkIcons', false);

      const st = useAppStore.getState();
      map.addSource(SOURCE_ID, { type: 'geojson', data: buildGeoJSON(st.heat, st.selectedId, filterState) });

      map.addLayer({
        id: HALO_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 34, 26],
          'circle-color': ['get', 'color'],
          'circle-blur': 1,
          'circle-opacity': ['case', ['get', 'dim'], 0.1, 0.55],
        },
      });
      map.addLayer({
        id: CORE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 9, 6],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': ['case', ['get', 'dim'], 0.25, 0.95],
        },
      });
      // Animated pulse ring emanating from each heat dot (radius + opacity
      // driven each frame in the rAF loop below).
      map.addLayer({
        id: PULSE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 12, 9],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 0.5,
        },
      });

      // Company labels as a native symbol layer, so each label is glued to its
      // own point (ticker above, metric below), with a white halo for legibility.
      map.addLayer({
        id: LABEL_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'text-field': ['format', ['get', 'label'], { 'font-scale': 1.05 }, '\n', {}, ['get', 'sub'], { 'font-scale': 0.72 }],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
          'text-size': 13,
          'text-anchor': 'bottom',
          'text-offset': [0, -1.1],
          'text-line-height': 1.3,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#1c1c1e',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.8,
          'text-halo-blur': 0.3,
          'text-opacity': ['*', ['coalesce', ['feature-state', 'reveal'], 0], ['case', ['get', 'dim'], 0.32, 1]],
        },
      });

      // Clicking a heat dot or its label opens the company panel.
      const onDotClick = (e: mapboxgl.MapLayerMouseEvent) => {
        const f = e.features && e.features[0];
        if (f?.properties) useAppStore.getState().select(f.properties.id as string);
      };
      [CORE_LAYER, HALO_LAYER, LABEL_LAYER].forEach((layer) => {
        map.on('click', layer, onDotClick);
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      });

      // Focus reveal: a label only shows once you've panned onto its building
      // and zoomed in (ground distance from centre + zoom gate). Driven per
      // feature through feature-state so the native symbol fades in/out.
      const R_FULL = 250; // metres from centre: within this -> fully shown
      const R_GONE = 450; // metres from centre: beyond this -> hidden
      const Z_MIN = 14.2; // below this zoom -> labels hidden
      const Z_FULL = 15.0; // at/above this zoom -> labels at full strength
      const distMetres = (aLng: number, aLat: number, bLng: number, bLat: number) => {
        const R = 6371000;
        const toR = Math.PI / 180;
        const dLat = (bLat - aLat) * toR;
        const dLng = (bLng - aLng) * toR;
        const h =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
      };
      const updateFocus = () => {
        const c = map.getCenter();
        const z = map.getZoom();
        const zf = z <= Z_MIN ? 0 : z >= Z_FULL ? 1 : (z - Z_MIN) / (Z_FULL - Z_MIN);
        COMPANIES.forEach((company, i) => {
          const [lng, lat] = COMPANY_COORDS[company.id];
          const d = distMetres(c.lng, c.lat, lng, lat);
          const df = d <= R_FULL ? 1 : d >= R_GONE ? 0 : (R_GONE - d) / (R_GONE - R_FULL);
          map.setFeatureState({ source: SOURCE_ID, id: i }, { reveal: df * zf });
        });
      };
      map.on('move', updateFocus);
      focusUpdaterRef.current = updateFocus;
      updateFocus();

      const loop = () => {
        if (!interactedLocalRef.current) {
          map.setBearing(map.getBearing() + 0.025);
        }
        autoRotateRaf.current = requestAnimationFrame(loop);
      };
      loop();

      // Dedicated pulse loop — independent of the auto-rotate loop, which gets
      // cancelled on the first map interaction. This keeps the heat-dot rings
      // pulsing even after you click a dot / pan / zoom.
      const pulseLoop = () => {
        if (map.getLayer(PULSE_LAYER)) {
          const t = (performance.now() % PULSE_MS) / PULSE_MS; // 0 -> 1
          map.setPaintProperty(PULSE_LAYER, 'circle-radius', [
            '+',
            ['case', ['get', 'selected'], 12, 9],
            26 * t,
          ]);
          map.setPaintProperty(PULSE_LAYER, 'circle-stroke-opacity', [
            '*',
            ['case', ['get', 'dim'], 0.12, 0.55],
            1 - t,
          ]);
        }
        pulseRaf.current = requestAnimationFrame(pulseLoop);
      };
      pulseLoop();
    });

    map.on('zoom', () => {
      const z = map.getZoom();
      const s = useAppStore.getState();
      if (z < ZOOM_OUT_THRESHOLD && !s.zoomedOut && !crossedRef.current) {
        crossedRef.current = true;
        s.setZoomedOut(true);
        s.setInteracted();
      }
      if (z >= ZOOM_OUT_THRESHOLD) crossedRef.current = false;
    });

    // Show/hide the company heat layers + labels (only Perth has companies).
    const setCompaniesVisible = (show: boolean) => {
      [HALO_LAYER, CORE_LAYER, PULSE_LAYER, LABEL_LAYER].forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
      });
    };
    const onZoomReset = () => {
      const city = useAppStore.getState().localCity;
      const v = CITY_VIEWS[city] || CITY_VIEWS.perth;
      setCompaniesVisible(city === 'perth');
      // Jump (hidden behind the overlay fade) so we don't fly across the
      // continent, then the reveal shows the correct city.
      map.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
    };
    window.addEventListener('perth-zoom-reset', onZoomReset);

    return () => {
      window.removeEventListener('perth-zoom-reset', onZoomReset);
      if (autoRotateRaf.current) cancelAnimationFrame(autoRotateRaf.current);
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData(buildGeoJSON(heat, selectedId, filterState));
      // Re-apply the focus fade so a newly dimmed/undimmed label keeps the
      // correct opacity without waiting for the next pan.
      focusUpdaterRef.current?.();
    };
    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
  }, [heat, selectedId, filterState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const coords = COMPANY_COORDS[selectedId];
    if (!coords) return;
    map.easeTo({ center: coords, zoom: Math.max(map.getZoom(), 16.6), duration: 600 });
  }, [selectedId]);

  return <div className="mount" ref={containerRef} />;
}
