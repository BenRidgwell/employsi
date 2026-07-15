import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef } from 'react';
import { useAppStore, companyMatches, matchesSector, type FilterState } from '../state/store';
import { COMPANIES, type Company } from '../data/companies';
import { CITY_COMPANIES, CITY_VIEWS, PERTH_CENTER, PERTH_DEFAULT_ZOOM, PERTH_DEFAULT_PITCH, PERTH_DEFAULT_BEARING } from '../data/mapboxGeo';
import { chipMetric, type HeatMetric } from '../lib/heat';
import { heatColor, rgbCss } from '../lib/color';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_ID = 'companies';
const HALO_LAYER = 'company-halo';
const CORE_LAYER = 'company-core';
const PULSE_LAYER = 'company-pulse';
const PULSE_MS = 2200;
const ZOOM_OUT_THRESHOLD = 11;

const COMPANY_BY_ID: Record<string, Company> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));

// A company placed on the current city map: its record plus that city's coords.
interface Placed {
  company: Company;
  coords: [number, number];
}

// Resolve the companies pinned for a given city into full records + coords.
function cityPlacements(city: string): Placed[] {
  const list = CITY_COMPANIES[city] || [];
  return list
    .map((c) => ({ company: COMPANY_BY_ID[c.id], coords: c.coords }))
    .filter((p): p is Placed => !!p.company);
}

function metricKeyFor(heat: HeatMetric) {
  return heat === 'salary' ? 'salaryNum' : heat === 'growth' ? 'growth' : 'turnover';
}

// Heat is normalised within the city's own company spread so every city gets a
// full-range colour scale rather than being crushed against the global min/max.
// Companies outside the selected sector(s) are dropped entirely (hidden), so a
// Financial Services filter clears the resource companies from the city map.
function buildGeoJSON(placements: Placed[], heat: HeatMetric, selectedId: string | null, filterState: FilterState): GeoJSON.FeatureCollection {
  const shown = placements.filter((p) => matchesSector(p.company, filterState.activeSectors));
  const key = metricKeyFor(heat);
  const vals = shown.map((p) => p.company[key] as number);
  const mn = vals.length ? Math.min(...vals) : 0;
  const mx = vals.length ? Math.max(...vals) : 1;
  return {
    type: 'FeatureCollection',
    features: shown.map((p, i) => {
      const c = p.company;
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
          // Fade every other company's heat dot while a card is open, matching
          // the HTML pill treatment, so the selected company stays the focus.
          dim: !companyMatches(c, filterState) || (!!selectedId && c.id !== selectedId),
        },
        geometry: { type: 'Point', coordinates: p.coords },
      };
    }),
  };
}

export function PerthMapbox() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const placedRef = useRef<Placed[]>([]);
  const renderCityRef = useRef<((city: string) => void) | null>(null);
  const setCompaniesVisibleRef = useRef<((show: boolean) => void) | null>(null);
  const crossedRef = useRef(false);
  const interactedLocalRef = useRef(false);
  const autoRotateRaf = useRef<number | undefined>(undefined);
  const pulseRaf = useRef<number | undefined>(undefined);
  const focusUpdaterRef = useRef<(() => void) | null>(null);

  const selectedId = useAppStore((s) => s.selectedId);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
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
      // Also hide place labels — the map always initialises centred on Perth,
      // so the "Perth" city label could flash on-screen when entering another
      // city's local view before the camera jump lands.
      map.setConfigProperty('basemap', 'showPlaceLabels', false);

      const st = useAppStore.getState();
      placedRef.current = cityPlacements(st.localCity);
      map.addSource(SOURCE_ID, { type: 'geojson', data: buildGeoJSON(placedRef.current, st.heat, st.selectedId, filterState) });

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

      [CORE_LAYER, HALO_LAYER].forEach((layer) => {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      });

      // A single click handler for the whole map: select the nearest company
      // within a generous radius (so tightly-clustered CBD companies whose pills
      // are collision-hidden and whose dots overlap — e.g. IGO / S32 / Chevron —
      // are still reliably reachable), otherwise dismiss any open card while
      // staying in this local city. queryRenderedFeatures alone missed the
      // occluded dots, and the old empty-click close then fired instead, which
      // is why those cards never opened. Pill markers are HTML overlays whose
      // clicks don't reach the canvas, so selecting via a visible pill is
      // unaffected.
      const PICK_RADIUS = 30; // px
      let lastSelectAt = 0;
      map.on('click', (e) => {
        let best: Placed | null = null;
        let bestD = Infinity;
        placedRef.current.forEach((p) => {
          const pt = map.project(p.coords);
          const d = (pt.x - e.point.x) ** 2 + (pt.y - e.point.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        });
        if (best && bestD <= PICK_RADIUS * PICK_RADIUS) {
          useAppStore.getState().select((best as Placed).company.id);
          lastSelectAt = Date.now();
          return;
        }
        const selectedId = useAppStore.getState().selectedId;
        if (!selectedId) return;
        // Guard against a card opening then instantly closing. The select above
        // eases the camera to reserve space for the card, so the selected dot
        // slides under the panel. A second, quick click (a double-click, or an
        // impatient re-tap) then lands well away from that shifted dot and would
        // otherwise fall through to closePanel. Ignore the close if we only just
        // selected, or if the click is still near the selected company.
        if (Date.now() - lastSelectAt < 500) return;
        const sel = placedRef.current.find((p) => p.company.id === selectedId);
        if (sel) {
          const pt = map.project(sel.coords);
          const d = (pt.x - e.point.x) ** 2 + (pt.y - e.point.y) ** 2;
          if (d <= (PICK_RADIUS * 2) ** 2) return;
        }
        useAppStore.getState().closePanel();
      });

      // HTML pill markers (dot · ticker · median), anchored just above each dot.
      // Rebuilt whenever the active city changes so each city shows its own set.
      const renderMarkers = (placements: Placed[]) => {
        Object.values(markersRef.current).forEach((m) => m.remove());
        markersRef.current = {};
        placements.forEach((p) => {
          const c = p.company;
          const el = document.createElement('button');
          el.className = 'mbchip';
          el.innerHTML = `<span class="chipdot"></span><span class="chiptk">${c.ticker}</span><span class="chipsub"></span>`;
          // Keep the pointer press off the map so it can't start a drag-pan: a
          // tiny move during the press would otherwise suppress the button's
          // native click and the pill would silently pan instead of selecting
          // (the canvas dots don't have this problem — Mapbox owns their click
          // detection, which tolerates small movement). Selecting here mirrors
          // the canvas handler, including the just-selected guard timestamp.
          const swallow = (ev: Event) => ev.stopPropagation();
          el.addEventListener('mousedown', swallow);
          el.addEventListener('touchstart', swallow, { passive: true });
          el.addEventListener('pointerdown', swallow);
          el.onclick = (ev) => {
            ev.stopPropagation();
            useAppStore.getState().select(c.id);
            lastSelectAt = Date.now();
          };
          const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] })
            .setLngLat(p.coords)
            .addTo(map);
          markersRef.current[c.id] = marker;
        });
      };
      renderMarkers(placedRef.current);

      // Explicit show/hide for the native heat layers + HTML markers. The
      // domestic/global SVG overlay visually covers the map when zoomed out,
      // but the WebGL layers and markers keep rendering underneath unless we
      // hide them too — belt-and-braces so nothing can bleed through during
      // the crossfade or on browsers where canvas compositing ignores normal
      // DOM stacking.
      const setCompaniesVisible = (show: boolean) => {
        [HALO_LAYER, CORE_LAYER, PULSE_LAYER].forEach((id) => {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
        });
        Object.values(markersRef.current).forEach((m) => {
          (m.getElement() as HTMLElement).style.display = show ? '' : 'none';
        });
      };
      setCompaniesVisibleRef.current = setCompaniesVisible;

      // Swap the whole company set to a different city: refresh placements, the
      // heat source and the pill markers, then apply the current filter (sector
      // hide + dim) and re-run the focus fade. Reads the live filter from the
      // store so entering a city already reflects any active filter.
      renderCityRef.current = (city: string) => {
        placedRef.current = cityPlacements(city);
        const s = useAppStore.getState();
        const fs: FilterState = {
          searchQuery: s.searchQuery,
          activeSectors: s.activeSectors,
          minSalary: s.minSalary,
          minHeadcount: s.minHeadcount,
          minGrowth: s.minGrowth,
          maxAttrition: s.maxAttrition,
        };
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        source?.setData(buildGeoJSON(placedRef.current, s.heat, s.selectedId, fs));
        renderMarkers(placedRef.current);
        setCompaniesVisible(true);
        placedRef.current.forEach((p) => {
          const el = markersRef.current[p.company.id]?.getElement();
          if (!el) return;
          el.style.display = matchesSector(p.company, fs.activeSectors) ? '' : 'none';
          const matches = companyMatches(p.company, fs);
          // Fade every other pill while a card is open, so the selected company
          // stays the visual focus; clears the instant selectedId is null again.
          const notSelected = !!s.selectedId && s.selectedId !== p.company.id;
          el.className = ['mbchip', s.selectedId === p.company.id ? 'on' : '', matches && !notSelected ? '' : 'dim'].join(' ').trim();
        });
        focusUpdaterRef.current?.();
      };

      // Cold load starts zoomed out (global/domestic) — hide immediately
      // rather than waiting for a zoom crossing that will never happen.
      if (useAppStore.getState().zoomedOut) setCompaniesVisible(false);

      // Focus reveal: labels fade in by ground distance from centre + zoom, and
      // a greedy collision pass hides any pill that would overlap a
      // higher-priority (more revealed) one, so text never overlaps.
      const R_FULL = 700; // metres from centre: within this -> fully shown
      const R_GONE = 1900; // metres from centre: beyond this -> hidden
      const Z_MIN = 13.4; // below this zoom -> labels hidden
      const Z_FULL = 14.4; // at/above this zoom -> labels at full strength
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
        type Cand = { el: HTMLElement; op: number; x: number; y: number; w: number };
        const cands: Cand[] = [];
        placedRef.current.forEach((placed) => {
          const marker = markersRef.current[placed.company.id];
          if (!marker) return;
          const el = marker.getElement();
          // Skip sector-hidden markers (display:none) so they neither show nor
          // block a visible pill in the collision pass.
          if (el.style.display === 'none') return;
          const [lng, lat] = placed.coords;
          const d = distMetres(c.lng, c.lat, lng, lat);
          const df = d <= R_FULL ? 1 : d >= R_GONE ? 0 : (R_GONE - d) / (R_GONE - R_FULL);
          const f = df * zf;
          const base = el.classList.contains('dim') ? 0.4 : 1;
          if (f <= 0.02) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }
          const p = map.project([lng, lat]);
          cands.push({ el, op: base * f, x: p.x, y: p.y, w: el.offsetWidth || 120 });
        });
        // Show the most-revealed first; hide any that collide with a shown one.
        cands.sort((a, b) => b.op - a.op);
        const shown: { x0: number; x1: number; y0: number; y1: number }[] = [];
        const MH = 40;
        cands.forEach((cd) => {
          const half = (cd.w || 120) / 2 + 4;
          const box = { x0: cd.x - half, x1: cd.x + half, y0: cd.y - MH - 6, y1: cd.y - 6 };
          const hit = shown.some((s) => box.x0 < s.x1 && box.x1 > s.x0 && box.y0 < s.y1 && box.y1 > s.y0);
          if (hit) {
            cd.el.style.opacity = '0';
            cd.el.style.pointerEvents = 'none';
          } else {
            shown.push(box);
            cd.el.style.opacity = String(cd.op);
            cd.el.style.pointerEvents = cd.op > 0.05 ? 'auto' : 'none';
          }
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
        // Cross out to the domestic overlay for this city's own continent —
        // never strand globalOut=true over the local map (which would float
        // the global search bar above it), and never default to Australia.
        s.zoomOutToDomestic();
        // Hide the heat layers + pill markers so they can't be visible under
        // the domestic overlay while it's zoomed out.
        setCompaniesVisibleRef.current?.(false);
      }
      if (z >= ZOOM_OUT_THRESHOLD) crossedRef.current = false;
    });

    const onZoomReset = () => {
      const city = useAppStore.getState().localCity;
      const v = CITY_VIEWS[city] || CITY_VIEWS.perth;
      // Jump (hidden behind the overlay fade) so we don't fly across the
      // continent, then swap in the city's companies + reveal.
      map.jumpTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
      renderCityRef.current?.(city);
    };
    window.addEventListener('perth-zoom-reset', onZoomReset);

    return () => {
      window.removeEventListener('perth-zoom-reset', onZoomReset);
      if (autoRotateRaf.current) cancelAnimationFrame(autoRotateRaf.current);
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
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
      source.setData(buildGeoJSON(placedRef.current, heat, selectedId, filterState));
      placedRef.current.forEach((p) => {
        const c = p.company;
        const marker = markersRef.current[c.id];
        if (!marker) return;
        const el = marker.getElement();
        // Sector filter hides the marker entirely; the remaining filters dim it.
        const inSector = matchesSector(c, filterState.activeSectors);
        el.style.display = inSector ? '' : 'none';
        const matches = companyMatches(c, filterState);
        // Fade every other pill while a card is open, so the selected company
        // stays the visual focus; clears the instant selectedId is null again.
        const notSelected = !!selectedId && selectedId !== c.id;
        el.className = ['mbchip', selectedId === c.id ? 'on' : '', matches && !notSelected ? '' : 'dim'].join(' ').trim();
        const sub = el.querySelector('.chipsub');
        if (sub) sub.textContent = chipMetric(c, heat);
      });
      // Re-apply the focus fade so a newly dimmed/undimmed pill keeps the
      // correct opacity without waiting for the next pan.
      focusUpdaterRef.current?.();
    };
    if (map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
  }, [heat, selectedId, filterState]);

  useEffect(() => {
    // Hide companies the instant we're zoomed out, regardless of what
    // triggered it (wheel crossing, the ZoomSlider's Domestic button, or a
    // skill search jumping straight to zoomedOut) — the native zoom-crossing
    // handler alone misses triggers that don't move the map's own camera.
    // Showing them again is handled by renderCityRef when zooming back in.
    if (zoomedOut) setCompaniesVisibleRef.current?.(false);
  }, [zoomedOut]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selectedId) {
      // Panel closed — release the reserved right padding so the map re-centres.
      const pad = typeof map.getPadding === 'function' ? map.getPadding() : null;
      if (pad && (pad.right || 0) > 0) {
        map.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: 0 }, duration: 420 });
      }
      return;
    }
    const placed = placedRef.current.find((p) => p.company.id === selectedId);
    if (!placed) return;
    // Reserve the right of the screen for the company + news cards, so the
    // selected building frames up on the left half.
    const rightPad = Math.min(760, Math.round(window.innerWidth * 0.6));
    map.easeTo({
      center: placed.coords,
      zoom: Math.max(map.getZoom(), 17),
      padding: { top: 0, bottom: 0, left: 0, right: rightPad },
      duration: 640,
    });
  }, [selectedId]);

  return <div className="mount" ref={containerRef} />;
}
