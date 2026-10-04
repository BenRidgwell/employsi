import { useAppStore } from "../state/store";
import { setViewAsUser } from "../lib/persona";

/**
 * "Viewing as" — an administrator's switch between the admin and end-user
 * product, in the account panel.
 *
 * RENDERS NOWHERE IT SHOULD NOT. `persona.available` comes from the server and
 * is true only when the caller's TRUE role is admin AND the host is a preview
 * (lib/persona.ts). On production, and for everybody who is not an admin, this
 * returns null and there is no control to find.
 *
 * It is a genuine switch, not a UI filter: the persona travels as a cookie and
 * callerRole applies it at the single point every server function derives a
 * role from, so "User" serves the data an end user would actually get. A
 * version that only dimmed the UI would show admin figures inside an end-user
 * shell, which is a worse review than not looking at all.
 *
 * Two labelled buttons rather than a checkbox, because the two states are both
 * real personas and neither is "off" — and because the current one has to be
 * readable at a glance while reviewing something else.
 */
export function PersonaSwitch() {
  const persona = useAppStore((s) => s.persona);
  if (!persona.available) return null;

  const asUser = persona.viewingAsUser;
  return (
    <div className="psona">
      <span className="psonalbl">Viewing as</span>
      <div className="psonaseg" role="group" aria-label="Viewing as">
        <button
          type="button"
          className={`psonabtn${asUser ? "" : " on"}`}
          aria-pressed={!asUser}
          // The reload inside setViewAsUser is what makes the change take, so
          // a click while already on this persona is skipped rather than
          // costing a pointless round trip.
          onClick={() => asUser && setViewAsUser(false)}
        >
          Admin
        </button>
        <button
          type="button"
          className={`psonabtn${asUser ? " on" : ""}`}
          aria-pressed={asUser}
          onClick={() => !asUser && setViewAsUser(true)}
        >
          User
        </button>
      </div>
      <span className="psonanote">
        {asUser
          ? "Seeing what an end user sees. Preview only — the page reloads."
          : "Your real role. Switch to User to review the end-user product."}
      </span>
    </div>
  );
}
