import { useAppStore } from "../state/store";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { GLOBAL_HUB_LABEL } from "../data/geo";

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
 */
export function RoleFocusChip() {
  const focus = useAppStore((s) => s.roleFocus);
  const localCity = useAppStore((s) => s.localCity);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const clear = useAppStore((s) => s.setRoleFocus);
  if (!focus) return null;

  const cityName =
    GLOBAL_HUB_LABEL[localCity] || localCity.charAt(0).toUpperCase() + localCity.slice(1);
  const here = (CITY_COMPANIES[localCity] || []).filter((c) => focus.companies[c.id]).length;
  const total = Object.keys(focus.companies).length;
  const where = zoomedOut
    ? `${total} ${total === 1 ? "company" : "companies"} — zoom into a city to see them`
    : here
      ? `${here} ${here === 1 ? "company" : "companies"} in ${cityName}`
      : `none in ${cityName} — ${total} elsewhere`;

  return (
    <div className="rolechip" role="status">
      <span className="rolechiptxt">
        <span className="rolechiplbl">Advertised</span>
        <b>{focus.title}</b>
        <span className="rolechipsub">{where}</span>
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
