import { useAppStore } from "../state/store";
import { SUPPLY_MAX_SCALE, SUPPLY_MIN_SCALE } from "../lib/localSupply";

/**
 * The key for supply mode's local layer: a company's pin is sized by its
 * workforce (lib/localSupply.ts, PerthMapbox's setMarkerSupply). Without it
 * the sizes read as importance, or as nothing at all.
 *
 * Styled as the demand keys are ("SKILL DEMAND  LOW ▬ HIGH"), with circles in
 * place of the gradient, drawn at the pins' own smallest, middle and largest
 * scales so the key shows the actual range rather than an illustration of it.
 *
 * Shown only where the sizing is: the local layer, supply mode, and not while
 * a career-card role is picked — the pins then carry that role's ads instead
 * (see skillDemandOf), and a size key over them would describe the wrong map.
 */
const DOT = 12;
const MID = (SUPPLY_MIN_SCALE + SUPPLY_MAX_SCALE) / 2;

export function SupplyKey() {
  const show = useAppStore(
    (s) => s.marketMode === "supply" && !s.zoomedOut && !s.zoomingIn && !s.roleFocus,
  );
  if (!show) return null;
  return (
    <div className="supplykey" aria-label="Pin size shows workforce size">
      <span className="supplykeylbl">Workforce size</span>
      <span className="supplykeyend">Small</span>
      {[SUPPLY_MIN_SCALE, MID, SUPPLY_MAX_SCALE].map((k) => (
        <span
          key={k}
          className="supplykeydot"
          style={{ width: DOT * k, height: DOT * k }}
          aria-hidden
        />
      ))}
      <span className="supplykeyend">Large</span>
    </div>
  );
}
