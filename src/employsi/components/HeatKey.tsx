import { useAppStore } from '../state/store';
import { activeSkill } from '../lib/skillHeat';
import { heatLegend, auHeatLegend, globalHeatLegend, skillLegend } from '../lib/heat';

export function HeatKey() {
  const heat = useAppStore((s) => s.heat);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const skill = activeSkill(searchQuery);

  const key = globalOut
    ? skill
      ? skillLegend(skill)
      : globalHeatLegend(heat)
    : skill && zoomedOut
      ? skillLegend(skill)
      : zoomedOut
        ? auHeatLegend(heat)
        : heatLegend(heat);

  return (
    <div className="heatkey">
      <div className="hkrow">
        <span className="hktitle">{key.title}</span>
      </div>
      <div className="hkbar" />
      <div className="hkrow">
        <span className="hkv">{key.lo}</span>
        <span className="hkmute">Low → High</span>
        <span className="hkv">{key.hi}</span>
      </div>
    </div>
  );
}
