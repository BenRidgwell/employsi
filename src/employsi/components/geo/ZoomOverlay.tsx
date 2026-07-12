import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import { activeSkillKey, CITY_XY } from '../../data/geo';
import { AU_SCATTER, GLOBAL_SCATTER } from '../../data/scatter';
import { computeCityHeat, computeGlobalHeat, computeSkillSpikes, computeAmbientSpikes, computeGlobalSpikes, computeGlobalAmbientSpikes } from '../../lib/heat';
import { AustraliaMap } from './AustraliaMap';
import { RegionMap, regionHubOrigin } from './RegionMap';
import { GlobeMap, globeHubOrigin } from './GlobeMap';

// Approximate centre (global-map content coords) of each clickable continent.
const REGION_CENTERS: [string, number, number][] = [
  ['northamerica', 75, 95],
  ['southamerica', 125, 201],
  ['europe', 240, 61],
  ['africa', 285, 184],
  ['asia', 415, 140],
  ['australia', 462, 214],
];

// Work out which continent the cursor is over on the global map, so scrolling
// in from global drops into that continent's domestic view.
function continentFromMouse(e: React.WheelEvent<HTMLDivElement>): string {
  const svg = document.querySelector('.globescene .globemap') as SVGElement | null;
  if (!svg) return 'australia';
  const r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return 'australia';
  const vbX = ((e.clientX - r.left) / r.width) * 500;
  const vbY = ((e.clientY - r.top) / r.height) * 260;
  // Undo the GEO_SCALE (0.93 about the 250,130 centre) applied to the content.
  const cx = 250 + (vbX - 250) / 0.93;
  const cy = 130 + (vbY - 130) / 0.93;
  let best = 'australia';
  let bd = Infinity;
  for (const [id, rx, ry] of REGION_CENTERS) {
    const d = (cx - rx) ** 2 + (cy - ry) ** 2;
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

// Work out which city hub the cursor is nearest on the active domestic view, so
// scrolling in from a regional map drops into that city's local layer rather
// than always defaulting to Perth. Uses the rendered hub dots' screen positions
// so it works regardless of the map's zoom transform.
function cityFromMouse(e: React.WheelEvent<HTMLDivElement>): string | null {
  const hubs = document.querySelectorAll<SVGGElement>('.auscene .aucity.hub[data-city]');
  let best: string | null = null;
  let bd = Infinity;
  hubs.forEach((h) => {
    const r = h.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
    if (d < bd) {
      bd = d;
      best = h.getAttribute('data-city');
    }
  });
  return best;
}

export function ZoomOverlay() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const zoomingIn = useAppStore((s) => s.zoomingIn);
  const globalOut = useAppStore((s) => s.globalOut);
  const heat = useAppStore((s) => s.heat);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const onAuWheel = useAppStore((s) => s.onAuWheel);
  const goDomestic = useAppStore((s) => s.goDomestic);
  const localCity = useAppStore((s) => s.localCity);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const activeSectors = useAppStore((s) => s.activeSectors);

  // Zoom each scene toward the city being entered (not always Perth), so the
  // "zoom into this city" animation scales from the actual clicked hub on
  // every layer — Australia, the other continents, and the global map.
  const oc = CITY_XY[localCity] || CITY_XY.perth;
  const auOrigin = `${((oc[0] / 250) * 100).toFixed(1)}% ${((oc[1] / 230) * 100).toFixed(1)}%`;
  const regionOrigin = regionHubOrigin(domesticRegion, localCity);
  const globalOrigin = globeHubOrigin(localCity);

  const skill = activeSkillKey(searchQuery);
  const heatDim = skill ? 'auheat-off' : '';
  const cityHeat = computeCityHeat(heat);
  const globalCityHeat = computeGlobalHeat(heat);

  const inRegion = zoomedOut && !globalOut && domesticRegion !== 'australia';
  const inAustralia = zoomedOut && !globalOut && domesticRegion === 'australia';

  const skillSpikes = skill && inAustralia ? computeSkillSpikes(skill) : [];
  const ambientSpikes = skill && inAustralia ? computeAmbientSpikes(skill, AU_SCATTER) : [];
  // Global-coordinate skill spikes drive both the global map and the regional
  // views (the RegionMap projects them into its own zoomed space).
  const showGlobalSpikes = skill && ((globalOut && zoomedOut) || inRegion);
  const globalSpikes = showGlobalSpikes ? computeGlobalSpikes(skill) : [];
  const globalAmbientSpikes = showGlobalSpikes ? computeGlobalAmbientSpikes(skill, GLOBAL_SCATTER) : [];

  const auCls = [zoomedOut ? 'open' : '', zoomingIn ? 'zoomingin' : ''].join(' ').trim();
  // zoomedOut takes precedence over globalOut for which scene is live and
  // interactive — a stray globalOut=true left over from a prior navigation
  // must never make the global scene clickable while actually zoomed into a
  // local city (whose map sits visually on top but wouldn't own the click).
  const showingGlobal = globalOut && zoomedOut;

  // Pan + slight zoom of the global map so overlapping city hubs can be teased
  // apart and selected. Applied to a wrapper around the SVG so the "zoom into
  // a city" animation (which scales the SVG itself) stays independent.
  const [gv, setGv] = useState({ s: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const panRef = useRef<HTMLDivElement | null>(null);

  // Reset the view whenever we leave the global layer or start a zoom-into-city
  // animation, so that animation always scales from a clean, centred frame.
  useEffect(() => {
    if (!showingGlobal || zoomingIn) setGv({ s: 1, x: 0, y: 0 });
  }, [showingGlobal, zoomingIn]);

  const MAX_S = 2.6;
  const clampGv = (v: { s: number; x: number; y: number }) => {
    const el = panRef.current;
    const w = el ? el.clientWidth : 1000;
    const h = el ? el.clientHeight : 520;
    const mx = ((v.s - 1) * w) / 2;
    const my = ((v.s - 1) * h) / 2;
    return { s: v.s, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };

  const onGlobeWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Take the wheel here (instead of letting it bubble to the layer-nav
    // handler) and use it to zoom the global map in place.
    e.stopPropagation();
    const el = panRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    setGv((g) => {
      const ns = Math.max(1, Math.min(MAX_S, g.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const k = ns / g.s;
      return clampGv({ s: ns, x: cx - (cx - g.x) * k, y: cy - (cy - g.y) * k });
    });
  };
  const onGlobePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!showingGlobal) return;
    // Do NOT capture the pointer yet — capturing on down would redirect the
    // click to this wrapper and stop hub / continent-label clicks from firing.
    dragRef.current = { x: e.clientX, y: e.clientY, ox: gv.x, oy: gv.y, moved: false };
  };
  const onGlobePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      // A real drag has started — capture now so panning continues even if the
      // pointer leaves the wrapper. (A plain click never reaches this branch,
      // so its click still lands on the hub underneath.)
      d.moved = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    if (d.moved) setGv((g) => clampGv({ ...g, x: d.ox + dx, y: d.oy + dy }));
  };
  const onGlobePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // If this was a drag (not a tap), swallow the click so it doesn't select a
    // hub the pointer happened to finish over.
    if (d?.moved) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  };

  return (
    <div
      className={`auview ${auCls}`}
      onWheel={(e) => {
        // Scrolling in picks a target under the cursor: a continent when coming
        // from the global map, or the nearest city when coming from a domestic
        // regional map. Scrolling out passes nothing.
        let target: string | undefined;
        if (e.deltaY < 0) target = showingGlobal ? continentFromMouse(e) : cityFromMouse(e) || undefined;
        onAuWheel(e.deltaY, target);
      }}
    >
      <div className={`auscene ${showingGlobal ? 'scenehide' : ''}`}>
        {domesticRegion === 'australia' ? (
          <AustraliaMap cityHeat={cityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} zoomOrigin={auOrigin} ambientSpikes={ambientSpikes} hubSpikes={skillSpikes} activeSectors={activeSectors} />
        ) : (
          <RegionMap region={domesticRegion} hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} hubSpikes={globalSpikes} ambientSpikes={globalAmbientSpikes} activeSectors={activeSectors} zoomOrigin={regionOrigin} />
        )}
      </div>
      <div className={`globescene ${showingGlobal ? 'sceneshow' : ''}`}>
        <div
          ref={panRef}
          className={`globepan ${gv.s > 1 ? 'panned' : ''}`}
          style={{ transform: `translate(${gv.x}px, ${gv.y}px) scale(${gv.s})` }}
          onWheel={onGlobeWheel}
          onPointerDown={onGlobePointerDown}
          onPointerMove={onGlobePointerMove}
          onPointerUp={onGlobePointerUp}
          onClickCapture={(e) => {
            if (suppressClickRef.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
        >
          <GlobeMap hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} onContinent={goDomestic} ambientSpikes={globalAmbientSpikes} hubSpikes={globalSpikes} activeSectors={activeSectors} zoomOrigin={globalOrigin} />
        </div>
      </div>
    </div>
  );
}
