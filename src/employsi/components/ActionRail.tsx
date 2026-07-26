import type { ReactNode } from "react";
import { useAppStore } from "../state/store";
import {
  IconAnalyst,
  IconBrief,
  IconCompany,
  IconDomestic,
  IconFilter,
  IconGlobal,
  IconLocal,
  IconTrending,
} from "./ActionIcons";

/**
 * The left action rail, built from `Employsi Action Banner.html`.
 *
 * That file supersedes `Action Banner - Mechanical.dc.html`, which the first
 * version of this component was built from. Three things changed:
 *
 *  1. Feedback / Help / Settings are NOT in the rail. The design puts them in a
 *     fixed cluster at the top right of the page; HelpDock owns that now.
 *  2. Filter IS in the rail, below the layer tray, with its panel opening
 *     beside it. It used to live in the header, which was flagged as the one
 *     control the earlier design had no home for.
 *  3. Every icon animates on hover and while selected — see ActionIcons.
 *
 * The design's first group is "What's trending" and "Ask an analyst"; Daily
 * brief is kept alongside them because it is real and already wired. The
 * analyst is now built (AnalystPane) and answers from the vacancy archive and
 * the national vacancy series rather than a language model.
 */

function RailButton({
  icon,
  label,
  on,
  onClick,
  size = "lg",
}: {
  icon: ReactNode;
  label: string;
  on?: boolean;
  onClick: () => void;
  /** "lg" = 38px standalone button, "sm" = 34px button inside the layer tray. */
  size?: "lg" | "sm";
}) {
  return (
    <button
      type="button"
      className={`railbtn railbtn-${size}${on ? " on" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
    >
      {icon}
      {/* Tooltip to the right of the rail. Kept out of the flow so it can never
          widen the column, and suppressed while selected — a selected button
          already says what it is, which is what the design's
          `opacity: … * (1 - var(--sel))` expresses. */}
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
  const toggleAnalyst = useAppStore((s) => s.toggleAnalyst);
  const analystOpen = useAppStore((s) => s.analystOpen);

  const setZoomLevel = useAppStore((s) => s.setZoomLevel);
  const closePanel = useAppStore((s) => s.closePanel);
  const openCompanyLayer = useAppStore((s) => s.openCompanyLayer);

  const filterOpen = useAppStore((s) => s.filterOpen);
  const toggleFilter = useAppStore((s) => s.toggleFilter);

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
      <RailButton
        icon={<IconTrending />}
        label="What's trending"
        on={trendingOpen}
        onClick={toggleTrending}
      />
      <RailButton
        icon={<IconAnalyst />}
        label="Ask an analyst"
        on={analystOpen}
        onClick={toggleAnalyst}
      />
      <RailButton icon={<IconBrief />} label="Daily brief" on={briefOpen} onClick={toggleBrief} />

      <span className="raildiv" />

      {/* The layer picker as the design's sunken tray — the four read as one
          control, "pick one", rather than as four unrelated buttons. */}
      <div className="railtray">
        <RailButton
          icon={<IconGlobal />}
          label="Global"
          size="sm"
          on={layer === "global"}
          onClick={() => goTo(2)}
        />
        <RailButton
          icon={<IconDomestic />}
          label="Domestic"
          size="sm"
          on={layer === "domestic"}
          onClick={() => goTo(1)}
        />
        <RailButton
          icon={<IconLocal />}
          label="Local"
          size="sm"
          on={layer === "local"}
          onClick={() => goTo(0)}
        />
        <RailButton
          icon={<IconCompany />}
          label="Company"
          size="sm"
          on={layer === "company"}
          onClick={openCompanyLayer}
        />
      </div>

      <span className="raildiv" />

      {/* The panel itself renders at the app root (see FilterPane) so it stays
          reachable from the mobile tab bar, where this rail is hidden. */}
      <RailButton icon={<IconFilter />} label="Filter" on={filterOpen} onClick={toggleFilter} />
    </div>
  );
}
