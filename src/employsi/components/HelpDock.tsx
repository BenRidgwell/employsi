import { useEffect, useState } from "react";
import { useAppStore } from "../state/store";
import { FeedbackBoard } from "./FeedbackBoard";
import { IconClose, IconFeedback, IconHelp, IconSettings } from "./ActionIcons";

/**
 * Feedback / Help / Settings, built from `Employsi Action Banner.html`.
 *
 * The design places these three NOT in the left rail but as a fixed cluster at
 * the top right of the page, each opening its panel directly beneath itself.
 * The first pass at the rail had put them in it, which is why they moved here.
 *
 * The dock renders inside the header's control row rather than as a free-
 * floating fixed element, so it can never collide with the account control that
 * shares the same corner — the design's own mock has that collision, since its
 * sign-in button is positioned at the same top/right coordinates as this
 * cluster. Landing at the header's right edge puts the buttons exactly where
 * the design shows them without the overlap.
 */

type Layer = "local" | "domestic" | "global";

const CITY_NAME: Record<string, string> = {
  perth: "Perth",
  melbourne: "Melbourne",
  brisbane: "Brisbane",
  adelaide: "Adelaide",
};
// Cities whose local map actually has company pins.
const CITIES_WITH_COMPANIES = new Set(["perth", "melbourne", "brisbane", "adelaide"]);

function tourFor(layer: Layer, city: string) {
  if (layer === "local") {
    const name = CITY_NAME[city] || "this city";
    const hasCompanies = CITIES_WITH_COMPANIES.has(city);
    return {
      title: `${name} — city view`,
      sub: "The local employer map",
      steps: [
        hasCompanies
          ? "Glowing dots are employers, shaded by the active heat metric."
          : `No companies are mapped in ${name} yet — the city layout is ready for them.`,
        "Pan, zoom and rotate (right-drag) to explore the streetscape.",
        hasCompanies
          ? "Click a dot or its pill to open the company profile."
          : "Switch the heat metric up top (Salary / Growth / Turnover).",
        "Scroll out to step back to the Australia view.",
      ],
    };
  }
  if (layer === "domestic") {
    return {
      title: "Australia — domestic view",
      sub: "National workforce overview",
      steps: [
        "Each city glows by the selected metric (Salary, Growth, Turnover).",
        "Click Perth, Adelaide or Brisbane to zoom into that city.",
        "Search a skill up top to reveal demand hotspots.",
        "Scroll out again for the global view.",
      ],
    };
  }
  return {
    title: "Global — world view",
    sub: "Worldwide mining & energy hubs",
    steps: [
      "Hubs glow by the selected metric across the continents.",
      "Click the AUSTRALIA label, or a city hub, to dive in.",
      "Use the left rail for trends and the daily brief.",
      "Scroll in to return to the Australia view.",
    ],
  };
}

function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`ngswitch ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span className="ngswitchknob" />
    </button>
  );
}

/** One 40px cluster button plus whatever panel it owns, anchored beneath it. */
function DockButton({
  icon,
  label,
  on,
  peek,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  on: boolean;
  /** Brief attention pop — a nudge, NOT the selected state, which would make
   *  the button read as "panel open" while nothing is open. */
  peek?: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="dockslot">
      <button
        type="button"
        className={`dockbtn${on ? " on" : ""}${peek ? " peek" : ""}`}
        onClick={onClick}
        aria-label={label}
        aria-pressed={on}
      >
        {icon}
        {/* Tooltip below the button, per the design, and suppressed while the
            button is selected. */}
        <span className="docktip">{label}</span>
      </button>
      {children}
    </div>
  );
}

export function HelpDock() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const localCity = useAppStore((s) => s.localCity);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);
  const nightMode = useAppStore((s) => s.nightMode);
  const setNightMode = useAppStore((s) => s.setNightMode);
  // Help-tour + feedback open state lives in the store, so the mobile "More"
  // sheet can drive the same panels as these dock buttons.
  const open = useAppStore((s) => s.helpTourOpen);
  const toggleHelpTour = useAppStore((s) => s.toggleHelpTour);
  const closeHelpTour = useAppStore((s) => s.closeHelpTour);
  const fbOpen = useAppStore((s) => s.feedbackOpen);
  const toggleFeedback = useAppStore((s) => s.toggleFeedback);
  const closeFeedback = useAppStore((s) => s.closeFeedback);

  // zoomedOut takes precedence, same reasoning as the rail's layer indicator.
  const layer: Layer = !zoomedOut ? "local" : globalOut ? "global" : "domestic";
  const layerKey = layer === "local" ? `local-${localCity}` : layer;

  const [peek, setPeek] = useState(false);

  // Pop the help button briefly whenever the user lands on a new layer/city.
  useEffect(() => {
    setPeek(true);
    closeHelpTour();
    const t = setTimeout(() => setPeek(false), 4200);
    return () => clearTimeout(t);
  }, [layerKey, closeHelpTour]);

  const tour = tourFor(layer, localCity);
  const anyPanelOpen = open || fbOpen || settingsOpen;

  return (
    <div className="helpdock">
      {/* Click-away scrim: tapping outside an open panel closes it. */}
      {anyPanelOpen && (
        <div
          className="dockscrim"
          onClick={() => {
            closeHelpTour();
            closeFeedback();
            closeSettings();
          }}
        />
      )}

      <DockButton icon={<IconFeedback />} label="Feedback" on={fbOpen} onClick={toggleFeedback}>
        {fbOpen && <FeedbackBoard onClose={closeFeedback} />}
      </DockButton>

      <DockButton
        icon={<IconHelp />}
        label="Need help?"
        on={open}
        peek={peek}
        onClick={toggleHelpTour}
      >
        {open && (
          <div className="dockpanel helppanel">
            <div className="dockhd">
              <div className="dockhdtext">
                <span className="docktitle">{tour.title}</span>
                <span className="docksub">{tour.sub}</span>
              </div>
              <button className="dockx" onClick={closeHelpTour} aria-label="Close">
                <IconClose />
              </button>
            </div>
            <ol className="helpsteps">
              {tour.steps.map((s, i) => (
                <li key={i}>
                  <span className="helpnum">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </DockButton>

      <DockButton
        icon={<IconSettings />}
        label="Settings"
        on={settingsOpen}
        onClick={toggleSettings}
      >
        {settingsOpen && (
          <div className="dockpanel setpanel">
            <div className="dockhd dockhdline">
              <span className="docktitle">Settings</span>
              <button className="dockx" onClick={closeSettings} aria-label="Close">
                <IconClose />
              </button>
            </div>
            <div className="setrow">
              <div>
                <div className="setlbl">Night mode</div>
                <div className="setsub">A dark colour theme for the map. Coming soon.</div>
              </div>
              <Switch on={nightMode} onChange={setNightMode} label="Toggle night mode" />
            </div>
            <div className="setrow">
              <div>
                <div className="setlbl">Reduce motion</div>
                <div className="setsub">Minimise map and interface animations.</div>
              </div>
              <Switch on={reduceMotion} onChange={setReduceMotion} label="Toggle reduce motion" />
            </div>
          </div>
        )}
      </DockButton>
    </div>
  );
}
