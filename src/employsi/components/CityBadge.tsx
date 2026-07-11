import { useAppStore } from '../state/store';

const NAMES: Record<string, string> = { perth: 'Perth', brisbane: 'Brisbane', adelaide: 'Adelaide', singapore: 'Singapore', ganzhou: 'Ganzhou', toronto: 'Toronto', houston: 'Houston', denver: 'Denver' };

// Small indicator of which local city map you're currently viewing. Only shows
// on the local layer (hidden on the Australia / global views).
export function CityBadge() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const localCity = useAppStore((s) => s.localCity);
  const selectedId = useAppStore((s) => s.selectedId);
  const compareOpen = useAppStore((s) => s.compareOpen);
  // Hide on the overview layers, and when a panel is covering the map.
  if (zoomedOut || selectedId || compareOpen) return null;
  const name = NAMES[localCity] || 'Perth';
  return (
    <div className="citybadge" key={localCity}>
      <span className="citybadgedot" />
      <span className="citybadgename">{name}</span>
      <span className="citybadgesub">local view</span>
    </div>
  );
}
