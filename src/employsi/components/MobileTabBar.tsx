import { useAppStore, isFilterActive, type FilterState } from '../state/store';

// The single mobile navigation bar. On phones the scattered desktop docks
// (top-bar controls, the trending/brief rail, the tools + help docks) are
// hidden; this fixed bottom bar becomes the one launcher for them, driving the
// same store flags those controls use. It only shows on the bare map — opening
// any sheet or a company card hides it, so a full-height sheet never has to
// fight the bar for the bottom edge.

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.6" y2="16.6" />
  </svg>
);
const FilterIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="17" x2="14" y2="17" />
  </svg>
);
const TrendingIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15l4.5-5 3.5 3.5L20 6" /><path d="M15 6h5v5" />
  </svg>
);
const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

export function MobileTabBar() {
  const selectedId = useAppStore((s) => s.selectedId);
  const compareOpen = useAppStore((s) => s.compareOpen);
  const authOpen = useAppStore((s) => s.authOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const feedbackOpen = useAppStore((s) => s.feedbackOpen);
  const helpTourOpen = useAppStore((s) => s.helpTourOpen);
  const briefOpen = useAppStore((s) => s.briefOpen);

  const searchOpen = useAppStore((s) => s.searchOpen);
  const filterOpen = useAppStore((s) => s.filterOpen);
  const trendingOpen = useAppStore((s) => s.trendingOpen);
  const mobileMenuOpen = useAppStore((s) => s.mobileMenuOpen);

  const toggleSearch = useAppStore((s) => s.toggleSearch);
  const toggleFilter = useAppStore((s) => s.toggleFilter);
  const toggleTrending = useAppStore((s) => s.toggleTrending);
  const toggleMobileMenu = useAppStore((s) => s.toggleMobileMenu);

  const activeSectors = useAppStore((s) => s.activeSectors);
  const activeExchanges = useAppStore((s) => s.activeExchanges);
  const minSalary = useAppStore((s) => s.minSalary);
  const minHeadcount = useAppStore((s) => s.minHeadcount);
  const minGrowth = useAppStore((s) => s.minGrowth);
  const maxAttrition = useAppStore((s) => s.maxAttrition);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const filterState: FilterState = { searchQuery, activeSectors, activeExchanges, minSalary, minHeadcount, minGrowth, maxAttrition };
  const filterActive = isFilterActive(filterState);

  // Only show on the bare map: any open overlay (a sheet, the company card, the
  // account/settings/feedback/help panels) takes over the screen instead.
  // Trending is the exception — its pane sits above the bar, so the bar stays
  // put and its tab keeps highlighting while trending is open.
  const overlayOpen =
    selectedId || compareOpen || authOpen || settingsOpen || feedbackOpen || helpTourOpen ||
    briefOpen || searchOpen || filterOpen || mobileMenuOpen;
  if (overlayOpen) return null;

  const tabs = [
    { id: 'search', label: 'Search', icon: <SearchIcon />, on: searchOpen, dot: false, onClick: toggleSearch },
    { id: 'filter', label: 'Filter', icon: <FilterIcon />, on: filterOpen, dot: filterActive, onClick: toggleFilter },
    { id: 'trending', label: 'Trending', icon: <TrendingIcon />, on: trendingOpen, dot: false, onClick: toggleTrending },
    { id: 'more', label: 'More', icon: <MoreIcon />, on: mobileMenuOpen, dot: false, onClick: toggleMobileMenu },
  ];

  return (
    <nav className="mtabbar" aria-label="Main">
      {tabs.map((t) => (
        <button key={t.id} className={`mtab ${t.on ? 'on' : ''}`} onClick={t.onClick} aria-label={t.label}>
          <span className="mtabic">
            {t.icon}
            {t.dot && <span className="mtabdot" />}
          </span>
          <span className="mtablbl">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
