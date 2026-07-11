import { useAppStore } from '../../state/store';
import { activeSkillKey, CITY_XY } from '../../data/geo';
import { AU_SCATTER, GLOBAL_SCATTER } from '../../data/scatter';
import { computeCityHeat, computeGlobalHeat, computeSkillSpikes, computeAmbientSpikes, computeGlobalSpikes, computeGlobalAmbientSpikes } from '../../lib/heat';
import { AustraliaMap } from './AustraliaMap';
import { RegionMap } from './RegionMap';
import { GlobeMap } from './GlobeMap';

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

  // Zoom the Australia map toward the city being entered (not always Perth).
  const oc = CITY_XY[localCity] || CITY_XY.perth;
  const auOrigin = `${((oc[0] / 250) * 100).toFixed(1)}% ${((oc[1] / 230) * 100).toFixed(1)}%`;

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
  const showGlobalSpikes = skill && (globalOut || inRegion);
  const globalSpikes = showGlobalSpikes ? computeGlobalSpikes(skill) : [];
  const globalAmbientSpikes = showGlobalSpikes ? computeGlobalAmbientSpikes(skill, GLOBAL_SCATTER) : [];

  const auCls = [zoomedOut ? 'open' : '', zoomingIn ? 'zoomingin' : ''].join(' ').trim();

  return (
    <div className={`auview ${auCls}`} onWheel={(e) => onAuWheel(e.deltaY, globalOut && e.deltaY < 0 ? continentFromMouse(e) : undefined)}>
      <div className={`auscene ${globalOut ? 'scenehide' : ''}`}>
        {domesticRegion === 'australia' ? (
          <AustraliaMap cityHeat={cityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} zoomOrigin={auOrigin} ambientSpikes={ambientSpikes} hubSpikes={skillSpikes} />
        ) : (
          <RegionMap region={domesticRegion} hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} hubSpikes={globalSpikes} ambientSpikes={globalAmbientSpikes} />
        )}
      </div>
      <div className={`globescene ${globalOut ? 'sceneshow' : ''}`}>
        <GlobeMap hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} onContinent={goDomestic} ambientSpikes={globalAmbientSpikes} hubSpikes={globalSpikes} />
      </div>
    </div>
  );
}
