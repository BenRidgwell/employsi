import { useEffect, useState } from "react";
import { useAppStore } from "../state/store";
import { FeedbackBoard } from "./FeedbackBoard";
import { NotificationBell } from "./NotificationBell";
import { IconClose, IconFeedback, IconHelp, IconSettings } from "./ActionIcons";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { REGION_HUBS } from "../data/mapboxWorldGeo";
import { CITY_LABEL, GLOBAL_HUB_LABEL } from "../data/geo";

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

/**
 * The contextual tour, rewritten against what the app can actually do.
 *
 * The previous copy had gone stale as the app outgrew it: it named four cities
 * with employers when there are now 52, described the domestic layer as
 * Australia when there are five regions, called the global layer "worldwide
 * mining & energy hubs" when the roster covers the whole labour market, and
 * mentioned none of what has been built since — the left rail, Ask an analyst,
 * What's trending, the daily brief, following, comparing, or the company card's
 * live vacancy data.
 *
 * The city and region names are read from the data rather than listed here, so
 * this cannot drift out of date the same way again: add a city to the roster and
 * the help text picks it up.
 */

/** Cities on a region's domestic map that actually have employers plotted. */
function citiesIn(region: string): string[] {
  const hubs = REGION_HUBS[region] ?? [];
  return hubs.filter((h) => (CITY_COMPANIES[h]?.length ?? 0) > 0);
}

function cityLabel(city: string): string {
  return GLOBAL_HUB_LABEL[city] || CITY_LABEL[city] || city;
}

/** "Perth, Melbourne and 8 others" — a readable list that never runs long. */
function nameList(keys: string[], show = 3): string {
  const names = keys.map(cityLabel);
  if (!names.length) return "";
  if (names.length <= show + 1) {
    return names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  }
  return `${names.slice(0, show).join(", ")} or ${names.length - show} others`;
}

const REGION_LABEL: Record<string, string> = {
  australia: "Australia & New Zealand",
  asia: "Asia",
  india: "India",
  northamerica: "North America",
  europe: "Europe",
  africa: "Africa",
};

function tourFor(layer: Layer, city: string, region: string, hasCard: boolean) {
  if (layer === "local") {
    const name = cityLabel(city);
    const n = CITY_COMPANIES[city]?.length ?? 0;
    if (!n) {
      return {
        title: `${name} — city view`,
        sub: "No employers mapped here yet",
        steps: [
          `Nothing is plotted in ${name} yet — the 3D city is ready for employers to be added.`,
          "Pan, zoom and right-drag to rotate the streetscape.",
          "Scroll out to step back to the regional view.",
        ],
      };
    }
    // Once a card is open the useful advice is about the card, not the map.
    if (hasCard) {
      return {
        title: `${name} — company profile`,
        sub: "Reading an employer's card",
        steps: [
          "Open roles is every current vacancy we hold for this employer, deduped by title across all the job boards we read.",
          "The vacancy chart is the same figure day by day, and stops at yesterday because the boards are scraped overnight.",
          "Search a role to narrow the card to it — the list is what they are advertising right now.",
          "Compare puts two employers side by side; Follow saves this one to your account.",
          "Close the card, or scroll out, to go back to the map.",
        ],
      };
    }
    return {
      title: `${name} — city view`,
      sub: `${n} employers on the local map`,
      steps: [
        "Each dot is an employer's office, shaded by the heat metric you have selected.",
        "Click a dot to open its card: live vacancies, pay, skills in demand and recent news.",
        "Search a skill in the header to shade the map by who is hiring for it.",
        "Use the left rail to filter by sector, or to ask the analyst about this city.",
        "Scroll out to step back to the regional view.",
      ],
    };
  }

  if (layer === "domestic") {
    const label = REGION_LABEL[region] || region;
    const cities = citiesIn(region);
    return {
      title: `${label} — regional view`,
      sub: `${cities.length} cities with employers mapped`,
      steps: [
        "Each city glows by the metric you have selected — salary, growth or turnover.",
        cities.length
          ? `Click ${nameList(cities)} to drop into that city's employer map.`
          : "No cities in this region have employers mapped yet.",
        "Search a skill to see where in the region it is being hired.",
        "Ask an analyst answers questions about this region from the vacancy archive.",
        "Scroll out again for the world view.",
      ],
    };
  }

  return {
    title: "World view",
    sub: "Every market Employsi covers",
    steps: [
      "Each hub glows by the selected metric. Click one to drop into its region.",
      "The ticker along the bottom is live skill demand across every job feed.",
      "What's trending ranks the skills rising and falling fastest — in whatever area you are looking at.",
      "The daily brief is that morning's employer news, by sector.",
      "Search any company or skill in the header to jump straight to it.",
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
  // The tour also reacts to the region you are over and to whether a company
  // card is open, so the local-layer steps talk about the card when there is
  // one to read rather than about the map behind it.
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const selectedId = useAppStore((s) => s.selectedId);
  const open = useAppStore((s) => s.helpTourOpen);
  const toggleHelpTour = useAppStore((s) => s.toggleHelpTour);
  const closeHelpTour = useAppStore((s) => s.closeHelpTour);
  const fbOpen = useAppStore((s) => s.feedbackOpen);
  const toggleFeedback = useAppStore((s) => s.toggleFeedback);
  const closeFeedback = useAppStore((s) => s.closeFeedback);

  // zoomedOut takes precedence, same reasoning as the rail's layer indicator.
  const layer: Layer = !zoomedOut ? "local" : globalOut ? "global" : "domestic";
  // What counts as "somewhere new" for the help nudge. The region is part of it
  // now that the domestic layer is five regions rather than just Australia —
  // moving from Asia to Europe changes which cities the steps name.
  const layerKey = layer === "local" ? `local-${localCity}` : `${layer}-${domesticRegion}`;

  const [peek, setPeek] = useState(false);

  // Pop the help button briefly whenever the user lands on a new layer/city.
  useEffect(() => {
    setPeek(true);
    closeHelpTour();
    const t = setTimeout(() => setPeek(false), 4200);
    return () => clearTimeout(t);
  }, [layerKey, closeHelpTour]);

  const tour = tourFor(layer, localCity, domesticRegion, !!selectedId);
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

      {/* Far left of the header cluster, next to Feedback, per the brief. It is
          not a DockButton: it owns its own panel, badge and ring animation, and
          it answers a click differently when signed out. */}
      <NotificationBell />

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
