import { create } from 'zustand';
import { COMPANIES, categorize, type Company } from '../data/companies';
import { CITY_CONTINENT } from '../data/geo';
import type { HeatMetric } from '../lib/heat';

export interface AppState {
  selectedId: string | null;
  lastId: string | null;
  interacted: boolean;
  heat: HeatMetric;
  searchOpen: boolean;
  filterOpen: boolean;
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
  closePanel: () => void;
  setHeat: (h: HeatMetric) => void;
  setInteracted: () => void;

  toggleSearch: () => void;
  toggleFilter: () => void;
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
  selectedId: null,
  lastId: null,
  interacted: false,
  heat: 'salary',
  searchOpen: false,
  filterOpen: false,
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
  followedIds: [],

  select: (id) => set({ selectedId: id, lastId: id, interacted: true, searchOpen: false, filterOpen: false, briefOpen: false, trendingOpen: false }),
  toggleFollow: (id) =>
    set((s) => ({
      followedIds: s.followedIds.includes(id) ? s.followedIds.filter((x) => x !== id) : [...s.followedIds, id],
    })),
  closePanel: () => set({ selectedId: null }),
  setHeat: (h) => set({ heat: h }),
  setInteracted: () => set((s) => (s.interacted ? s : { interacted: true })),

  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen, filterOpen: false })),
  toggleFilter: () => set((s) => ({ filterOpen: !s.filterOpen, searchOpen: false })),
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
  closeCompare: () => set({ compareOpen: false }),
  setCompareA: (id) => set({ compareA: id }),
  setCompareB: (id) => set({ compareB: id }),

  toggleBrief: () => set((s) => ({ briefOpen: !s.briefOpen, trendingOpen: false })),
  closeBrief: () => set({ briefOpen: false }),
  toggleTrending: () => set((s) => ({ trendingOpen: !s.trendingOpen, briefOpen: false })),
  closeTrending: () => set({ trendingOpen: false }),
}));

export interface FilterState {
  searchQuery: string;
  activeSectors: string[];
  minSalary: number;
  minHeadcount: number;
  minGrowth: number;
  maxAttrition: number;
}

// Does a company belong to (one of) the selected sectors? Used to HIDE
// non-matching companies on the local map. A company categorises to
// Mining & Metals or Oil & Gas, so selecting Financial Services (which none of
// them are) hides every company — exactly the intended behaviour.
export function matchesSector(c: Company, activeSectors: string[]): boolean {
  return !activeSectors.length || activeSectors.includes(categorize(c.sector));
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
