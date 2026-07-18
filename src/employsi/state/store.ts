import { create } from 'zustand';
import { COMPANIES, companyGroup, companyExchange, type Company } from '../data/companies';
import { CITY_CONTINENT } from '../data/geo';
import { CITY_COMPANIES } from '../data/mapboxGeo';
import type { HeatMetric } from '../lib/heat';
import type { SkillIndex } from '../lib/skillsFn';

export interface Account {
  name: string;
  email: string;
}

export interface AppState {
  account: Account | null;
  authOpen: boolean;
  pendingFollowId: string | null;
  // Transient notification text (e.g. "sign in to follow"); null when hidden.
  toast: string | null;
  settingsOpen: boolean;
  reduceMotion: boolean;
  // UI stub only — not wired to any visual behaviour yet.
  nightMode: boolean;
  selectedId: string | null;
  lastId: string | null;
  interacted: boolean;
  heat: HeatMetric;
  searchOpen: boolean;
  filterOpen: boolean;
  heatOpen: boolean;
  searchQuery: string;
  // Live skill-demand index from the jobs pipeline (loaded from KV). Drives the
  // real skill-demand heat map when a skill is the active search.
  skillIndex: SkillIndex | null;
  activeSectors: string[];
  activeExchanges: string[];
  minSalary: number;
  minHeadcount: number;
  minGrowth: number;
  maxAttrition: number;
  zoomedOut: boolean;
  zoomingIn: boolean;
  globalOut: boolean;
  localCity: string;
  domesticRegion: string;
  compareOpen: boolean;
  compareA: string | null;
  compareB: string | null;
  briefOpen: boolean;
  trendingOpen: boolean;
  // Feedback board + help-tour open state. Lifted here (Settings already is) so
  // the mobile "More" sheet can open them alongside the desktop dock buttons.
  feedbackOpen: boolean;
  helpTourOpen: boolean;
  // The mobile bottom-bar "More" sheet.
  mobileMenuOpen: boolean;
  followedIds: string[];

  select: (id: string) => void;
  toggleFollow: (id: string) => void;
  requestFollow: (id: string) => void;
  dismissToast: () => void;
  openAuth: () => void;
  closeAuth: () => void;
  signUp: (name: string, email: string) => void;
  signIn: (email: string) => void;
  signOut: () => void;
  toggleSettings: () => void;
  closeSettings: () => void;
  setReduceMotion: (v: boolean) => void;
  setNightMode: (v: boolean) => void;
  closePanel: () => void;
  setHeat: (h: HeatMetric) => void;
  setInteracted: () => void;

  toggleSearch: () => void;
  toggleFilter: () => void;
  toggleHeatPanel: () => void;
  setSearchQuery: (q: string) => void;
  clearSearch: () => void;
  setSkillIndex: (idx: SkillIndex | null) => void;
  toggleSector: (cat: string) => void;
  toggleExchange: (ex: string) => void;
  setMinSalary: (v: number) => void;
  setMinHeadcount: (v: number) => void;
  setMinGrowth: (v: number) => void;
  setMaxAttrition: (v: number) => void;
  clearFilters: () => void;
  toggleSkillQuery: (skill: string) => void;

  setZoomedOut: (v: boolean) => void;
  zoomOutToDomestic: () => void;
  setZoomingIn: (v: boolean) => void;
  setGlobalOut: (v: boolean) => void;
  setZoomLevel: (n: 0 | 1 | 2) => void;
  zoomIn: () => void;
  zoomInCity: (city: string) => void;
  goDomestic: (region: string) => void;
  globalBack: () => void;
  onAuWheel: (deltaY: number, region?: string) => void;

  openCompare: (id: string) => void;
  closeCompare: () => void;
  setCompareA: (id: string) => void;
  setCompareB: (id: string) => void;

  toggleBrief: () => void;
  closeBrief: () => void;
  toggleTrending: () => void;
  closeTrending: () => void;

  toggleFeedback: () => void;
  closeFeedback: () => void;
  toggleHelpTour: () => void;
  closeHelpTour: () => void;
  toggleMobileMenu: () => void;
  closeMobileMenu: () => void;
}

// Persist the account + saved-companies across reloads. There's no backend
// auth here — sign-up/sign-in are simulated and the "session" lives entirely in
// localStorage, so a returning visitor keeps their account and favourites.
const LS_KEY = 'employsi.auth';
interface Persisted {
  account: Account | null;
  followedIds: string[];
  reduceMotion: boolean;
  nightMode: boolean;
}
const PERSIST_DEFAULTS: Persisted = { account: null, followedIds: [], reduceMotion: false, nightMode: false };
function loadPersisted(): Persisted {
  if (typeof localStorage === 'undefined') return PERSIST_DEFAULTS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return PERSIST_DEFAULTS;
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      account: p.account ?? null,
      followedIds: Array.isArray(p.followedIds) ? p.followedIds : [],
      reduceMotion: p.reduceMotion ?? false,
      nightMode: p.nightMode ?? false,
    };
  } catch {
    return PERSIST_DEFAULTS;
  }
}
function savePersisted(p: Persisted): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* private-mode / quota — non-fatal, the session just won't persist */
  }
}
const persisted = loadPersisted();

// Reflect the reduce-motion preference on the root element as early as possible
// so animations are suppressed before first paint when it's on.
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('reduce-motion', persisted.reduceMotion);
}

let zoomTimer: ReturnType<typeof setTimeout> | undefined;

// Barrier between the three map layers: once a layer change happens, ignore
// further wheel-driven changes for this long so a single scroll gesture can't
// skip a layer (e.g. Perth straight to Global).
const LAYER_COOLDOWN = 700;
let lastLayerChange = 0;
const markLayerChange = () => {
  lastLayerChange = Date.now();
};
const layerLocked = () => Date.now() - lastLayerChange < LAYER_COOLDOWN;

export const useAppStore = create<AppState>((set, get) => ({
  account: persisted.account,
  authOpen: false,
  pendingFollowId: null,
  toast: null,
  settingsOpen: false,
  reduceMotion: persisted.reduceMotion,
  nightMode: persisted.nightMode,
  selectedId: null,
  lastId: null,
  interacted: false,
  heat: 'salary',
  searchOpen: false,
  filterOpen: false,
  heatOpen: false,
  searchQuery: '',
  skillIndex: null,
  activeSectors: [],
  activeExchanges: [],
  minSalary: 130,
  minHeadcount: 0,
  minGrowth: 0,
  maxAttrition: 16,
  zoomedOut: true,
  zoomingIn: false,
  globalOut: true,
  localCity: 'perth',
  domesticRegion: 'australia',
  compareOpen: false,
  compareA: null,
  compareB: null,
  briefOpen: false,
  trendingOpen: false,
  feedbackOpen: false,
  helpTourOpen: false,
  mobileMenuOpen: false,
  followedIds: persisted.followedIds,

  select: (id) => set({ selectedId: id, lastId: id, interacted: true, searchOpen: false, filterOpen: false, heatOpen: false, briefOpen: false, trendingOpen: false, feedbackOpen: false, helpTourOpen: false, mobileMenuOpen: false }),
  toggleFollow: (id) =>
    set((s) => ({
      followedIds: s.followedIds.includes(id) ? s.followedIds.filter((x) => x !== id) : [...s.followedIds, id],
    })),
  // Following is the account feature: signed-out visitors are prompted to
  // create an account first, and the company they tapped is saved for them the
  // moment they do (see signUp/signIn).
  requestFollow: (id) => {
    const s = get();
    if (!s.account) {
      // Not signed in — notify with a toast and open the account panel (with the
      // tapped company remembered so it's saved the moment they sign up).
      set({
        authOpen: true,
        pendingFollowId: id,
        searchOpen: false,
        filterOpen: false,
        toast: 'Create a free account or sign in to follow companies',
      });
      return;
    }
    set({ followedIds: s.followedIds.includes(id) ? s.followedIds.filter((x) => x !== id) : [...s.followedIds, id] });
  },
  dismissToast: () => set({ toast: null }),
  openAuth: () => set({ authOpen: true, searchOpen: false, filterOpen: false, mobileMenuOpen: false }),
  closeAuth: () => set({ authOpen: false, pendingFollowId: null }),
  signUp: (name, email) =>
    set((s) => {
      const followedIds =
        s.pendingFollowId && !s.followedIds.includes(s.pendingFollowId) ? [...s.followedIds, s.pendingFollowId] : s.followedIds;
      return { account: { name: name.trim(), email: email.trim() }, authOpen: false, pendingFollowId: null, followedIds };
    }),
  signIn: (email) =>
    set((s) => {
      // Derive a display name from the email local-part (no real user record).
      const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
      const name = local ? local.replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'You';
      const followedIds =
        s.pendingFollowId && !s.followedIds.includes(s.pendingFollowId) ? [...s.followedIds, s.pendingFollowId] : s.followedIds;
      return { account: { name, email: email.trim() }, authOpen: false, pendingFollowId: null, followedIds };
    }),
  signOut: () => set({ account: null, authOpen: false, pendingFollowId: null }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen, feedbackOpen: false, helpTourOpen: false })),
  closeSettings: () => set({ settingsOpen: false }),
  setReduceMotion: (v) => {
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('reduce-motion', v);
    set({ reduceMotion: v });
  },
  // Stub only — persisted for continuity but not wired to any theme yet.
  setNightMode: (v) => set({ nightMode: v }),
  closePanel: () => set({ selectedId: null }),
  setHeat: (h) => set({ heat: h }),
  setInteracted: () => set((s) => (s.interacted ? s : { interacted: true })),

  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen, filterOpen: false, heatOpen: false })),
  toggleFilter: () => set((s) => ({ filterOpen: !s.filterOpen, searchOpen: false, heatOpen: false })),
  toggleHeatPanel: () => set((s) => ({ heatOpen: !s.heatOpen, searchOpen: false, filterOpen: false })),
  setSearchQuery: (q) => set({ searchQuery: q }),
  clearSearch: () => set({ searchQuery: '' }),
  setSkillIndex: (idx) => set({ skillIndex: idx }),
  toggleSector: (cat) =>
    set((s) => {
      const has = s.activeSectors.includes(cat);
      return { activeSectors: has ? s.activeSectors.filter((x) => x !== cat) : [...s.activeSectors, cat] };
    }),
  toggleExchange: (ex) =>
    set((s) => {
      const has = s.activeExchanges.includes(ex);
      return { activeExchanges: has ? s.activeExchanges.filter((x) => x !== ex) : [...s.activeExchanges, ex] };
    }),
  setMinSalary: (v) => set({ minSalary: v }),
  setMinHeadcount: (v) => set({ minHeadcount: v }),
  setMinGrowth: (v) => set({ minGrowth: v }),
  setMaxAttrition: (v) => set({ maxAttrition: v }),
  clearFilters: () => set({ activeSectors: [], activeExchanges: [], minSalary: 130, minHeadcount: 0, minGrowth: 0, maxAttrition: 16 }),
  toggleSkillQuery: (skill) =>
    set((s) => {
      const on = s.searchQuery.trim().toLowerCase() === skill.toLowerCase();
      return on ? { searchQuery: '' } : { searchQuery: skill, zoomedOut: true, searchOpen: false, interacted: true };
    }),

  setZoomedOut: (v) => {
    if (v) markLayerChange();
    set({ zoomedOut: v });
  },
  // Scrolling/zooming out of a local city's map: land on that city's own
  // continent's domestic view, not whatever domesticRegion was last left at.
  zoomOutToDomestic: () => {
    const s = get();
    markLayerChange();
    set({ zoomedOut: true, globalOut: false, domesticRegion: CITY_CONTINENT[s.localCity] || 'australia', interacted: true });
  },
  setZoomingIn: (v) => set({ zoomingIn: v }),
  setGlobalOut: (v) => set({ globalOut: v }),
  setZoomLevel: (n) => {
    const s = get();
    const cur = s.globalOut ? 2 : s.zoomedOut ? 1 : 0;
    if (n === cur) return;
    if (n === 0) { get().zoomIn(); return; }
    if (n === 1) {
      // Leaving local for domestic: land on the current city's own continent.
      // Coming from global there's no "current" city context, so fall back
      // to Australia.
      const region = cur === 0 ? CITY_CONTINENT[s.localCity] || 'australia' : 'australia';
      set({ zoomedOut: true, globalOut: false, domesticRegion: region, interacted: true });
      return;
    }
    set({ zoomedOut: true, globalOut: true, interacted: true });
  },
  // Re-enter whichever city we last viewed (defaults to Perth), so the Local
  // zoom button / back gesture doesn't snap away from e.g. Toronto to Perth.
  zoomIn: () => get().zoomInCity(get().localCity || 'perth'),
  zoomInCity: (city) => {
    const s = get();
    if (s.zoomingIn) return;
    markLayerChange();
    set({ zoomingIn: true, interacted: true, localCity: city });
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      set({ zoomedOut: false, zoomingIn: false, globalOut: false });
      window.dispatchEvent(new CustomEvent('perth-zoom-reset'));
    }, 680);
  },
  goDomestic: (region) => {
    markLayerChange();
    set({ globalOut: false, zoomedOut: true, domesticRegion: region, interacted: true });
  },
  globalBack: () => {
    const s = get();
    if (s.globalOut) set({ globalOut: false });
    else get().zoomIn();
  },
  onAuWheel: (deltaY, target) => {
    const s = get();
    // Hold at the current layer until the cooldown passes, so momentum from
    // the gesture that got us here can't immediately jump another layer.
    if (layerLocked()) return;
    if (Math.abs(deltaY) < 10) return; // require a firmer scroll to cross
    if (s.globalOut) {
      if (deltaY < 0) {
        markLayerChange();
        // Scroll into the continent under the cursor, defaulting to Australia.
        set({ globalOut: false, domesticRegion: target || 'australia', interacted: true });
      }
      return;
    }
    if (deltaY > 0) {
      markLayerChange();
      set({ globalOut: true, interacted: true });
    } else {
      // Scroll into the city hub nearest the cursor, defaulting to Perth.
      get().zoomInCity(target || 'perth');
    }
  },

  openCompare: (id) => {
    const other = COMPANIES.find((c) => c.id !== id);
    set({ compareOpen: true, compareA: id, compareB: other ? other.id : null, selectedId: null });
  },
  // Leaving compare returns to the company card the user opened it from
  // (lastId is that company — select() set it before compare replaced the card).
  closeCompare: () => set((s) => ({ compareOpen: false, selectedId: s.lastId })),
  setCompareA: (id) => set({ compareA: id }),
  setCompareB: (id) => set({ compareB: id }),

  toggleBrief: () => set((s) => ({ briefOpen: !s.briefOpen, trendingOpen: false, mobileMenuOpen: false })),
  closeBrief: () => set({ briefOpen: false }),
  toggleTrending: () => set((s) => ({ trendingOpen: !s.trendingOpen, briefOpen: false, mobileMenuOpen: false })),
  closeTrending: () => set({ trendingOpen: false }),

  toggleFeedback: () => set((s) => ({ feedbackOpen: !s.feedbackOpen, helpTourOpen: false, settingsOpen: false, mobileMenuOpen: false })),
  closeFeedback: () => set({ feedbackOpen: false }),
  toggleHelpTour: () => set((s) => ({ helpTourOpen: !s.helpTourOpen, feedbackOpen: false, settingsOpen: false, mobileMenuOpen: false })),
  closeHelpTour: () => set({ helpTourOpen: false }),
  toggleMobileMenu: () => set((s) => ({ mobileMenuOpen: !s.mobileMenuOpen, searchOpen: false, filterOpen: false, heatOpen: false })),
  closeMobileMenu: () => set({ mobileMenuOpen: false }),
}));

// Mirror account + saved companies + settings to localStorage whenever any of
// them change.
useAppStore.subscribe((s, prev) => {
  if (
    s.account !== prev.account ||
    s.followedIds !== prev.followedIds ||
    s.reduceMotion !== prev.reduceMotion ||
    s.nightMode !== prev.nightMode
  ) {
    savePersisted({ account: s.account, followedIds: s.followedIds, reduceMotion: s.reduceMotion, nightMode: s.nightMode });
  }
});

export interface FilterState {
  searchQuery: string;
  activeSectors: string[];
  activeExchanges: string[];
  minSalary: number;
  minHeadcount: number;
  minGrowth: number;
  maxAttrition: number;
}

// Does a company belong to (one of) the selected sectors? Used to HIDE
// non-matching companies on the local map. Every company categorises to
// Energy & Natural Resources, so selecting Financial Services (which none of
// them are) hides every company — exactly the intended behaviour.
export function matchesSector(c: Company, activeSectors: string[]): boolean {
  return !activeSectors.length || activeSectors.includes(companyGroup(c));
}

// Exchange filter — HIDES a company that isn't on any selected exchange, just
// like the sector filter. Both are applied to the local company layer.
export function matchesExchange(c: Company, activeExchanges: string[]): boolean {
  return !activeExchanges.length || activeExchanges.includes(companyExchange(c));
}

// The full "should this company be shown?" predicate: sector + exchange + the
// four numeric sliders, all HIDE (not dim). Each slider only constrains once
// moved off its default (its slider min/max), so the default state shows every
// company. Applied on the local map to hide non-matching companies, and via
// cityMatchesFilters to hide cities with no matching company.
export function matchesFilters(c: Company, s: FilterState): boolean {
  return (
    matchesSector(c, s.activeSectors) &&
    matchesExchange(c, s.activeExchanges) &&
    (s.minSalary <= 130 || c.salaryNum >= s.minSalary * 1000) &&
    (s.minHeadcount <= 0 || c.headcount >= s.minHeadcount) &&
    (s.minGrowth <= 0 || c.growth >= s.minGrowth) &&
    (s.maxAttrition >= 16 || c.turnover <= s.maxAttrition)
  );
}

// Does a company match the free-text search? Used only to DIM (not hide) — a
// company that fails the search still shows, just faded, so the map keeps its
// context. The sliders/sector/exchange filters do the hiding.
export function searchMatches(c: Company, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    c.name.toLowerCase().includes(q) ||
    c.ticker.toLowerCase().includes(q) ||
    (c.pill ? c.pill.toLowerCase().includes(q) : false) ||
    c.skills.some((sk) => sk.toLowerCase().includes(q)) ||
    c.roles.some((r) => r.title.toLowerCase().includes(q))
  );
}

// Backwards-compatible combined predicate (search + filters) — still used where
// a single "fully passes everything" check is convenient.
export function companyMatches(c: Company, s: FilterState): boolean {
  return searchMatches(c, s.searchQuery) && matchesFilters(c, s);
}

// A city is shown on the domestic/global layers only if it has at least one
// company that passes every active filter. With no filter active every city
// shows (unchanged default). A city with no companies at all is hidden the
// moment any filter is active.
let cityIndex: Map<string, Company> | null = null;
function companyById(id: string): Company | undefined {
  if (!cityIndex) cityIndex = new Map(COMPANIES.map((c) => [c.id, c]));
  return cityIndex.get(id);
}
export function cityMatchesFilters(city: string, s: FilterState): boolean {
  if (!isFilterActive(s)) return true;
  const list = CITY_COMPANIES[city];
  if (!list || !list.length) return false;
  return list.some((cc) => {
    const c = companyById(cc.id);
    return !!c && matchesFilters(c, s);
  });
}

export function isSearchActive(s: Pick<FilterState, 'searchQuery'>): boolean {
  return s.searchQuery.trim() !== '';
}

export function isFilterActive(s: FilterState): boolean {
  return s.activeSectors.length > 0 || s.activeExchanges.length > 0 || s.minSalary > 130 || s.minHeadcount > 0 || s.minGrowth > 0 || s.maxAttrition < 16;
}
