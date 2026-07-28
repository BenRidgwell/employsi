import { useAppStore } from "../state/store";
import { COMPANIES, type Company } from "../data/companies";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { GLOBAL_HUB_LABEL } from "../data/geo";

/**
 * The local layer's banner, from `Employsi Local View Banner.html`.
 *
 * Replaces two separate pieces of chrome that were saying related things in
 * different corners: the "local view" city pill (top centre) and the summary
 * stats bar (bottom left). The design folds them into one pill in the
 * bottom-left corner — an ink chip naming the city, then the figures for it,
 * divided by hairlines.
 *
 * Every figure is counted from the employers actually plotted on this city's
 * map, so it always describes what you are looking at rather than a fixed
 * Perth-wide total.
 */
export function LocalBanner() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const localCity = useAppStore((s) => s.localCity);

  // Only on the local layer. The overview layers have their own summary (the
  // markers themselves), and this banner names a single city.
  if (zoomedOut) return null;

  const byId = new Map(COMPANIES.map((c) => [c.id, c] as const));
  const companies = (CITY_COMPANIES[localCity] || [])
    .map((c) => byId.get(c.id))
    .filter((c): c is Company => !!c);

  const totalRoles = companies.reduce((a, c) => a + c.openRoles, 0);
  const totalHeads = Math.round(companies.reduce((a, c) => a + c.headcount, 0) / 1000);
  const cityName =
    GLOBAL_HUB_LABEL[localCity] || localCity.charAt(0).toUpperCase() + localCity.slice(1);

  const stats: [string, string][] = [
    [companies.length.toLocaleString("en-AU"), "employers"],
    [totalRoles.toLocaleString("en-AU"), "open roles"],
    [`${totalHeads.toLocaleString("en-AU")}K`, `${cityName} workforce`],
  ];

  return (
    <div className="lvb" key={localCity}>
      <div className="lvbcity">
        <span className="lvbdot" />
        <span className="lvbname">{cityName}</span>
        <span className="lvbkicker">LOCAL VIEW</span>
      </div>
      <div className="lvbstats">
        {stats.map(([value, label]) => (
          <div className="lvbstat" key={label}>
            <span className="lvbvalue">{value}</span>
            <span className="lvblabel">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
