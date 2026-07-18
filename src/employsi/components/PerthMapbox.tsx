import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useMemo, useRef } from 'react';
import { useAppStore, matchesFilters, searchMatches, isSearchActive, type FilterState } from '../state/store';
import { COMPANIES, type Company } from '../data/companies';
import { CITY_COMPANIES, CITY_VIEWS, PERTH_CENTER, PERTH_DEFAULT_ZOOM, PERTH_DEFAULT_PITCH, PERTH_DEFAULT_BEARING } from '../data/mapboxGeo';
import { heatColor, rgbCss } from '../lib/color';
import { activeSkill, demandByCompany } from '../lib/skillHeat';
import type { SkillIndex } from '../lib/skillsFn';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const SOURCE_ID = 'companies';
const HALO_LAYER = 'company-halo';
const CORE_LAYER = 'company-core';
const PULSE_LAYER = 'company-pulse';
const PULSE_MS = 2200;
const ZOOM_OUT_THRESHOLD = 11;

const COMPANY_BY_ID: Record<string, Company> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));

// --- Street traffic: cars that drive along the actual road geometry of the
// rendered basemap, so they follow the real streets under the 3D city. ---
const CAR_COLORS = ['#b23a2e', '#2b3f6b', '#e6e7ea', '#2f7d4f', '#c69a34', '#6d2f63', '#4a4e57', '#a8442e'];
const NUM_CARS = 14;

// Neutral marker colour — every layer sits neutral until a skill is searched
// (then the demand gradient takes over).
const NEUTRAL = 'rgb(42,42,46)';

// Pill label: the company's name, word-shortened to keep the pill roughly its
// old (ticker-width) size. Long single words fall back to a clipped form.
function pillLabel(name: string, ticker: string): string {
  const words = name.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? out + ' ' + w : w;
    if (out && next.length > 14) break;
    out = next;
  }
  if (!out) out = name;
  if (out.length > 16) out = out.slice(0, 15).trimEnd() + '…';
  return out || ticker;
}

// On a phone the city fills a much smaller viewport, so the default local zoom
// reads as uncomfortably close. Pull the default view back a notch on mobile
// (kept high enough to still show the 3D buildings). Company-framing zooms are
// left untouched.
function localDefaultZoom(z: number): number {
  const mobile = typeof window !== 'undefined' && window.innerWidth <= 680;
  return mobile ? Math.max(14.4, z - 1.5) : z;
}

// A small, shaded top-down car. It rides pitch-aligned on the 3D streetscape
// (see the marker's pitch/rotation alignment), so at the local view's tilt it
// foreshortens onto the road and reads as a little 3D vehicle. Forward is up
// (−Y): headlights + windshield sit at the top, tail-lights + rear glass at the
// bottom, and a soft ground shadow grounds it. No <defs> gradients — duplicate
// ids across many marker SVGs resolve unpredictably — just layered fills.
function carSvg(color: string): string {
  return (
    '<svg viewBox="0 0 22 40" width="10" height="18">' +
    // soft ground shadow
    '<ellipse cx="11" cy="21.5" rx="8.2" ry="17.5" fill="rgba(0,0,0,0.2)"/>' +
    // body
    '<rect x="3.5" y="3" width="15" height="34" rx="6" fill="' + color + '" stroke="rgba(0,0,0,0.4)" stroke-width="0.7"/>' +
    // left/right body sheen
    '<rect x="4.3" y="4.5" width="2.1" height="31" rx="1" fill="rgba(255,255,255,0.20)"/>' +
    '<rect x="15.6" y="4.5" width="2.1" height="31" rx="1" fill="rgba(0,0,0,0.14)"/>' +
    // front windshield
    '<path d="M6.2 10 Q11 8.2 15.8 10 L14.4 15 Q11 13.8 7.6 15 Z" fill="#0e1620" opacity="0.9"/>' +
    // roof
    '<rect x="6.6" y="15.6" width="8.8" height="9" rx="2.2" fill="rgba(255,255,255,0.09)"/>' +
    // rear window
    '<path d="M7.6 25 Q11 26.2 14.4 25 L15.8 30 Q11 31.8 6.2 30 Z" fill="#0e1620" opacity="0.9"/>' +
    // headlights
    '<rect x="6" y="3.7" width="3" height="1.7" rx="0.8" fill="#fff4d2"/>' +
    '<rect x="13" y="3.7" width="3" height="1.7" rx="0.8" fill="#fff4d2"/>' +
    // tail-lights
    '<rect x="6" y="34.6" width="3" height="1.7" rx="0.8" fill="#e0463a"/>' +
    '<rect x="13" y="34.6" width="3" height="1.7" rx="0.8" fill="#e0463a"/>' +
    // wing mirrors
    '<rect x="1.9" y="13.6" width="2.3" height="2.1" rx="1" fill="' + color + '"/>' +
    '<rect x="17.8" y="13.6" width="2.3" height="2.1" rx="1" fill="' + color + '"/>' +
    '</svg>'
  );
}

function metresBetween(a: [number, number], b: [number, number]): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingBetween(a: [number, number], b: [number, number]): number {
  const toR = Math.PI / 180, toD = 180 / Math.PI;
  const dLng = (b[0] - a[0]) * toR;
  const la1 = a[1] * toR, la2 = b[1] * toR;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * toD + 360) % 360;
}

interface RoadPath { pts: [number, number][]; cum: number[]; total: number; }
function roadPath(pts: [number, number][]): RoadPath {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += metresBetween(pts[i - 1], pts[i]);
    cum.push(total);
  }
  return { pts, cum, total };
}
// Position + heading a given distance (metres) along a road path.
function alongPath(rp: RoadPath, dist: number): { pos: [number, number]; bearing: number } {
  const d = ((dist % rp.total) + rp.total) % rp.total;
  let i = 1;
  while (i < rp.cum.length && rp.cum[i] < d) i++;
  const a = rp.pts[i - 1], b = rp.pts[i] || rp.pts[i - 1];
  const seg = rp.cum[i] - rp.cum[i - 1] || 1;
  const t = (d - rp.cum[i - 1]) / seg;
  return { pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearingBetween(a, b) };
}

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

// Companies sit neutral until a skill is searched; then every dot is coloured by
// that skill's real demand, normalised within the city's own spread so each city
// gets a full-range scale. Companies outside the selected sector(s) are dropped
// entirely (hidden), so a Financial Services filter clears the resource
// companies from the city map.
function buildGeoJSON(
  placements: Placed[],
  selectedId: string | null,
  filterState: FilterState,
  skillDemand: Record<string, number> | null,
): GeoJSON.FeatureCollection {
  // Hide any company that fails the sector / exchange / slider filters entirely.
  const shown = placements.filter((p) => matchesFilters(p.company, filterState));
  const skillMode = !!skillDemand;
  const demandMax = skillMode ? Math.max(1, ...shown.map((p) => skillDemand![p.company.id] || 0)) : 1;
  return {
    type: 'FeatureCollection',
    features: shown.map((p, i) => {
      const c = p.company;
      const demand = skillMode ? skillDemand![c.id] || 0 : 0;
      const color = skillMode ? rgbCss(heatColor(demand / demandMax)) : NEUTRAL;
      return {
        type: 'Feature',
        id: i,
        properties: {
          id: c.id,
          color,
          label: pillLabel(c.name, c.ticker),
          selected: c.id === selectedId,
          // In skill mode, dim companies with no live demand for the skill so
          // the map highlights exactly where it's being hired. Otherwise a
          // search miss (or another company being selected) dims a dot.
          dim: skillMode
            ? demand === 0 || (!!selectedId && c.id !== selectedId)
            : (isSearchActive(filterState) && !searchMatches(c, filterState.searchQuery)) ||
              (!!selectedId && c.id !== selectedId),
        },
        geometry: { type: 'Point', coordinates: p.coords },
      };
    }),
  };
}

// Pull the filter fields out of the live store state (used by the once-wired
// map callbacks that read via getState()).
function filterStateOf(s: {
  searchQuery: string; activeSectors: string[]; activeExchanges: string[];
  minSalary: number; minHeadcount: number; minGrowth: number; maxAttrition: number;
}): FilterState {
  return {
    searchQuery: s.searchQuery,
    activeSectors: s.activeSectors,
    activeExchanges: s.activeExchanges,
    minSalary: s.minSalary,
    minHeadcount: s.minHeadcount,
    minGrowth: s.minGrowth,
    maxAttrition: s.maxAttrition,
  };
}

// The live per-company demand lookup when a skill is the active search, else
// null (maps fall back to the salary/growth metric).
function skillDemandOf(s: { searchQuery: string; skillIndex: SkillIndex | null }): Record<string, number> | null {
  const sk = activeSkill(s.searchQuery);
  return sk ? demandByCompany(s.skillIndex, sk) : null;
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
  const carsRef = useRef<{ marker: mapboxgl.Marker; path: RoadPath | null; dist: number; speed: number }[]>([]);
  const carRaf = useRef<number | undefined>(undefined);
  const roadsRef = useRef<RoadPath[]>([]);
  const focusUpdaterRef = useRef<(() => void) | null>(null);

  const selectedId = useAppStore((s) => s.selectedId);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const skillIndex = useAppStore((s) => s.skillIndex);
  const activeSectors = useAppStore((s) => s.activeSectors);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);

  const filterState: FilterState = useMemo(
    () => ({ searchQuery, activeSectors, activeExchanges, minSalary, minHeadcount, minGrowth, maxAttrition }),
    [searchQuery, activeSectors, activeExchanges, minSalary, minHeadcount, minGrowth, maxAttrition],
  );

  const skillDemand = useMemo(() => {
    const sk = activeSkill(searchQuery);
    return sk ? demandByCompany(skillIndex, sk) : null;
  }, [searchQuery, skillIndex]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/standard',
      center: PERTH_CENTER,
      zoom: localDefaultZoom(PERTH_DEFAULT_ZOOM),
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
      map.addSource(SOURCE_ID, { type: 'geojson', data: buildGeoJSON(placedRef.current, st.selectedId, filterState, skillDemandOf(st)) });

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
        // Only companies passing the active filters are pickable — hidden dots
        // must not be selectable via the nearest-dot fallback.
        const fs = filterStateOf(useAppStore.getState());
        let best: Placed | null = null;
        let bestD = Infinity;
        placedRef.current.forEach((p) => {
          if (!matchesFilters(p.company, fs)) return;
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
          el.innerHTML = `<span class="chiptk"></span>`;
          (el.querySelector('.chiptk') as HTMLElement).textContent = pillLabel(c.name, c.ticker);
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
          // Anchor the pill's left edge just past the dot, so the crisp coloured
          // dot marks the exact location and the name label attaches directly to
          // its right — one marker, never floating off on its own.
          const marker = new mapboxgl.Marker({ element: el, anchor: 'left', offset: [9, 0] })
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
        // When revealing companies, respect the active sector / exchange /
        // slider filters — a filtered-out company must never be shown, no matter
        // which code path reveals the set. Hiding is unconditional.
        const fs = show ? filterStateOf(useAppStore.getState()) : null;
        Object.entries(markersRef.current).forEach(([id, m]) => {
          const el = m.getElement() as HTMLElement;
          if (!show) {
            el.style.display = 'none';
            return;
          }
          const c = COMPANY_BY_ID[id];
          el.style.display = c && fs && matchesFilters(c, fs) ? '' : 'none';
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
        const fs = filterStateOf(s);
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        source?.setData(buildGeoJSON(placedRef.current, s.selectedId, fs, skillDemandOf(s)));
        renderMarkers(placedRef.current);
        setCompaniesVisible(true);
        placedRef.current.forEach((p) => {
          const el = markersRef.current[p.company.id]?.getElement();
          if (!el) return;
          // Hard filters (sector / exchange / sliders) hide the pill entirely;
          // a search miss only dims it.
          el.style.display = matchesFilters(p.company, fs) ? '' : 'none';
          const searchOk = !isSearchActive(fs) || searchMatches(p.company, fs.searchQuery);
          const notSelected = !!s.selectedId && s.selectedId !== p.company.id;
          el.className = ['mbchip', s.selectedId === p.company.id ? 'on' : '', searchOk && !notSelected ? '' : 'dim'].join(' ').trim();
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
        type Cand = { el: HTMLElement; op: number; x: number; y: number; w: number; force: boolean };
        const cands: Cand[] = [];
        placedRef.current.forEach((placed) => {
          const marker = markersRef.current[placed.company.id];
          if (!marker) return;
          const el = marker.getElement();
          // Skip sector-hidden markers (display:none) so they neither show nor
          // block a visible pill in the collision pass.
          if (el.style.display === 'none') return;
          const [lng, lat] = placed.coords;
          const p = map.project([lng, lat]);
          // The selected company's pill is always shown at its true position,
          // regardless of distance/zoom fade or collision — so opening a company
          // that sits far from the city centre (e.g. Mineral Resources up in
          // Osborne Park) still pins its pill to its own building.
          if (el.classList.contains('on')) {
            cands.push({ el, op: 1, x: p.x, y: p.y, w: el.offsetWidth || 120, force: true });
            return;
          }
          const d = distMetres(c.lng, c.lat, lng, lat);
          const df = d <= R_FULL ? 1 : d >= R_GONE ? 0 : (R_GONE - d) / (R_GONE - R_FULL);
          const f = df * zf;
          const base = el.classList.contains('dim') ? 0.4 : 1;
          if (f <= 0.02) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }
          cands.push({ el, op: base * f, x: p.x, y: p.y, w: el.offsetWidth || 120, force: false });
        });
        // Show the most-revealed first; hide any that collide with a shown one
        // (forced pills — the selected company — are never hidden).
        cands.sort((a, b) => b.op - a.op);
        const shown: { x0: number; x1: number; y0: number; y1: number }[] = [];
        const MH = 26;
        cands.forEach((cd) => {
          // The pill sits to the right of the dot, vertically centred on it.
          const box = { x0: cd.x - 6, x1: cd.x + (cd.w || 120) + 12, y0: cd.y - MH / 2, y1: cd.y + MH / 2 };
          const hit = !cd.force && shown.some((s) => box.x0 < s.x1 && box.x1 > s.x0 && box.y0 < s.y1 && box.y1 > s.y0);
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

      // --- Street traffic ---
      // Create the car markers up front; they get assigned to a real road once
      // roads are queried.
      for (let i = 0; i < NUM_CARS; i++) {
        const el = document.createElement('div');
        el.className = 'carmarker';
        el.innerHTML = carSvg(CAR_COLORS[i % CAR_COLORS.length]);
        const marker = new mapboxgl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
          .setLngLat(PERTH_CENTER)
          .addTo(map);
        el.style.display = 'none';
        carsRef.current.push({ marker, path: null, dist: 0, speed: 8 + Math.random() * 9 });
      }

      // Query the rendered basemap for road centre-lines within the viewport and
      // turn them into drive-able paths (geometry comes back as lng/lat).
      const refreshRoads = () => {
        let feats: mapboxgl.MapboxGeoJSONFeature[] = [];
        try { feats = map.queryRenderedFeatures(); } catch { return; }
        const paths: RoadPath[] = [];
        for (const f of feats) {
          const g = f.geometry;
          const sl = (f.sourceLayer || '') + ' ' + ((f.layer && f.layer.id) || '');
          if (!/road|street|transport/i.test(sl)) continue;
          if (g.type === 'LineString' && g.coordinates.length >= 2) {
            paths.push(roadPath(g.coordinates as [number, number][]));
          } else if (g.type === 'MultiLineString') {
            for (const line of g.coordinates) if (line.length >= 2) paths.push(roadPath(line as [number, number][]));
          }
          if (paths.length >= 60) break;
        }
        // Keep only reasonably long segments so cars have room to move.
        roadsRef.current = paths.filter((p) => p.total > 40);
      };

      const inView = (lngLat: [number, number]): boolean => {
        const p = map.project(lngLat);
        const c = map.getContainer();
        return p.x >= -20 && p.y >= -20 && p.x <= c.clientWidth + 20 && p.y <= c.clientHeight + 20;
      };
      const assignRoads = () => {
        const roads = roadsRef.current;
        if (!roads.length) return;
        carsRef.current.forEach((car) => {
          // (Re)assign a car if it has no road yet or has driven out of view.
          const cur = car.path ? alongPath(car.path, car.dist).pos : null;
          if (car.path && cur && inView(cur)) return;
          const road = roads[Math.floor(Math.random() * roads.length)];
          car.path = road;
          car.dist = Math.random() * road.total;
        });
      };

      let lastCar = performance.now();
      const carLoop = () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - lastCar) / 1000);
        lastCar = now;
        const s = useAppStore.getState();
        const show = !s.zoomedOut && !s.zoomingIn;
        carsRef.current.forEach((car) => {
          const el = car.marker.getElement();
          if (!show || !car.path) { el.style.display = 'none'; return; }
          el.style.display = '';
          car.dist += car.speed * dt;
          const { pos, bearing } = alongPath(car.path, car.dist);
          car.marker.setLngLat(pos);
          car.marker.setRotation(bearing);
        });
        carRaf.current = requestAnimationFrame(carLoop);
      };
      carLoop();

      // Refresh roads + reassign whenever the camera settles, and once now.
      map.on('idle', () => { refreshRoads(); assignRoads(); });
      refreshRoads();
      assignRoads();
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
      const st = useAppStore.getState();
      const city = st.localCity;
      const v = CITY_VIEWS[city] || CITY_VIEWS.perth;
      // Jump (hidden behind the overlay fade) so we don't fly across the
      // continent, then swap in the city's companies + reveal.
      map.jumpTo({ center: v.center, zoom: localDefaultZoom(v.zoom), pitch: v.pitch, bearing: v.bearing });
      renderCityRef.current?.(city);
      // If we arrived with a company already selected (from search or the saved
      // list), frame that company — it may sit well outside the city's default
      // camera (e.g. Mineral Resources in Osborne Park), so the jumpTo above
      // would otherwise leave its pill off-screen. The [selectedId] effect can
      // miss this because the placements aren't ready when it first runs.
      const sel = st.selectedId ? cityPlacements(city).find((p) => p.company.id === st.selectedId) : null;
      if (sel) {
        const rightPad = Math.min(760, Math.round(window.innerWidth * 0.6));
        map.easeTo({ center: sel.coords, zoom: Math.max(v.zoom, 16.5), padding: { top: 0, bottom: 0, left: 0, right: rightPad }, duration: 700 });
      }
    };
    window.addEventListener('perth-zoom-reset', onZoomReset);

    return () => {
      window.removeEventListener('perth-zoom-reset', onZoomReset);
      if (autoRotateRaf.current) cancelAnimationFrame(autoRotateRaf.current);
      if (pulseRaf.current) cancelAnimationFrame(pulseRaf.current);
      if (carRaf.current) cancelAnimationFrame(carRaf.current);
      carsRef.current.forEach((c) => c.marker.remove());
      carsRef.current = [];
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
      // Update the heat-dot source when it exists — but never gate the pill
      // (DOM) filtering on it. The Mapbox 'standard' style keeps
      // isStyleLoaded() false well after load, so the old
      // `once('style.load')` deferral dropped filter changes entirely (the
      // event never re-fires); applying directly avoids that.
      const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (source) source.setData(buildGeoJSON(placedRef.current, selectedId, filterState, skillDemand));
      placedRef.current.forEach((p) => {
        const c = p.company;
        const marker = markersRef.current[c.id];
        if (!marker) return;
        const el = marker.getElement();
        // Sector / exchange / slider filters hide the marker entirely; a search
        // miss only dims it.
        el.style.display = matchesFilters(c, filterState) ? '' : 'none';
        // In skill mode a pill is "lit" when the company has live demand for the
        // searched skill; otherwise fall back to the free-text search match.
        const demand = skillDemand ? skillDemand[c.id] || 0 : 0;
        const searchOk = skillDemand
          ? demand > 0
          : !isSearchActive(filterState) || searchMatches(c, filterState.searchQuery);
        // Fade every other pill while a card is open, so the selected company
        // stays the visual focus; clears the instant selectedId is null again.
        const notSelected = !!selectedId && selectedId !== c.id;
        el.className = ['mbchip', selectedId === c.id ? 'on' : '', searchOk && !notSelected ? '' : 'dim'].join(' ').trim();
      });
      // Re-apply the focus fade so a newly dimmed/undimmed pill keeps the
      // correct opacity without waiting for the next pan.
      focusUpdaterRef.current?.();
    };
    apply();
  }, [selectedId, filterState, skillDemand]);

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
