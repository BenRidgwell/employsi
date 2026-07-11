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
        <GlobeMap hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} onContinent={goDomestic} ambientSpikes={globalAmbientSpikes} hubSpikes={globalSpikes} activeSectors={activeSectors} zoomOrigin={globalOrigin} />
      </div>
    </div>
  );
}
