import { useMutation } from "@tanstack/react-query";
import { useAppStore } from "../state/store";
import { markWelcomeSeen } from "../lib/onboardingFn";
import { EmploysiMark } from "../../components/EmploysiLogo";

/**
 * The first-run welcome card: the front door to the guided tour.
 *
 * Shown ONCE PER ACCOUNT, on the first visit after signing up — the server
 * decides (lib/onboardingFn.ts), not localStorage, because "first login" is a
 * fact about the account and not about the browser. App.tsx asks once per load
 * and only opens this when the answer is yes.
 *
 * "Start tour" runs the `orient` walkthrough, not the tour HUB. The hub is a
 * menu of five walkthroughs, and a button that says "Start tour" landing on a
 * menu has not started one. `orient` is the right one: it is the five-step
 * "get oriented" set the hub itself lists first, and it exists for both the
 * local and world layers, so this works wherever the map happens to be.
 *
 * BOTH BUTTONS MARK IT SEEN. Skipping is a decision, and a welcome card that
 * came back tomorrow because you declined it is worse than one you never saw.
 * The write is fire-and-forget: the card closes on click either way, because
 * making someone wait on a round trip to dismiss a greeting would be the one
 * thing more irritating than the greeting.
 */
export function WelcomeCard() {
  const open = useAppStore((s) => s.welcomeOpen);
  const account = useAppStore((s) => s.account);
  const setWelcomeOpen = useAppStore((s) => s.setWelcomeOpen);
  const startTour = useAppStore((s) => s.startTour);

  const seen = useMutation({ mutationFn: () => markWelcomeSeen() });

  // First name only. The provider gives a full name and "Welcome to employsi,
  // Ben Ridgwell." reads like a letter from a bank; an account with no name at
  // all drops the address rather than greeting an empty string.
  const first = (account?.name ?? "").trim().split(/\s+/)[0] ?? "";

  const dismiss = (thenTour: boolean) => {
    seen.mutate();
    setWelcomeOpen(false);
    if (thenTour) startTour("orient");
  };

  if (!open) return null;

  return (
    <div className="wcwrap" role="dialog" aria-modal="true" aria-labelledby="wctitle">
      {/* No click-away and no ✕: the two buttons are the only ways out, and
          both record the decision. A scrim that dismissed on a stray click
          would lose the tour silently AND mark it seen, so it could never be
          offered again. */}
      <div className="wcscrim" />
      <div className="wccard">
        <EmploysiMark size={34} className="wcmark" />
        <h2 className="wctitle" id="wctitle">
          Welcome to employsi{first ? `, ${first}` : ""}.
        </h2>
        <p className="wcbody">
          Take a 30-second tour to explore all the key features employsi has to offer, from
          discovering what skills are in high demand, to where companies are hiring talent from.
        </p>
        <div className="wcactions">
          <button type="button" className="wcbtn" onClick={() => dismiss(false)}>
            Skip for now
          </button>
          <button type="button" className="wcbtn primary" onClick={() => dismiss(true)} autoFocus>
            Start tour <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
