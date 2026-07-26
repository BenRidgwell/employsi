import { useAppStore } from "../state/store";

/**
 * The left action rail, built from `Action Banner - Mechanical.dc.html` in the
 * Employsi Design System project.
 *
 * The first attempt at this re-homed three existing components (MapActions,
 * ZoomSlider, HelpDock) inside a rail wrapper and overrode their CSS. That
 * preserved their handlers but could never look like the design: the rail is a
 * purpose-built structure with its own icon set, its own grouping and its own
 * interaction states, none of which can be reached by restyling three unrelated
 * DOM shapes. So the markup is the design's, and the behaviour is wired to the
 * same store actions those components already used — nothing about what a button
 * DOES changed, only what it is.
 *
 * The panels each button opens still live in their original components
 * (HelpDock keeps the help tour, settings and feedback board; the trending and
 * brief panes are their own components). Only the buttons moved here.
 *
 * Three groups, exactly as the design's renderVals() returns them:
 *   tools   — What's trending, Daily brief
 *   layers  — Global / Domestic / Local / Company, as one grouped cluster
 *   helpers — Feedback, Help, Settings
 */

// Icon paths are the design's own, so the rail's iconography matches the rest of
// the system rather than being three components' worth of unrelated glyphs.
const ICON = {
  trending: ["M3 17 9 11l4 4 8-8", "M15 7h6v6"],
  brief: [
    "M4.5 5.5A1.5 1.5 0 0 1 6 4h12a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5z",
    "M8 9h8",
    "M8 12.5h6",
    "M8 16h4",
  ],
  global: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
    "M3 12h18",
    "M12 3c3.2 3.6 3.2 14.4 0 18",
    "M12 3c-3.2 3.6-3.2 14.4 0 18",
  ],
  domestic: ["M3 9.5 12 4l9 5.5", "M6.5 11v6", "M12 11v6", "M17.5 11v6", "M4 20h16"],
  local: [
    "M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0Z",
    "M12 10a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8",
  ],
  company: [
    "M9 7V5.5A2.5 2.5 0 0 1 11.5 3h1A2.5 2.5 0 0 1 15 5.5V7",
    "M5.5 7h13A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-8A2.5 2.5 0 0 1 5.5 7",
    "M3 12.5h18",
  ],
  feedback: [
    "M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 4V5.5A2.5 2.5 0 0 1 6.5 3h12A2.5 2.5 0 0 1 21 5.5Z",
    "M8.5 10h.01",
    "M12.5 10h.01",
    "M16.5 10h.01",
  ],
  help: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
    "M9.6 9.4a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.6",
    "M12 17.2h.01",
  ],
  settings: [
    "M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8",
    "M12 3.4v2.6",
    "M12 18v2.6",
    "M20.6 12H18",
    "M6 12H3.4",
    "M18 6l-1.8 1.8",
    "M7.8 16.2 6 18",
    "M18 18l-1.8-1.8",
    "M7.8 7.8 6 6",
  ],
} as const;

function RailIcon({ paths }: { paths: readonly string[] }) {
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" aria-hidden>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function RailButton({
  paths,
  label,
  on,
  onClick,
  disabled,
}: {
  paths: readonly string[];
  label: string;
  on?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`railbtn${on ? " on" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
    >
      <RailIcon paths={paths} />
      {/* Tooltip to the right of the rail, per the design. Kept out of the flow
          so it can never widen the 52px column. */}
      <span className="railtip">{label}</span>
    </button>
  );
}

export function ActionRail() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const selectedId = useAppStore((s) => s.selectedId);

  const toggleTrending = useAppStore((s) => s.toggleTrending);
  const trendingOpen = useAppStore((s) => s.trendingOpen);
  const toggleBrief = useAppStore((s) => s.toggleBrief);
  const briefOpen = useAppStore((s) => s.briefOpen);

  const setZoomLevel = useAppStore((s) => s.setZoomLevel);
  const closePanel = useAppStore((s) => s.closePanel);
  const openCompanyLayer = useAppStore((s) => s.openCompanyLayer);

  const toggleFeedback = useAppStore((s) => s.toggleFeedback);
  const toggleHelpTour = useAppStore((s) => s.toggleHelpTour);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const settingsOpen = useAppStore((s) => s.settingsOpen);

  // Which layer is current. A company card open is the deepest layer and takes
  // precedence; otherwise zoomedOut/globalOut pick the map tier. Same rule the
  // ZoomSlider used, kept verbatim so the indicator can't disagree with it.
  const companyOpen = selectedId != null;
  const layer = companyOpen ? "company" : !zoomedOut ? "local" : globalOut ? "global" : "domestic";

  // Navigating to a map tier closes any open company card first.
  const goTo = (n: 0 | 1 | 2) => {
    if (companyOpen) closePanel();
    setZoomLevel(n);
  };

  return (
    <div className="actionrail">
      {/* Tools. Only meaningful on the overview layers — the panes they open are
          market-wide, not city-local — so they drop out in the local view, as
          MapActions did before. */}
      {zoomedOut && (
        <div className="railgroup">
          <RailButton
            paths={ICON.trending}
            label="What's trending"
            on={trendingOpen}
            onClick={toggleTrending}
          />
          <RailButton paths={ICON.brief} label="Daily brief" on={briefOpen} onClick={toggleBrief} />
        </div>
      )}

      {/* Layers, as the design's sunken cluster — reads as "these four are one
          control, pick one". */}
      <div className="railgroup railgroup-tray">
        <RailButton
          paths={ICON.global}
          label="Global"
          on={layer === "global"}
          onClick={() => goTo(2)}
        />
        <RailButton
          paths={ICON.domestic}
          label="Domestic"
          on={layer === "domestic"}
          onClick={() => goTo(1)}
        />
        <RailButton
          paths={ICON.local}
          label="Local"
          on={layer === "local"}
          onClick={() => goTo(0)}
        />
        <RailButton
          paths={ICON.company}
          label="Company"
          on={layer === "company"}
          onClick={openCompanyLayer}
        />
      </div>

      <div className="railgroup">
        <RailButton paths={ICON.feedback} label="Submit feedback" onClick={toggleFeedback} />
        <RailButton paths={ICON.help} label="Need help?" onClick={toggleHelpTour} />
        <RailButton
          paths={ICON.settings}
          label="Settings"
          on={settingsOpen}
          onClick={toggleSettings}
        />
      </div>
    </div>
  );
}
