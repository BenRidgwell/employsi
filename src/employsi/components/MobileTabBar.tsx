import { useAppStore, isFilterActive, type FilterState } from "../state/store";

// The single mobile navigation bar. On phones the scattered desktop docks
// (top-bar controls, the action rail, the help dock) are hidden; this fixed
// bottom bar becomes the one launcher for them, driving the same store flags
// those controls use.
//
// The four tabs come from `Employsi_Mobile.html`: Trending, Analyst, Map,
// Filter. Two things changed from the earlier Search / Filter / Trending /
// More set, and both are the design's calls rather than ours:
//
//  1. SEARCH LEFT THE BAR. It is a persistent field under the wordmark now
//     (MobileSearch), so it costs no tap and no tab slot.
//  2. "MORE" IS GONE. Account, feedback, help and settings moved to the icon
//     row at the header's right edge, which is where the design puts them —
//     so the bar holds only the four surfaces you switch BETWEEN, not a
//     drawer of everything else.
//
// That frees the two slots Analyst and Map now occupy. Map is not a panel:
// it is the way back to the bare map, so it reads as selected exactly when
// nothing else is open.

const svg = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Icon paths lifted verbatim from the design's ICONS table. */
const Icon = ({ d }: { d: string[] }) => (
  <svg {...svg} width="21" height="21">
    {d.map((p) => (
      <path key={p} d={p} />
    ))}
  </svg>
);

const TRENDING = ["M3 17 9 11l4 4 8-8", "M15 7h6v6"];
const ANALYST = [
  "M12 8.5a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8",
  "M9.5 9 12 12.2 14.5 9",
  "M9.5 9 6.4 10.3A4.4 4.4 0 0 0 3.8 14.4V20h6.1",
  "M14.5 9l3.1 1.3a4.4 4.4 0 0 1 2.6 4.1V20h-6.1",
  "M10.6 12.9h2.8l-.7 3.1.9 3.9h-3.2l.9-3.9Z",
];
const MAP = [
  "M9.2 4.2 3.6 6.4v13.4l5.6-2.2 5.6 2.2 5.6-2.2V4.2l-5.6 2.2Z",
  "M9.2 4.2v13.4",
  "M14.8 6.4v13.4",
];
const FILTER = [
  "M3.5 7h17",
  "M3.5 12h17",
  "M3.5 17h17",
  "M9 7a2.1 2.1 0 1 0 0 .01",
  "M15.5 12a2.1 2.1 0 1 0 0 .01",
  "M7.5 17a2.1 2.1 0 1 0 0 .01",
];

export function MobileTabBar() {
  const selectedId = useAppStore((s) => s.selectedId);
  const compareOpen = useAppStore((s) => s.compareOpen);
  const authOpen = useAppStore((s) => s.authOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const feedbackOpen = useAppStore((s) => s.feedbackOpen);
  const helpTourOpen = useAppStore((s) => s.helpTourOpen);

  const filterOpen = useAppStore((s) => s.filterOpen);
  const trendingOpen = useAppStore((s) => s.trendingOpen);
  const analystOpen = useAppStore((s) => s.analystOpen);

  const toggleFilter = useAppStore((s) => s.toggleFilter);
  const toggleTrending = useAppStore((s) => s.toggleTrending);
  const toggleAnalyst = useAppStore((s) => s.toggleAnalyst);
  const closePanel = useAppStore((s) => s.closePanel);

  const activeSectors = useAppStore((s) => s.activeSectors);
  const listingType = useAppStore((s) => s.listingType);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const filterState: FilterState = {
    searchQuery,
    activeSectors,
    listingType,
    activeExchanges,
    minSalary,
    minHeadcount,
    minGrowth,
    maxAttrition,
  };
  const filterActive = isFilterActive(filterState);

  // The bar stays put whenever one of ITS OWN sheets is open: those float
  // above it so the user can switch straight to another tab. Only a true
  // full-screen takeover — the compare view, or the account / settings /
  // feedback / help panels — hides it.
  //
  // `selectedId` used to be in this list. The company card is a peek/full
  // sheet like the other three now, so the bar stays reachable behind it and
  // Map closes the card the same way it closes them.
  const fullTakeover = compareOpen || authOpen || settingsOpen || feedbackOpen || helpTourOpen;
  if (fullTakeover) return null;

  // "Map" is the bare map, so it is selected exactly when no sheet is up, and
  // pressing it closes whichever one is.
  //
  // Closing each explicitly rather than looping closeTopmost(): that helper
  // also owns the company card, compare and comingSoon, none of which this
  // tab should reach past — and a loop over it spins forever if any branch
  // ever reports "closed something" without changing state. The three toggles
  // are already mutually exclusive in the store, so at most one fires.
  const anySheet = trendingOpen || analystOpen || filterOpen || !!selectedId;
  const showMap = () => {
    if (trendingOpen) toggleTrending();
    if (analystOpen) toggleAnalyst();
    if (filterOpen) toggleFilter();
    if (selectedId) closePanel();
  };

  const tabs = [
    {
      id: "trending",
      label: "Trending",
      d: TRENDING,
      on: trendingOpen,
      dot: false,
      onClick: toggleTrending,
    },
    {
      id: "analyst",
      label: "Analyst",
      d: ANALYST,
      on: analystOpen,
      dot: false,
      onClick: toggleAnalyst,
    },
    { id: "map", label: "Map", d: MAP, on: !anySheet, dot: false, onClick: showMap },
    {
      id: "filter",
      label: "Filter",
      d: FILTER,
      on: filterOpen,
      dot: filterActive,
      onClick: toggleFilter,
    },
  ];

  return (
    <nav className="mtabbar" aria-label="Main">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`mtab ${t.on ? "on" : ""}`}
          onClick={t.onClick}
          aria-label={t.label}
          aria-pressed={t.on}
        >
          <span className="mtabic">
            <Icon d={t.d} />
            {t.dot && <span className="mtabdot" />}
          </span>
          <span className="mtablbl">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
