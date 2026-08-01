import { create } from "zustand";
import type { Role } from "../lib/roles";
import {
  COMPANIES,
  companyGroup,
  companyExchange,
  companyListing,
  type Company,
  type ListingType,
} from "../data/companies";
import { CITY_CONTINENT } from "../data/geo";
import { CITY_COMPANIES, cityForCompany } from "../data/mapboxGeo";
import type { HeatMetric } from "../lib/heat";
import type { SkillIndex } from "../lib/skillsFn";
import { IVI_MONTHS } from "../data/iviSkillDemand";

export interface Account {
  /** Real user id from the auth provider. Absent only on a pre-auth leftover. */
  id?: string;
  name: string;
  email: string;
  image?: string;
}

export interface AppState {
  account: Account | null;
  /**
   * What this session may see, as told by the server (lib/roles.ts).
   *
   * PRESENTATION ONLY. Anyone can set this to "admin" in their own browser, so
   * it may hide controls but must never be the thing that protects data — every
   * privileged server function re-derives the role from the session cookie.
   * Defaults to "user", so a failed or slow session load shows the smaller
   * surface rather than briefly flashing the admin one.
   */
  role: Role;
  authOpen: boolean;
  pendingFollowId: string | null;
  pendingFollowSkill: string | null;
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
  // Index into IVI_MONTHS for the AU-domestic time slider (defaults to the
  // latest month). Lets the user scrub the skill heat map back to 2006.
  heatMonth: number;
  activeSectors: string[];
  // Master listing filter: null = any, else public / private. The exchange
  // filter (activeExchanges) is a drill-down that only applies under 'public'.
  listingType: ListingType | null;
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
  trendingOpen: boolean;
  // "Ask an analyst": a scoped Q&A over the live vacancy archive.
  analystOpen: boolean;
  // Feedback board + help-tour open state. Lifted here (Settings already is) so
  // the mobile "More" sheet can open them alongside the desktop dock buttons.
  feedbackOpen: boolean;
  helpTourOpen: boolean;
  // The mobile bottom-bar "More" sheet.
  mobileMenuOpen: boolean;
  followedIds: string[];
  followedSkills: string[];

  select: (id: string) => void;
  toggleFollow: (id: string) => void;
  requestFollow: (id: string) => void;
  toggleFollowSkill: (skill: string) => void;
  requestFollowSkill: (skill: string) => void;
  dismissToast: () => void;
  openAuth: () => void;
  closeAuth: () => void;
  /** Adopt (or clear) the session the server reported. */
  setSession: (a: Account | null) => void;
  setRole: (r: Role) => void;
  /** Sign-in buttons this deployment can offer; empty = not configured. */
  authProviders: ("google" | "linkedin")[];
  setAuthProviders: (p: ("google" | "linkedin")[]) => void;
  /** Replace follows wholesale with the account's server-side set. */
  setFollows: (ids: string[], skills: string[]) => void;
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
  setHeatMonth: (i: number) => void;
  toggleSector: (cat: string) => void;
  setListingType: (v: ListingType) => void;
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
  // Enter the "company" layer — the deepest level — by opening a company card
  // (the last-viewed one, or a sensible default for the current city).
  openCompanyLayer: () => void;
  zoomIn: () => void;
  zoomInCity: (city: string) => void;
  goDomestic: (region: string) => void;
  globalBack: () => void;
  onAuWheel: (deltaY: number, region?: string) => void;

  openCompare: (id: string) => void;
  closeCompare: () => void;
  setCompareA: (id: string) => void;
  setCompareB: (id: string) => void;

  toggleTrending: () => void;
  closeTrending: () => void;
  toggleAnalyst: () => void;
  closeAnalyst: () => void;

  toggleFeedback: () => void;
  closeFeedback: () => void;
  toggleHelpTour: () => void;
  closeHelpTour: () => void;
  toggleMobileMenu: () => void;
  closeMobileMenu: () => void;
}

// Device settings, plus whatever follows this browser holds.
//
// The ACCOUNT is no longer persisted here: the session is a signed httpOnly
// cookie the browser cannot read and JavaScript cannot forge, so who you are
// comes from the server on every load (getSession) rather than from a
// localStorage object anyone could edit. What stays is the follows — before
// signing in they are the only place a follow can live, and after signing in
// they are what the one-time claim hands over (see lib/followsFn.ts).
const LS_KEY = "employsi.auth";
interface Persisted {
  followedIds: string[];
  followedSkills: string[];
  reduceMotion: boolean;
  nightMode: boolean;
}
const PERSIST_DEFAULTS: Persisted = {
  followedIds: [],
  followedSkills: [],
  reduceMotion: false,
  nightMode: false,
};
function loadPersisted(): Persisted {
  if (typeof localStorage === "undefined") return PERSIST_DEFAULTS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return PERSIST_DEFAULTS;
    const p = JSON.parse(raw) as Partial<Persisted>;
    return {
      followedIds: Array.isArray(p.followedIds) ? p.followedIds : [],
      followedSkills: Array.isArray(p.followedSkills) ? p.followedSkills : [],
      reduceMotion: p.reduceMotion ?? false,
      nightMode: p.nightMode ?? false,
    };
  } catch {
    return PERSIST_DEFAULTS;
  }
}
function savePersisted(p: Persisted): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* private-mode / quota — non-fatal, the session just won't persist */
  }
}
const persisted = loadPersisted();

// Reflect the reduce-motion preference on the root element as early as possible
// so animations are suppressed before first paint when it's on.
if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("reduce-motion", persisted.reduceMotion);
}

// Write a follow through to the signed-in account. Lazily imported: the store
// is loaded by every component, and followsFn pulls in the auth stack, which
// has no business in that graph until something actually follows.
async function persistFollow(kind: "company" | "skill", ref: string, on: boolean): Promise<void> {
  try {
    const { setFollow } = await import("../lib/followsFn");
    await setFollow({ data: { kind, ref, on } });
  } catch {
    // Best effort; getSession reconciles on the next load.
  }
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
  account: null,
  role: "user" as Role,
  authProviders: [],
  authOpen: false,
  pendingFollowId: null,
  pendingFollowSkill: null,
  toast: null,
  settingsOpen: false,
  reduceMotion: persisted.reduceMotion,
  nightMode: persisted.nightMode,
  selectedId: null,
  lastId: null,
  interacted: false,
  heat: "salary",
  searchOpen: false,
  filterOpen: false,
  heatOpen: false,
  searchQuery: "",
  skillIndex: null,
  heatMonth: Math.max(0, IVI_MONTHS.length - 1),
  activeSectors: [],
  listingType: null,
  activeExchanges: [],
  minSalary: 130,
  minHeadcount: 0,
  minGrowth: 0,
  maxAttrition: 16,
  zoomedOut: true,
  zoomingIn: false,
  globalOut: true,
  localCity: "perth",
  domesticRegion: "australia",
  compareOpen: false,
  compareA: null,
  compareB: null,
  trendingOpen: false,
  analystOpen: false,
  feedbackOpen: false,
  helpTourOpen: false,
  mobileMenuOpen: false,
  followedIds: persisted.followedIds,
  followedSkills: persisted.followedSkills,

  select: (id) =>
    set({
      selectedId: id,
      lastId: id,
      interacted: true,
      searchOpen: false,
      filterOpen: false,
      heatOpen: false,
      trendingOpen: false,
      analystOpen: false,
      feedbackOpen: false,
      helpTourOpen: false,
      mobileMenuOpen: false,
    }),
  // Optimistic locally, then written to the account.
  //
  // The store stays the single source the UI renders from, so the toggle feels
  // instant; the server write is fire-and-forget because a failed follow is not
  // worth blocking on and the next getSession reconciles it. Signed out, the
  // local list is all there is — which is exactly what the first sign-in claims.
  toggleFollow: (id) =>
    set((s) => {
      const on = !s.followedIds.includes(id);
      if (s.account) void persistFollow("company", id, on);
      return {
        followedIds: on ? [...s.followedIds, id] : s.followedIds.filter((x) => x !== id),
      };
    }),
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
        toast: "Create a free account or sign in to follow companies",
      });
      return;
    }
    set({
      followedIds: s.followedIds.includes(id)
        ? s.followedIds.filter((x) => x !== id)
        : [...s.followedIds, id],
    });
  },
  toggleFollowSkill: (skill) =>
    set((s) => {
      const on = !s.followedSkills.includes(skill);
      if (s.account) void persistFollow("skill", skill, on);
      return {
        followedSkills: on
          ? [...s.followedSkills, skill]
          : s.followedSkills.filter((x) => x !== skill),
      };
    }),
  // Following a skill is gated exactly like following a company: signed-out
  // visitors are prompted to create an account first, and the skill they tapped
  // is saved for them the moment they do (see signUp/signIn).
  requestFollowSkill: (skill) => {
    const s = get();
    if (!s.account) {
      set({
        authOpen: true,
        pendingFollowSkill: skill,
        searchOpen: false,
        filterOpen: false,
        toast: "Create a free account or sign in to follow skills",
      });
      return;
    }
    set({
      followedSkills: s.followedSkills.includes(skill)
        ? s.followedSkills.filter((x) => x !== skill)
        : [...s.followedSkills, skill],
    });
  },
  dismissToast: () => set({ toast: null }),
  openAuth: () =>
    set({ authOpen: true, searchOpen: false, filterOpen: false, mobileMenuOpen: false }),
  closeAuth: () => set({ authOpen: false, pendingFollowId: null, pendingFollowSkill: null }),
  // The session is whatever the server says it is. Signing in happens by OAuth
  // redirect (see lib/authClient.ts), so there is no "submit these credentials"
  // action here any more — the app simply learns who came back.
  //
  // A pending follow, saved when a signed-out visitor tapped Follow, is applied
  // the moment a session appears, so the thing they were trying to do actually
  // happens rather than being forgotten across the redirect.
  setRole: (r) => set({ role: r }),
  setSession: (a) =>
    set((s) => {
      // Signing out drops the role with the account: leaving it behind would
      // keep the admin surface visible to the next person at this browser.
      if (!a) return { account: null, role: "user" as Role, authOpen: false };
      const followedIds =
        s.pendingFollowId && !s.followedIds.includes(s.pendingFollowId)
          ? [...s.followedIds, s.pendingFollowId]
          : s.followedIds;
      const followedSkills =
        s.pendingFollowSkill && !s.followedSkills.includes(s.pendingFollowSkill)
          ? [...s.followedSkills, s.pendingFollowSkill]
          : s.followedSkills;
      return {
        account: a,
        authOpen: false,
        pendingFollowId: null,
        pendingFollowSkill: null,
        followedIds,
        followedSkills,
      };
    }),
  setAuthProviders: (p) => set({ authProviders: p }),
  setFollows: (ids, skills) => set({ followedIds: ids, followedSkills: skills }),
  // Clears the local view of the session. The cookie is revoked separately by
  // the auth client; this is what the UI reacts to.
  signOut: () =>
    set({
      account: null,
      authOpen: false,
      pendingFollowId: null,
      pendingFollowSkill: null,
      followedIds: [],
      followedSkills: [],
    }),
  toggleSettings: () =>
    set((s) => ({ settingsOpen: !s.settingsOpen, feedbackOpen: false, helpTourOpen: false })),
  closeSettings: () => set({ settingsOpen: false }),
  setReduceMotion: (v) => {
    if (typeof document !== "undefined")
      document.documentElement.classList.toggle("reduce-motion", v);
    set({ reduceMotion: v });
  },
  // Stub only — persisted for continuity but not wired to any theme yet.
  setNightMode: (v) => set({ nightMode: v }),
  closePanel: () => set({ selectedId: null }),
  setHeat: (h) => set({ heat: h }),
  setInteracted: () => set((s) => (s.interacted ? s : { interacted: true })),

  // The four mobile bottom-bar pop-outs (Search / Filter / Trending / More, plus
  // the Daily Brief the More sheet launches) are mutually exclusive, so tapping
  // one bar button while another's pop-out is open switches cleanly to it.
  // Every one of these opens something in the same region of the frame, so
  // opening one closes the rest. The analyst card was added last and only
  // toggleAnalyst knew about it, so any of these could leave it stacked
  // underneath — the same asymmetry that showed up with trending.
  toggleSearch: () =>
    set((s) => ({
      searchOpen: !s.searchOpen,
      filterOpen: false,
      heatOpen: false,
      trendingOpen: false,
      analystOpen: false,
      mobileMenuOpen: false,
    })),
  toggleFilter: () =>
    set((s) => ({
      filterOpen: !s.filterOpen,
      searchOpen: false,
      heatOpen: false,
      trendingOpen: false,
      analystOpen: false,
      mobileMenuOpen: false,
    })),
  toggleHeatPanel: () =>
    set((s) => ({
      heatOpen: !s.heatOpen,
      searchOpen: false,
      filterOpen: false,
      trendingOpen: false,
      analystOpen: false,
      mobileMenuOpen: false,
    })),
  setSearchQuery: (q) => set({ searchQuery: q }),
  clearSearch: () => set({ searchQuery: "" }),
  setSkillIndex: (idx) => set({ skillIndex: idx }),
  setHeatMonth: (i) =>
    set({ heatMonth: Math.max(0, Math.min(IVI_MONTHS.length - 1, Math.round(i))) }),
  toggleSector: (cat) =>
    set((s) => {
      const has = s.activeSectors.includes(cat);
      return {
        activeSectors: has ? s.activeSectors.filter((x) => x !== cat) : [...s.activeSectors, cat],
      };
    }),
  // Master listing filter. Re-selecting the active one clears it (back to Any).
  // Anything other than 'public' drops the exchange drill-down, which only
  // applies to listed companies.
  setListingType: (v) =>
    set((s) => {
      const next = s.listingType === v ? null : v;
      return { listingType: next, activeExchanges: next === "public" ? s.activeExchanges : [] };
    }),
  toggleExchange: (ex) =>
    set((s) => {
      const has = s.activeExchanges.includes(ex);
      return {
        activeExchanges: has
          ? s.activeExchanges.filter((x) => x !== ex)
          : [...s.activeExchanges, ex],
      };
    }),
  setMinSalary: (v) => set({ minSalary: v }),
  setMinHeadcount: (v) => set({ minHeadcount: v }),
  setMinGrowth: (v) => set({ minGrowth: v }),
  setMaxAttrition: (v) => set({ maxAttrition: v }),
  clearFilters: () =>
    set({
      activeSectors: [],
      listingType: null,
      activeExchanges: [],
      minSalary: 130,
      minHeadcount: 0,
      minGrowth: 0,
      maxAttrition: 16,
    }),
  toggleSkillQuery: (skill) => {
    const s = get();
    const on = s.searchQuery.trim().toLowerCase() === skill.toLowerCase();
    if (on) {
      set({ searchQuery: "" });
      return;
    }
    if (!s.zoomedOut) {
      // Selecting a skill while in the local city layer must NOT kick the user
      // out to the domestic overview. Stay in the city and colour its companies
      // by demand for the skill — and leave the camera exactly where it is.
      // Selecting a skill used to pull the zoom back to 14.2 "so more of the
      // city comes into view", which meant the map moved under the user every
      // time they tried a skill: whatever they had lined up was thrown away and
      // had to be re-found. The framing is theirs to choose.
      set({ searchQuery: skill, searchOpen: false, interacted: true });
      return;
    }
    // On the domestic / global overview: colour the whole-market skill heatmap.
    set({ searchQuery: skill, zoomedOut: true, searchOpen: false, interacted: true });
  },

  setZoomedOut: (v) => {
    if (v) markLayerChange();
    set({ zoomedOut: v });
  },
  // Scrolling/zooming out of a local city's map: land on that city's own
  // continent's domestic view, not whatever domesticRegion was last left at.
  zoomOutToDomestic: () => {
    const s = get();
    markLayerChange();
    set({
      zoomedOut: true,
      globalOut: false,
      domesticRegion: CITY_CONTINENT[s.localCity] || "australia",
      interacted: true,
    });
  },
  setZoomingIn: (v) => set({ zoomingIn: v }),
  setGlobalOut: (v) => set({ globalOut: v }),
  setZoomLevel: (n) => {
    const s = get();
    const cur = s.globalOut ? 2 : s.zoomedOut ? 1 : 0;
    if (n === cur) return;
    if (n === 0) {
      get().zoomIn();
      return;
    }
    if (n === 1) {
      // Leaving local for domestic: land on the current city's own continent.
      // Coming from global there's no "current" city context, so fall back
      // to Australia.
      const region = cur === 0 ? CITY_CONTINENT[s.localCity] || "australia" : "australia";
      set({ zoomedOut: true, globalOut: false, domesticRegion: region, interacted: true });
      return;
    }
    set({ zoomedOut: true, globalOut: true, interacted: true });
  },
  openCompanyLayer: () => {
    const s = get();
    if (s.selectedId) return; // already on the company layer
    const id = s.lastId || CITY_COMPANIES[s.localCity]?.[0]?.id || "bhp";
    // Make sure we're in the company's city (zoom into local if we're pulled
    // back), then open its card — mirrors selecting a company from search.
    const city = cityForCompany(id, s.localCity);
    if (s.zoomedOut || s.localCity !== city) get().zoomInCity(city);
    get().select(id);
  },
  // Re-enter whichever city we last viewed (defaults to Perth), so the Local
  // zoom button / back gesture doesn't snap away from e.g. Toronto to Perth.
  zoomIn: () => get().zoomInCity(get().localCity || "perth"),
  zoomInCity: (city) => {
    const s = get();
    if (s.zoomingIn) return;
    markLayerChange();
    set({ zoomingIn: true, interacted: true, localCity: city });
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      set({ zoomedOut: false, zoomingIn: false, globalOut: false });
      window.dispatchEvent(new CustomEvent("perth-zoom-reset"));
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
        set({ globalOut: false, domesticRegion: target || "australia", interacted: true });
      }
      return;
    }
    if (deltaY > 0) {
      markLayerChange();
      set({ globalOut: true, interacted: true });
    } else {
      // Scroll into the city hub nearest the cursor, defaulting to Perth.
      get().zoomInCity(target || "perth");
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

  toggleTrending: () =>
    set((s) => ({
      trendingOpen: !s.trendingOpen,
      // Mutually exclusive with the analyst card, which occupies the same
      // space. toggleAnalyst has always closed trending; this side was missing,
      // so opening trending from an open analyst card stacked the two.
      analystOpen: false,
      mobileMenuOpen: false,
      searchOpen: false,
      filterOpen: false,
      heatOpen: false,
    })),
  closeTrending: () => set({ trendingOpen: false }),
  toggleAnalyst: () =>
    set((s) => ({
      analystOpen: !s.analystOpen,
      trendingOpen: false,
      mobileMenuOpen: false,
      searchOpen: false,
      filterOpen: false,
      heatOpen: false,
    })),
  closeAnalyst: () => set({ analystOpen: false }),

  toggleFeedback: () =>
    set((s) => ({
      feedbackOpen: !s.feedbackOpen,
      helpTourOpen: false,
      settingsOpen: false,
      mobileMenuOpen: false,
    })),
  closeFeedback: () => set({ feedbackOpen: false }),
  toggleHelpTour: () =>
    set((s) => ({
      helpTourOpen: !s.helpTourOpen,
      feedbackOpen: false,
      settingsOpen: false,
      mobileMenuOpen: false,
    })),
  closeHelpTour: () => set({ helpTourOpen: false }),
  toggleMobileMenu: () =>
    set((s) => ({
      mobileMenuOpen: !s.mobileMenuOpen,
      searchOpen: false,
      filterOpen: false,
      heatOpen: false,
      trendingOpen: false,
    })),
  closeMobileMenu: () => set({ mobileMenuOpen: false }),
}));

// Mirror account + saved companies + settings to localStorage whenever any of
// them change.
useAppStore.subscribe((s, prev) => {
  if (
    s.followedIds !== prev.followedIds ||
    s.followedSkills !== prev.followedSkills ||
    s.reduceMotion !== prev.reduceMotion ||
    s.nightMode !== prev.nightMode
  ) {
    savePersisted({
      followedIds: s.followedIds,
      followedSkills: s.followedSkills,
      reduceMotion: s.reduceMotion,
      nightMode: s.nightMode,
    });
  }
});

export interface FilterState {
  searchQuery: string;
  activeSectors: string[];
  listingType?: ListingType | null;
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

// Master listing filter — HIDES a company that isn't the selected listing type
// (public / private). Null means "any".
export function matchesListing(c: Company, listingType: ListingType | null | undefined): boolean {
  return !listingType || companyListing(c) === listingType;
}

// The full "should this company be shown?" predicate: listing + sector +
// exchange + the four numeric sliders, all HIDE (not dim). Each slider only
// constrains once moved off its default (its slider min/max), so the default
// state shows every company. The exchange drill-down only applies under the
// 'public' listing type. Applied on the local map to hide non-matching
// companies, and via cityMatchesFilters to hide cities with no matching company.
export function matchesFilters(c: Company, s: FilterState): boolean {
  return (
    matchesListing(c, s.listingType) &&
    matchesSector(c, s.activeSectors) &&
    (s.listingType === "public" ? matchesExchange(c, s.activeExchanges) : true) &&
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

export function isSearchActive(s: Pick<FilterState, "searchQuery">): boolean {
  return s.searchQuery.trim() !== "";
}

export function isFilterActive(s: FilterState): boolean {
  return (
    !!s.listingType ||
    s.activeSectors.length > 0 ||
    s.activeExchanges.length > 0 ||
    s.minSalary > 130 ||
    s.minHeadcount > 0 ||
    s.minGrowth > 0 ||
    s.maxAttrition < 16
  );
}
