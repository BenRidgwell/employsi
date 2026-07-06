import { create } from 'zustand';
import { COMPANIES, categorize, type Company } from '../data/companies';
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
  compareOpen: boolean;
  compareA: string | null;
  compareB: string | null;

  select: (id: string) => void;
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
  setZoomingIn: (v: boolean) => void;
  setGlobalOut: (v: boolean) => void;
  setZoomLevel: (n: 0 | 1 | 2) => void;
  zoomIn: () => void;
  globalBack: () => void;
  onAuWheel: (deltaY: number) => void;

  openCompare: (id: string) => void;
  closeCompare: () => void;
  setCompareA: (id: string) => void;
  setCompareB: (id: string) => void;
}

let zoomTimer: ReturnType<typeof setTimeout> | undefined;

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
  zoomedOut: false,
  zoomingIn: false,
  globalOut: false,
  compareOpen: false,
  compareA: null,
  compareB: null,

  select: (id) => set({ selectedId: id, lastId: id, interacted: true, searchOpen: false, filterOpen: false }),
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

  setZoomedOut: (v) => set({ zoomedOut: v }),
  setZoomingIn: (v) => set({ zoomingIn: v }),
  setGlobalOut: (v) => set({ globalOut: v }),
  setZoomLevel: (n) => {
    const s = get();
    const cur = s.globalOut ? 2 : s.zoomedOut ? 1 : 0;
    if (n === cur) return;
    if (n === 0) { get().zoomIn(); return; }
    if (n === 1) { set({ zoomedOut: true, globalOut: false, interacted: true }); return; }
    set({ zoomedOut: true, globalOut: true, interacted: true });
  },
  zoomIn: () => {
    const s = get();
    if (s.zoomingIn) return;
    set({ zoomingIn: true });
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      set({ zoomedOut: false, zoomingIn: false, globalOut: false });
      window.dispatchEvent(new CustomEvent('perth-zoom-reset'));
    }, 680);
  },
  globalBack: () => {
    const s = get();
    if (s.globalOut) set({ globalOut: false });
    else get().zoomIn();
  },
  onAuWheel: (deltaY) => {
    const s = get();
    if (s.globalOut) {
      if (deltaY < -8) set({ globalOut: false });
      return;
    }
    if (deltaY > 8) set({ globalOut: true });
    else if (deltaY < -8) get().zoomIn();
  },

  openCompare: (id) => {
    const other = COMPANIES.find((c) => c.id !== id);
    set({ compareOpen: true, compareA: id, compareB: other ? other.id : null, selectedId: null });
  },
  closeCompare: () => set({ compareOpen: false }),
  setCompareA: (id) => set({ compareA: id }),
  setCompareB: (id) => set({ compareB: id }),
}));

export interface FilterState {
  searchQuery: string;
  activeSectors: string[];
  minSalary: number;
  minHeadcount: number;
  minGrowth: number;
  maxAttrition: number;
}

export function companyMatches(c: Company, s: FilterState): boolean {
  const q = s.searchQuery.trim().toLowerCase();
  const qOk =
    !q ||
    c.name.toLowerCase().includes(q) ||
    c.ticker.toLowerCase().includes(q) ||
    c.skills.some((sk) => sk.toLowerCase().includes(q)) ||
    c.roles.some((r) => r.title.toLowerCase().includes(q));
  const cats = s.activeSectors;
  const sOk = !cats.length || cats.includes(categorize(c.sector));
  const salaryOk = c.salaryNum >= s.minSalary * 1000;
  const headcountOk = c.headcount >= s.minHeadcount;
  const growthOk = c.growth >= s.minGrowth;
  const attritionOk = c.turnover <= s.maxAttrition;
  return qOk && sOk && salaryOk && headcountOk && growthOk && attritionOk;
}

export function isSearchActive(s: Pick<FilterState, 'searchQuery'>): boolean {
  return s.searchQuery.trim() !== '';
}

export function isFilterActive(s: FilterState): boolean {
  return s.activeSectors.length > 0 || s.minSalary > 130 || s.minHeadcount > 0 || s.minGrowth > 0 || s.maxAttrition < 16;
}
