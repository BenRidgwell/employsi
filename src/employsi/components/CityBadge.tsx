import { useAppStore } from '../state/store';
import { GLOBAL_HUB_LABEL } from '../data/geo';

// Small indicator of which local city map you're currently viewing. Only shows
// on the local layer (hidden on the Australia / global views).
export function CityBadge() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const localCity = useAppStore((s) => s.localCity);
  const selectedId = useAppStore((s) => s.selectedId);
  const compareOpen = useAppStore((s) => s.compareOpen);
  // Hide on the overview layers, and when a panel is covering the map.
  if (zoomedOut || selectedId || compareOpen) return null;
  // Use the shared hub-label map so every city (incl. the finance hubs) shows
  // its real name instead of silently falling back to "Perth".
  const name = GLOBAL_HUB_LABEL[localCity] || localCity.charAt(0).toUpperCase() + localCity.slice(1);
  return (
    <div className="citybadge" key={localCity}>
      <span className="citybadgedot" />
      <span className="citybadgename">{name}</span>
      <span className="citybadgesub">local view</span>
    </div>
  );
}
