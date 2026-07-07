import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef } from 'react';
import { useAppStore, companyMatches, type FilterState } from '../state/store';
import { COMPANIES } from '../data/companies';
import { COMPANY_COORDS, PERTH_CENTER, PERTH_DEFAULT_ZOOM, PERTH_DEFAULT_PITCH, PERTH_DEFAULT_BEARING } from '../data/mapboxGeo';
import { chipMetric, type HeatMetric } from '../lib/heat';
import { heatColor, rgbCss } from '../lib/color';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_ID = 'companies';
const HALO_LAYER = 'company-halo';
const CORE_LAYER = 'company-core';
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
    features: COMPANIES.map((c) => {
      const t = ((c[key] as number) - mn) / ((mx - mn) || 1);
      const color = rgbCss(heatColor(t));
      return {
        type: 'Feature',
        properties: {
          id: c.id,
          color,
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
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const crossedRef = useRef(false);
  const interactedLocalRef = useRef(false);
  const autoRotateRaf = useRef<number | undefined>(undefined);

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
    });
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

      COMPANIES.forEach((c) => {
        const el = document.createElement('button');
        el.className = 'mbchip';
        el.innerHTML = `<span class="chipdot"></span><span class="chiptk">${c.ticker}</span><span class="chipsub"></span>`;
        el.onclick = () => useAppStore.getState().select(c.id);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] })
          .setLngLat(COMPANY_COORDS[c.id])
          .addTo(map);
        markersRef.current[c.id] = marker;
      });

      const loop = () => {
        if (!interactedLocalRef.current) {
          map.setBearing(map.getBearing() + 0.025);
        }
        autoRotateRaf.current = requestAnimationFrame(loop);
      };
      loop();
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

    const onZoomReset = () => {
      map.flyTo({
        center: PERTH_CENTER,
        zoom: PERTH_DEFAULT_ZOOM,
        pitch: PERTH_DEFAULT_PITCH,
        bearing: PERTH_DEFAULT_BEARING,
        duration: 800,
      });
    };
    window.addEventListener('perth-zoom-reset', onZoomReset);

    return () => {
      window.removeEventListener('perth-zoom-reset', onZoomReset);
      if (autoRotateRaf.current) cancelAnimationFrame(autoRotateRaf.current);
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
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
      COMPANIES.forEach((c) => {
        const marker = markersRef.current[c.id];
        if (!marker) return;
        const el = marker.getElement();
        const matches = companyMatches(c, filterState);
        el.className = ['mbchip', selectedId === c.id ? 'on' : '', matches ? '' : 'dim'].join(' ').trim();
        const sub = el.querySelector('.chipsub');
        if (sub) sub.textContent = chipMetric(c, heat);
      });
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
