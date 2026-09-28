import { useAppStore } from "../state/store";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { GLOBAL_HUB_LABEL } from "../data/geo";
import { isReleasedPlace } from "../lib/markets";

/**
 * Names the role the city map is highlighting, and clears it.
 *
 * A role picked on the career pathways map lights the companies that
 * advertised it and fades the rest (see PerthMapbox's skillDemandOf). A skill
 * search announces itself in the search bar; a role has no such place, and a
 * map that stays faded after the card closes with nothing saying why reads as
 * broken. So this says what the fade is and how many of the role's
 * advertisers are in the city in view — counted against the city's own roster,
 * because a company with no pin here cannot be lit here.
 *
 * FROM THE GLOBE IT OFFERS THE CITY. Company pins exist only in a city, and
 * the app opens on the globe, so "zoom into a city" alone leaves the reader
 * guessing which one. The button flies to the released city holding the most
 * of this role's advertisers.
 */
export function RoleFocusChip() {
  const focus = useAppStore((s) => s.roleFocus);
  const localCity = useAppStore((s) => s.localCity);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const clear = useAppStore((s) => s.setRoleFocus);
  const zoomInCity = useAppStore((s) => s.zoomInCity);
  const seesAll = useAppStore((s) => s.role) === "admin";
  if (!focus) return null;

  const nameOf = (city: string) =>
    GLOBAL_HUB_LABEL[city] || city.charAt(0).toUpperCase() + city.slice(1);
  const inCity = (city: string) =>
    (CITY_COMPANIES[city] || []).filter((c) => focus.companies[c.id]).length;
  const here = inCity(localCity);
  const total = Object.keys(focus.companies).length;
  // The city worth flying to: most of this role's advertisers, released only.
  let best: string | null = null;
  let bestN = 0;
  for (const city of Object.keys(CITY_COMPANIES)) {
    if (!seesAll && !isReleasedPlace(city)) continue;
    const n = inCity(city);
    if (n > bestN) [best, bestN] = [city, n];
  }
  const where = zoomedOut
    ? `${total} ${total === 1 ? "company" : "companies"} advertised it`
    : here
      ? `${here} ${here === 1 ? "company" : "companies"} in ${nameOf(localCity)}`
      : `none in ${nameOf(localCity)} — ${total} elsewhere`;
  const go = best && (zoomedOut || !here) ? best : null;

  return (
    <div className="rolechip" role="status">
      <span className="rolechiptxt">
        <span className="rolechiplbl">Advertised</span>
        <b>{focus.title}</b>
        <span className="rolechipsub">{where}</span>
        {go && (
          <button type="button" className="rolechipgo" onClick={() => zoomInCity(go)}>
            Show {bestN} in {nameOf(go)} →
          </button>
        )}
      </span>
      <button
        type="button"
        className="rolechipx"
        aria-label="Clear role highlight"
        onClick={() => clear(null)}
      >
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
