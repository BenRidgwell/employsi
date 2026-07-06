import { useAppStore } from '../state/store';
import { COMPANIES } from '../data/companies';

export function Legend() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const totalRoles = COMPANIES.reduce((a, c) => a + c.openRoles, 0);
  const totalHeads = (COMPANIES.reduce((a, c) => a + c.headcount, 0) / 1000).toFixed(0) + 'K';
  return (
    <div className={`legend ${zoomedOut ? 'zoomhide' : ''}`}>
      <span>
        <b>{COMPANIES.length}</b> employers
      </span>
      <span className="sep" />
      <span>
        <b>{totalRoles}</b> open roles
      </span>
      <span className="sep" />
      <span>
        <b>{totalHeads}</b> Perth workforce
      </span>
    </div>
  );
}
