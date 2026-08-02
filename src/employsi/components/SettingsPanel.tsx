import { useAppStore } from "../state/store";
import { IconClose } from "./ActionIcons";

/**
 * The settings card, built from `Settings_Popout.html`.
 *
 * The design's structure is followed exactly: a 440px card, a header with a
 * round close control, three labelled groups (Appearance / Notifications /
 * Regional) separated by hairlines with mono eyebrows, and a footer carrying
 * the version beside "Reset to defaults" and "Done".
 *
 * WHAT IS AND ISN'T WIRED, AND WHY THAT IS VISIBLE
 * The design ships seven controls. Three of them we can honestly back today:
 *
 *   Reduce motion   — sets .reduce-motion on <html>; the CSS already respects it
 *   Place labels    — toggles Mapbox's own *-label symbol layers (WorldMapbox)
 *   Use my location — asks the browser, then jumps to the nearest tracked hub
 *
 * The other four cannot be backed without inventing something:
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
 *   Language        — there is no translation layer; switching the value would
 *                     relabel nothing.
 *
 * Rather than drop them (which loses the design) or ship them live (which lies),
 * they use the design's own "Coming soon" pattern: disabled control, muted
 * label, chip. The card then says exactly what the product can do.
 *
 * There is no separate admin variant. Everything here is a per-device display
 * preference, and an admin's map differs only in which markets are released —
 * that comes from the account, not from a setting anyone should be able to flip.
 * So both roles get this card; the admin's extra reach is shown, read-only, at
 * the foot of Appearance when it applies.
 */

const VERSION = "v2.4.1";

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

export function SettingsPanel() {
  const closeSettings = useAppStore((s) => s.closeSettings);
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);
  const placeLabels = useAppStore((s) => s.placeLabels);
  const setPlaceLabels = useAppStore((s) => s.setPlaceLabels);
  const locating = useAppStore((s) => s.locating);
  const useMyLocation = useAppStore((s) => s.useMyLocation);
  const isAdmin = useAppStore((s) => s.role) === "admin";

  const resetDefaults = () => {
    setReduceMotion(false);
    setPlaceLabels(true);
  };

  return (
    <div className="dockpanel setpanel">
      <div className="sthead">
        <div className="stheadtext">
          <span className="sttitle">Settings</span>
          <span className="stsubtitle">Preferences apply to this device.</span>
        </div>
        <button className="stclose" onClick={closeSettings} aria-label="Close">
          <IconClose />
        </button>
      </div>

      <div className="stbody">
        <div className="stgroup">
          <span className="steyebrow">Appearance</span>

          <Row title="Night mode" sub="A dark colour theme for the map." soon>
            <Switch on={false} onChange={() => {}} label="Toggle night mode" disabled />
          </Row>

          <Row title="Reduce motion" sub="Minimise map and interface animations.">
            <Switch on={reduceMotion} onChange={setReduceMotion} label="Toggle reduce motion" />
          </Row>

          <Row title="Place labels" sub="Show city and region names on the map.">
            <Switch on={placeLabels} onChange={setPlaceLabels} label="Toggle place labels" />
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

          <div className="strow muted stinline">
            <span className="strowtitle">
              Language
              <Soon />
            </span>
            <select className="stselect" value="en-GB" disabled aria-label="Language">
              <option value="en-GB">English (UK)</option>
            </select>
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
        <span className="stver">{VERSION}</span>
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
