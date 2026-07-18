import { useAppStore } from '../state/store';
import { activeSkill } from '../lib/skillHeat';
import { skillLegend } from '../lib/heat';

// The map is neutral until a skill is searched, so the legend only appears then
// — showing the demand scale for the active skill.
export function HeatKey() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const skill = activeSkill(searchQuery);
  if (!skill) return null;
  const key = skillLegend(skill);

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
