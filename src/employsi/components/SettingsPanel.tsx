import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "../state/store";
import { getBillingState, openBillingPortal } from "../lib/billingFn";
import { APP_VERSION } from "../version";
import { IconClose } from "./ActionIcons";

/**
 * The settings card, built from `Settings_Popout.html`.
 *
 * The design's structure is followed exactly: a header with a round close
 * control, three labelled groups (Appearance / Notifications / Regional)
 * separated by hairlines with mono eyebrows, and a footer carrying the version
 * beside "Reset to defaults" and "Done".
 *
 * Its GEOMETRY is not, and deliberately. The design is drawn as a standalone
 * 860x760 canvas and sized accordingly — 440px wide, 26px gutters, a 24px
 * title, a body that never scrolls. This is a popout hanging off a header
 * button, so it is built to the same shell as Alerts and the Feedback board:
 * one width, one gutter, a capped height with only the body scrolling. See the
 * `.setpanel` block in global.css.
 *
 * WHAT IS AND ISN'T WIRED, AND WHY THAT IS VISIBLE
 * The design ships seven controls. Two of them we can honestly back today:
 *
 *   Reduce motion   — sets .reduce-motion on <html>; the CSS already respects it
 *   Use my location — asks the browser, then jumps to the nearest tracked hub
 *
 * "Place labels" was a third, and was removed on 2026-09-30. The labels are
 * simply always on now; WorldMapbox still has the effect that makes that true
 * (the basemap config hides them, the effect turns them back on), and its
 * comment says so. The persisted flag went with the control — leaving it would
 * have stranded anyone who had turned labels OFF with no way to turn them
 * back on.
 *
 * The other three cannot be backed without inventing something:
 *
 *   Night mode      — no dark theme exists. The design ALREADY marks this one
 *                     "Coming soon", which is the honest treatment; it is worth
 *                     noting the shipped app currently has a night-mode switch
 *                     that flips a stored boolean and changes nothing, so this
 *                     is a correction, not a regression.
 *   Weekly digest   — there is no mail sender. A switch here would be a promise
 *                     the product does not keep.
 *   Currency        — salaries are already shown in the currency the SOURCE
 *                     quoted. Converting between them needs FX rates we do not
 *                     hold, and a converted salary that is silently wrong is
 *                     worse than an unconverted one that is right.
 *
 * LANGUAGE IS NOT HERE, and was until 2026-10-02. It had the same honest
 * treatment as the rest — a disabled "English (UK)" select with a Coming soon
 * chip — but it was the one row whose placeholder said nothing a visitor did
 * not already know: the app is in English, they are reading it, and the row
 * only promised that one day it might not be. The others each name a real
 * capability the product is missing. Removed rather than disabled, so the card
 * is shorter and every row left on it is a thing worth waiting for.
 *
 * Rather than drop them (which loses the design) or ship them live (which lies),
 * the remaining three use the design's own "Coming soon" pattern: disabled
 * control, muted label, chip. The card then says exactly what the product can
 * do.
 *
 * There is no separate admin variant. Everything here is a per-device display
 * preference, and an admin's map differs only in which markets are released —
 * that comes from the account, not from a setting anyone should be able to flip.
 * So both roles get this card; the admin's extra reach is shown, read-only, at
 * the foot of Appearance when it applies.
 */

// The shipped version lives in employsi/version.ts, which also carries the
// rule for when it is bumped and is what the production deploy reads and tags.
// Keeping it there rather than here is what stops the number a user reads
// drifting from the number the release history records.

function Switch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`stswitch${on ? " on" : ""}`}
      onClick={() => !disabled && onChange(!on)}
    >
      <span className="stswitchknob" />
    </button>
  );
}

function Soon() {
  return <span className="stsoon">Coming soon</span>;
}

function Row({
  title,
  sub,
  soon,
  children,
}: {
  title: string;
  sub: string;
  soon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`strow${soon ? " muted" : ""}`}>
      <div className="strowtext">
        <span className="strowtitle">
          {title}
          {soon && <Soon />}
        </span>
        <span className="strowsub">{sub}</span>
      </div>
      <div className="strowctl">{children}</div>
    </div>
  );
}

/**
 * Subscription: status, and the way to manage or cancel it — Stripe's
 * customer portal (openBillingPortal). The terms (site/terms.ts, clause 4)
 * point here, so this row is a promise, not a convenience.
 *
 * Shown only where it means something: on a Worker that takes payments, to an
 * account that has a subscription in this Worker's Stripe mode. An admin with
 * no subscription, or a deployment without Stripe, sees nothing rather than a
 * button that cannot work.
 *
 * "Paid until", not "renews on": a subscription cancelled in the portal stays
 * active to the end of its period, and that date is true either way.
 */
function SubscriptionGroup() {
  const q = useQuery({
    queryKey: ["billing-state"],
    queryFn: () => getBillingState(),
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const b = q.data;
  if (!b?.payments || !b.status) return null;

  const until = b.currentPeriodEnd
    ? new Date(b.currentPeriodEnd * 1000).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  const sub = b.active
    ? `Active${until ? ` · paid until ${until}` : ""}. Cancel, change card or get invoices.`
    : `Not active (${b.status.replace(/_/g, " ")}). Update your payment details or invoices.`;

  const open = async () => {
    setBusy(true);
    setErr(null);
    const r = await openBillingPortal().catch(() => ({ error: "Could not reach the server." }));
    if ("url" in r) {
      window.location.assign(r.url);
      return; // leaving the page; keep the button disabled
    }
    setErr(r.error);
    setBusy(false);
  };

  return (
    <div className="stgroup">
      <span className="steyebrow">Subscription</span>
      <Row title="employsi subscription" sub={err ?? sub}>
        <button type="button" className="stghost stoutline" onClick={open} disabled={busy}>
          {busy ? "Opening…" : "Manage subscription"}
        </button>
      </Row>
    </div>
  );
}

export function SettingsPanel() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);
  const locating = useAppStore((s) => s.locating);
  const useMyLocation = useAppStore((s) => s.useMyLocation);
  const isAdmin = useAppStore((s) => s.role) === "admin";

  // Place labels used to be reset here too. They are always on now and have no
  // stored flag, so there is nothing left to put back.
  const resetDefaults = () => {
    setReduceMotion(false);
  };

  return (
    <div className="dockpanel setpanel">
      {/* Title + caption on one line, the way the tour's hub header carries
          "Need help?  WORLD VIEW". The caption used to open the body below;
          it is a caveat about the panel's SCOPE — these settings are this
          device's, not the account's — which is the same job the tour's
          eyebrow does, so it belongs beside the title rather than competing
          with the first real setting for the reader's attention. */}
      <div className="sthead">
        <div className="stheadleft">
          <span className="sttitle">Settings</span>
          <span className="stcap">Preferences apply to this device</span>
        </div>
        <button className="paneclose" onClick={closeSettings} aria-label="Close">
          <IconClose />
        </button>
      </div>

      <div className="stbody">
        <SubscriptionGroup />

        <div className="stgroup">
          <span className="steyebrow">Appearance</span>

          <Row title="Night mode" sub="A dark colour theme for the map." soon>
            <Switch on={false} onChange={() => {}} label="Toggle night mode" disabled />
          </Row>

          <Row title="Reduce motion" sub="Minimise map and interface animations.">
            <Switch on={reduceMotion} onChange={setReduceMotion} label="Toggle reduce motion" />
          </Row>

          {/* Read-only, and only when it applies: an admin sees markets that are
              not released publicly yet. It is stated because it changes what the
              map shows, and hidden for everyone else because it would otherwise
              advertise a mode they cannot enter. */}
          {isAdmin && (
            <div className="strow muted">
              <div className="strowtext">
                <span className="strowtitle">Market access</span>
                <span className="strowsub">
                  Your account sees every market, including those not yet released. This comes from
                  your role, not from a setting.
                </span>
              </div>
              <div className="strowctl">
                <span className="stsoon">Admin</span>
              </div>
            </div>
          )}
        </div>

        <div className="stgroup">
          <span className="steyebrow">Notifications</span>
          <Row
            title="Weekly digest"
            sub="One email each Monday summarising activity for the companies you follow."
            soon
          >
            <Switch on={false} onChange={() => {}} label="Toggle weekly digest" disabled />
          </Row>
        </div>

        <div className="stgroup">
          <span className="steyebrow">Regional</span>

          <div className="strow muted stinline">
            <span className="strowtitle">
              Currency
              <Soon />
            </span>
            <div className="stseg" aria-disabled>
              <button type="button" className="stsegbtn on" disabled>
                Local
              </button>
              <button type="button" className="stsegbtn" disabled>
                AUD
              </button>
            </div>
          </div>

          <Row title="Use my location" sub="Centre the map on where you are.">
            <Switch
              on={useMyLocation}
              onChange={(v) => useAppStore.getState().setUseMyLocation(v)}
              label="Toggle use my location"
              disabled={locating}
            />
          </Row>
        </div>
      </div>

      <div className="stfoot">
        <span className="stver">{APP_VERSION}</span>
        <div className="stfootbtns">
          <button type="button" className="stghost" onClick={resetDefaults}>
            Reset to defaults
          </button>
          <button type="button" className="stprimary" onClick={closeSettings}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
