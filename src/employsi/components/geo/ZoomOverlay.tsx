import { useAppStore } from '../../state/store';
import { activeSkillKey, CITY_XY } from '../../data/geo';
import { AU_SCATTER, GLOBAL_SCATTER } from '../../data/scatter';
import { computeCityHeat, computeGlobalHeat, computeSkillSpikes, computeAmbientSpikes, computeGlobalSpikes, computeGlobalAmbientSpikes } from '../../lib/heat';
import { AustraliaMap } from './AustraliaMap';
import { AsiaMap } from './AsiaMap';
import { GlobeMap } from './GlobeMap';

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

  const skillSpikes = skill && zoomedOut ? computeSkillSpikes(skill) : [];
  const ambientSpikes = skill && zoomedOut ? computeAmbientSpikes(skill, AU_SCATTER) : [];
  const globalSpikes = skill && globalOut ? computeGlobalSpikes(skill) : [];
  const globalAmbientSpikes = skill && globalOut ? computeGlobalAmbientSpikes(skill, GLOBAL_SCATTER) : [];

  const auCls = [zoomedOut ? 'open' : '', zoomingIn ? 'zoomingin' : ''].join(' ').trim();

  return (
    <div className={`auview ${auCls}`} onWheel={(e) => onAuWheel(e.deltaY)}>
      <div className={`auscene ${globalOut ? 'scenehide' : ''}`}>
        {domesticRegion === 'asia' ? (
          <AsiaMap hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} />
        ) : (
          <AustraliaMap cityHeat={cityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} zoomOrigin={auOrigin} ambientSpikes={ambientSpikes} hubSpikes={skillSpikes} />
        )}
      </div>
      <div className={`globescene ${globalOut ? 'sceneshow' : ''}`}>
        <GlobeMap hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} onContinent={goDomestic} ambientSpikes={globalAmbientSpikes} hubSpikes={globalSpikes} />
      </div>
    </div>
  );
}
