import { useAppStore } from '../../state/store';
import { activeSkillKey } from '../../data/geo';
import { AU_SCATTER, GLOBAL_SCATTER } from '../../data/scatter';
import { computeCityHeat, computeGlobalHeat, computeSkillSpikes, computeAmbientSpikes, computeGlobalSpikes, computeGlobalAmbientSpikes } from '../../lib/heat';
import { AustraliaMap } from './AustraliaMap';
import { GlobeMap } from './GlobeMap';

export function ZoomOverlay() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const zoomingIn = useAppStore((s) => s.zoomingIn);
  const globalOut = useAppStore((s) => s.globalOut);
  const heat = useAppStore((s) => s.heat);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const onAuWheel = useAppStore((s) => s.onAuWheel);
  const setGlobalOut = useAppStore((s) => s.setGlobalOut);

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
        <AustraliaMap cityHeat={cityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} ambientSpikes={ambientSpikes} hubSpikes={skillSpikes} />
      </div>
      <div className={`globescene ${globalOut ? 'sceneshow' : ''}`}>
        <GlobeMap hubHeat={globalCityHeat} heatDim={heatDim} onZoomInCity={zoomInCity} onAustralia={() => setGlobalOut(false)} ambientSpikes={globalAmbientSpikes} hubSpikes={globalSpikes} />
      </div>
    </div>
  );
}
