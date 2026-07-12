import { useAppStore } from '../state/store';
import { COMPANIES, type Company } from '../data/companies';
import { CITY_COMPANIES } from '../data/mapboxGeo';
import { GLOBAL_HUB_LABEL } from '../data/geo';

// Bottom summary bar. Reflects the city currently open on the local map — the
// employers actually plotted there, their combined open roles and workforce —
// rather than a fixed Perth-wide total.
export function Legend() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const localCity = useAppStore((s) => s.localCity);

  const byId = new Map(COMPANIES.map((c) => [c.id, c] as const));
  const companies = (CITY_COMPANIES[localCity] || [])
    .map((c) => byId.get(c.id))
    .filter((c): c is Company => !!c);

  const totalRoles = companies.reduce((a, c) => a + c.openRoles, 0);
  const totalHeads = Math.round(companies.reduce((a, c) => a + c.headcount, 0) / 1000) + 'K';
  const cityName = GLOBAL_HUB_LABEL[localCity] || localCity.charAt(0).toUpperCase() + localCity.slice(1);

  return (
    <div className={`legend ${zoomedOut ? 'zoomhide' : ''}`}>
      <span>
        <b>{companies.length}</b> employers
      </span>
      <span className="sep" />
      <span>
        <b>{totalRoles.toLocaleString('en-US')}</b> open roles
      </span>
      <span className="sep" />
      <span>
        <b>{totalHeads}</b> {cityName} workforce
      </span>
    </div>
  );
}
