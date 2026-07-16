import { create } from 'zustand';
import { COMPANIES, companyGroup, type Company } from '../data/companies';
import { CITY_CONTINENT } from '../data/geo';
import type { HeatMetric } from '../lib/heat';

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
  activeSectors: string[];
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
  toggleSector: (cat: string) => void;
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
  activeSectors: [],
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
  followedIds: persisted.followedIds,

  select: (id) => set({ selectedId: id, lastId: id, interacted: true, searchOpen: false, filterOpen: false, heatOpen: false, briefOpen: false, trendingOpen: false }),
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
  openAuth: () => set({ authOpen: true, searchOpen: false, filterOpen: false }),
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
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
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
  toggleSector: (cat) =>
    set((s) => {
      const has = s.activeSectors.includes(cat);
      return { activeSectors: has ? s.activeSectors.filter((x) => x !== cat) : [...s.activeSectors, cat] };
    }),
  setMinSalary: (v) => set({ minSalary: v }),
  setMinHeadcount: (v) => set({ minHeadcount: v }),
  setMinGrowth: (v) => set({ minGrowth: v }),
  setMaxAttrition: (v) => set({ maxAttrition: v }),
  clearFilters: () => set({ activeSectors: [], minSalary: 130, minHeadcount: 0, minGrowth: 0, maxAttrition: 16 }),
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

  toggleBrief: () => set((s) => ({ briefOpen: !s.briefOpen, trendingOpen: false })),
  closeBrief: () => set({ briefOpen: false }),
  toggleTrending: () => set((s) => ({ trendingOpen: !s.trendingOpen, briefOpen: false })),
  closeTrending: () => set({ trendingOpen: false }),
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

// The remaining filters (search text + numeric sliders) that DIM a company that
// is still shown. Sector is handled separately by matchesSector (hide), so it's
// deliberately not repeated here.
export function companyMatches(c: Company, s: FilterState): boolean {
  const q = s.searchQuery.trim().toLowerCase();
  const qOk =
    !q ||
    c.name.toLowerCase().includes(q) ||
    c.ticker.toLowerCase().includes(q) ||
    c.skills.some((sk) => sk.toLowerCase().includes(q)) ||
    c.roles.some((r) => r.title.toLowerCase().includes(q));
  const salaryOk = c.salaryNum >= s.minSalary * 1000;
  const headcountOk = c.headcount >= s.minHeadcount;
  const growthOk = c.growth >= s.minGrowth;
  const attritionOk = c.turnover <= s.maxAttrition;
  return qOk && salaryOk && headcountOk && growthOk && attritionOk;
}

export function isSearchActive(s: Pick<FilterState, 'searchQuery'>): boolean {
  return s.searchQuery.trim() !== '';
}

export function isFilterActive(s: FilterState): boolean {
  return s.activeSectors.length > 0 || s.minSalary > 130 || s.minHeadcount > 0 || s.minGrowth > 0 || s.maxAttrition < 16;
}
