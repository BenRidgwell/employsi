import { useAppStore } from "../state/store";
import { COMPANIES, type Company } from "../data/companies";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { IVI_MONTHS } from "../data/iviSkillDemand";
import { activeSkill } from "../lib/skillHeat";
import { cityEmployment, localSupplyFor } from "../lib/localSupply";

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
 *
 * IN SUPPLY MODE IT CARRIES THE SKILL FIGURE THE PINS CANNOT. There is no
 * employees-by-company-by-skill source, so a company pin can only say how big
 * the employer is (see lib/localSupply.ts). The searched skill is answered here
 * instead, at the grain the data actually has: the whole city, from ABS.
 */
export function LocalBanner() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const localCity = useAppStore((s) => s.localCity);
  const marketMode = useAppStore((s) => s.marketMode);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const heatMonth = useAppStore((s) => s.heatMonth);

  // Only on the local layer. The overview layers have their own summary (the
  // markers themselves), and this banner names a single city.
  if (zoomedOut) return null;

  const byId = new Map(COMPANIES.map((c) => [c.id, c] as const));
  const companies = (CITY_COMPANIES[localCity] || [])
    .map((c) => byId.get(c.id))
    .filter((c): c is Company => !!c);

  const cityName =
    GLOBAL_HUB_LABEL[localCity] || localCity.charAt(0).toUpperCase() + localCity.slice(1);

  // FILED STAFF ONLY, and this used to sum `c.headcount` over every company.
  // That field is derived from hash01(ticker + name) for the 805 `illustrative`
  // roster records — so the "city workforce" figure was substantially a sum of
  // hashes of company names, printed to the pixel as "142K". localSupplyFor
  // returns null for those, and the count of employers behind the total is shown
  // beside it so the figure is never mistaken for the city's whole workforce.
  const filed = companies.map(localSupplyFor);
  const filedStaff = filed.reduce((a, s) => a + (s?.n ?? 0), 0);
  const filedCount = filed.filter((s) => !!s).length;

  const stats: [string, string][] = [[companies.length.toLocaleString("en-AU"), "employers"]];

  if (marketMode === "supply") {
    stats.push([
      filedStaff >= 1000
        ? `${Math.round(filedStaff / 1000).toLocaleString("en-AU")}K`
        : filedStaff.toLocaleString("en-AU"),
      `staff at ${filedCount.toLocaleString("en-AU")} filed`,
    ]);
    // The skill's employment for the whole city, from ABS in the Australian
    // capitals and the 2023 Census in Auckland and Wellington. Null everywhere
    // else, and a null is SAID rather than filled in from a covered city.
    //
    // THE LABEL COMES FROM THE FIGURE, NOT FROM THE SEARCH BOX. New Zealand's
    // grain is the ANZSCO sub-major group, so a Nursing search there returns the
    // Health Professionals total and must say "Health Professionals" — see
    // CityEmployment. Writing `skill` here would turn a true number into a false
    // sentence, which is the one thing that type exists to stop.
    const skill = activeSkill(searchQuery);
    if (skill) {
      const emp = cityEmployment(skill, localCity, IVI_MONTHS[heatMonth] ?? "");
      stats.push(
        emp === null
          ? ["—", `no ${skill} employment for ${cityName}`]
          : [emp.n.toLocaleString("en-AU"), `${emp.label} employed · ${emp.source} ${emp.asof}`],
      );
    }
  } else {
    stats.push([
      companies.reduce((a, c) => a + c.openRoles, 0).toLocaleString("en-AU"),
      "open roles",
    ]);
    stats.push([
      `${Math.round(filedStaff / 1000).toLocaleString("en-AU")}K`,
      `staff at ${filedCount.toLocaleString("en-AU")} employers`,
    ]);
  }

  return (
    <div className="lvb" key={localCity} data-tour="banner">
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
