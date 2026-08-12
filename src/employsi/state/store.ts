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
import { HUB_LNGLAT } from "../data/mapboxWorldGeo";
import type { HeatMetric } from "../lib/heat";
import type { SkillIndex } from "../lib/skillsFn";
import type { DemandMode } from "../lib/skillHeat";
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
  /** The Alerts panel hanging off the bell. In the store rather than local to
      NotificationBell because the account card's menu opens it too, and two
      controls for one panel cannot each own its state. */
  alertsOpen: boolean;
  reduceMotion: boolean;
  placeLabels: boolean;
  /** Geolocation is in flight (the browser is showing its permission prompt). */
  locating: boolean;
  useMyLocation: boolean;
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
  // Whether skill demand is read as a VOLUME of vacancies or as a RATE per
  // 1,000 people already employed in the work. Two different questions — "where
  // are the most ads" and "where is labour tightest" — so the user picks.
  // Volume stays the default: it is the only one every country can answer, as
  // the rate's denominator (ABS employment by occupation) is Australia-only.
  demandMode: DemandMode;
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
  /** Admin-only archive health pane. */
  dataQualityOpen: boolean;
  /**
   * The unreleased place an end user just clicked, or null.
   *
   * Carries the composed display name ("Jakarta, Indonesia") rather than only
   * the id, because the maps already hold the label they render and the modal
   * would otherwise need its own id→name lookup that could drift from theirs.
   * Never set for an admin — they can reach every market, so nothing is
   * "coming soon" from their side of the gate.
   */
  comingSoon: { id: string; place: string } | null;
  // Feedback board + help-tour open state. Lifted here (Settings already is) so
  // the mobile "More" sheet can open them alongside the desktop dock buttons.
  feedbackOpen: boolean;
  helpTourOpen: boolean;
  // The mobile bottom-bar "More" sheet.
  mobileMenuOpen: boolean;
  /**
   * Whether the "in the news" column on a company card is tucked away.
   *
   * A PREFERENCE, not per-card state: tucking it once applies to every company
   * opened afterwards, and untucking likewise. It used to reset on every
   * selection so a card could never open looking like a company with no
   * coverage — but the collapsed panel still shows its spine, so the state is
   * visible and one click away, and having to re-tuck it on every company was
   * the bigger annoyance.
   */
  newsCollapsed: boolean;
  /**
   * The skills ticker, collapsed to its pill.
   *
   * Persisted for the same reason newsCollapsed is: a reader who does not want
   * a moving strip across the bottom of the map does not want it back on the
   * next visit either. Collapsing leaves a labelled pill rather than nothing,
   * so the ticker is still visibly there and one click from returning.
   */
  tickerCollapsed: boolean;
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
  toggleAlerts: () => void;
  closeAlerts: () => void;
  openAlerts: () => void;
  setReduceMotion: (v: boolean) => void;
  setPlaceLabels: (v: boolean) => void;
  setUseMyLocation: (v: boolean) => void;
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
  setDemandMode: (m: DemandMode) => void;
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
  toggleDataQuality: () => void;
  closeDataQuality: () => void;
  openComingSoon: (id: string, place: string) => void;
  closeComingSoon: () => void;

  toggleFeedback: () => void;
  closeFeedback: () => void;
  toggleHelpTour: () => void;
  closeHelpTour: () => void;
  toggleMobileMenu: () => void;
  closeMobileMenu: () => void;
  toggleNewsCollapsed: () => void;
  toggleTickerCollapsed: () => void;
  /** Close the frontmost open surface. Returns false if nothing was open. */
  closeTopmost: () => boolean;
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
  /** Show Mapbox's own city/region labels. On by default — the map is harder
   *  to read without them, so hiding is the deliberate choice, not the default. */
  placeLabels: boolean;
  /** The company card's news column, tucked or not. See AppState.newsCollapsed. */
  newsCollapsed: boolean;
  /** The skills ticker, collapsed to its pill. See AppState.tickerCollapsed. */
  tickerCollapsed: boolean;
}
const PERSIST_DEFAULTS: Persisted = {
  followedIds: [],
  followedSkills: [],
  reduceMotion: false,
  nightMode: false,
  placeLabels: true,
  newsCollapsed: false,
  tickerCollapsed: false,
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
      placeLabels: p.placeLabels ?? true,
      newsCollapsed: p.newsCollapsed ?? false,
      tickerCollapsed: p.tickerCollapsed ?? false,
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

/**
 * The tracked hub closest to a coordinate, or null if none is near enough.
 *
 * Great-circle distance, because a flat lng/lat metric is badly wrong at the
 * latitudes this app covers — it would rank Perth closer to London than to
 * Singapore. The 2,500km cut-off is what stops "use my location" silently
 * teleporting someone in, say, Nairobi to the nearest city we happen to hold:
 * no hub near you is an honest answer, and the toast says so.
 */
const NEAREST_HUB_KM = 2500;
function nearestHub(lng: number, lat: number): string | null {
  const rad = (d: number) => (d * Math.PI) / 180;
  let best: string | null = null;
  let bestKm = Infinity;
  for (const [hub, [hlng, hlat]] of Object.entries(HUB_LNGLAT)) {
    const dLat = rad(hlat - lat);
    const dLng = rad(hlng - lng);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(hlat)) * Math.sin(dLng / 2) ** 2;
    const km = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (km < bestKm) {
      bestKm = km;
      best = hub;
    }
  }
  return bestKm <= NEAREST_HUB_KM ? best : null;
}

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

/**
 * Panels that occupy the same screen space, so opening one must close the rest.
 *
 * This used to be written out by hand inside each toggle, and every panel added
 * after the first left the list a little more asymmetric: the new toggle knew
 * to close the old panels, but none of the old toggles knew about the new one.
 * By the time the admin console (dataQualityOpen) arrived there were four such
 * gaps — most visibly it and the analyst card could be open on top of each
 * other, because toggleAnalyst had never been told the console existed.
 *
 * Declaring the groups once and deriving the closes from them means adding a
 * panel is a single edit in one place, and cannot be half-done.
 */
type PanelFlag =
  | "searchOpen"
  | "filterOpen"
  | "heatOpen"
  | "trendingOpen"
  | "analystOpen"
  | "dataQualityOpen"
  | "mobileMenuOpen"
  | "feedbackOpen"
  | "helpTourOpen"
  | "settingsOpen"
  | "alertsOpen";

const EXCLUSIVE_GROUPS: readonly (readonly PanelFlag[])[] = [
  // The vertical action rail's panes. All anchored to the rail, over the map.
  [
    "searchOpen",
    "filterOpen",
    "heatOpen",
    "trendingOpen",
    "analystOpen",
    "dataQualityOpen",
    "mobileMenuOpen",
  ],
  // The header cluster, top right.
  ["feedbackOpen", "helpTourOpen", "settingsOpen", "alertsOpen", "mobileMenuOpen"],
];

/**
 * State patch that opens (or closes) one panel, closing whatever it collides
 * with. Closing collides with nothing, so it only ever writes the one flag.
 *
 * mobileMenuOpen is deliberately in BOTH groups: it is a full-screen overlay,
 * so it displaces everything, and everything displaces it.
 */
function solo(flag: PanelFlag, open: boolean): Partial<Record<PanelFlag, boolean>> {
  const next: Partial<Record<PanelFlag, boolean>> = { [flag]: open };
  if (!open) return next;
  for (const group of EXCLUSIVE_GROUPS) {
    if (!group.includes(flag)) continue;
    for (const other of group) if (other !== flag) next[other] = false;
  }
  return next;
}

export const useAppStore = create<AppState>((set, get) => ({
  account: null,
  role: "user" as Role,
  authProviders: [],
  authOpen: false,
  pendingFollowId: null,
  pendingFollowSkill: null,
  toast: null,
  settingsOpen: false,
  alertsOpen: false,
  reduceMotion: persisted.reduceMotion,
  placeLabels: persisted.placeLabels,
  // NOT persisted: a location permission belongs to the browser, and re-asking
  // on every load because a stored boolean said so would be rude.
  locating: false,
  useMyLocation: false,
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
  demandMode: "volume",
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
  dataQualityOpen: false,
  comingSoon: null,
  feedbackOpen: false,
  helpTourOpen: false,
  mobileMenuOpen: false,
  newsCollapsed: persisted.newsCollapsed,
  tickerCollapsed: persisted.tickerCollapsed,
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
      dataQualityOpen: false,
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
  /**
   * Clears the local view of the session, then reloads the page.
   *
   * The reload is the fix, and the state reset below is the belt to its braces.
   *
   * `role` was NOT being cleared here — only the account and the follows were —
   * so an admin who signed out kept `role: "admin"` in a live store. Every
   * admin-only surface is gated on exactly that value (the Admin console
   * button, the unreleased markets on the map, the search's market filter), so
   * they all stayed open to a signed-out browser until something happened to
   * remount. Resetting the role closes that.
   *
   * But resetting one field only fixes the leak we found. A signed-in session
   * seeds a lot of state — follows, the market gate, cached queries — and any
   * of it can outlive a sign-out the same way. A full reload rebuilds every bit
   * of it from a signed-out server, which is the only version of this that
   * cannot be got subtly wrong again.
   *
   * Ordering matters: both call sites await the auth client's revocation first
   * (`authSignOut().finally(() => signOut())`), so by the time this reloads the
   * cookie is already gone and the fresh load comes back signed out. Reloading
   * before revocation would sign the person straight back in.
   */
  signOut: () => {
    set({
      account: null,
      role: "user" as Role,
      authOpen: false,
      pendingFollowId: null,
      pendingFollowSkill: null,
      followedIds: [],
      followedSkills: [],
    });
    if (typeof window !== "undefined") {
      // Same URL, so the person lands where they were rather than being sent
      // to the default view for having signed out.
      window.location.reload();
    }
  },
  toggleSettings: () => set((s) => solo("settingsOpen", !s.settingsOpen)),
  closeSettings: () => set({ settingsOpen: false }),
  toggleAlerts: () => set((s) => solo("alertsOpen", !s.alertsOpen)),
  closeAlerts: () => set({ alertsOpen: false }),
  openAlerts: () => set(solo("alertsOpen", true)),
  setReduceMotion: (v) => {
    if (typeof document !== "undefined")
      document.documentElement.classList.toggle("reduce-motion", v);
    set({ reduceMotion: v });
  },
  // The map components watch this and toggle Mapbox's own label layers; there
  // is no CSS equivalent, because those labels are painted into the canvas.
  setPlaceLabels: (v) => {
    set({ placeLabels: v });
  },
  // Asks the browser once, then jumps to the nearest hub we actually track.
  // Turning it OFF does not move the map — undoing a navigation the user asked
  // for would be more surprising than leaving them where they landed.
  setUseMyLocation: (v) => {
    if (!v) {
      set({ useMyLocation: false, locating: false });
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      set({ toast: "This browser can't share a location." });
      return;
    }
    set({ locating: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const hub = nearestHub(pos.coords.longitude, pos.coords.latitude);
        set({
          useMyLocation: true,
          locating: false,
          toast: hub ? null : "No market we track is near you yet.",
        });
        if (hub) get().zoomInCity(hub);
      },
      () => {
        // Denied or unavailable. Say so rather than leaving a switch that
        // flipped itself back with no explanation.
        set({ useMyLocation: false, locating: false, toast: "Location permission was declined." });
      },
      { timeout: 10000, maximumAge: 300000 },
    );
  },
  // Stub only — persisted for continuity but not wired to any theme yet.
  setNightMode: (v) => set({ nightMode: v }),
  closePanel: () => set({ selectedId: null }),
  setHeat: (h) => set({ heat: h }),
  setInteracted: () => set((s) => (s.interacted ? s : { interacted: true })),

  // The four mobile bottom-bar pop-outs (Search / Filter / Trending / More, plus
  // the Daily Brief the More sheet launches) are mutually exclusive, so tapping
  // one bar button while another's pop-out is open switches cleanly to it.
  // Which panels displace which lives in EXCLUSIVE_GROUPS, not here.
  toggleSearch: () => set((s) => solo("searchOpen", !s.searchOpen)),
  toggleFilter: () => set((s) => solo("filterOpen", !s.filterOpen)),
  toggleHeatPanel: () => set((s) => solo("heatOpen", !s.heatOpen)),
  setSearchQuery: (q) => set({ searchQuery: q }),
  clearSearch: () => set({ searchQuery: "" }),
  setSkillIndex: (idx) => set({ skillIndex: idx }),
  setHeatMonth: (i) =>
    set({ heatMonth: Math.max(0, Math.min(IVI_MONTHS.length - 1, Math.round(i))) }),
  setDemandMode: (m) => set({ demandMode: m }),
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

  toggleTrending: () => set((s) => solo("trendingOpen", !s.trendingOpen)),
  closeTrending: () => set({ trendingOpen: false }),
  toggleAnalyst: () => set((s) => solo("analystOpen", !s.analystOpen)),
  closeAnalyst: () => set({ analystOpen: false }),
  toggleDataQuality: () => set((s) => solo("dataQualityOpen", !s.dataQualityOpen)),
  closeDataQuality: () => set({ dataQualityOpen: false }),

  // Clicking an unreleased place. It closes the flyouts the way selecting a
  // company does, because this modal covers the map and leaving a dropdown open
  // behind it would only be reachable by dismissing the modal first.
  openComingSoon: (id, place) =>
    set({
      comingSoon: { id, place },
      interacted: true,
      searchOpen: false,
      filterOpen: false,
      heatOpen: false,
      mobileMenuOpen: false,
    }),
  closeComingSoon: () => set({ comingSoon: null }),

  toggleFeedback: () => set((s) => solo("feedbackOpen", !s.feedbackOpen)),
  closeFeedback: () => set({ feedbackOpen: false }),
  toggleHelpTour: () => set((s) => solo("helpTourOpen", !s.helpTourOpen)),
  closeHelpTour: () => set({ helpTourOpen: false }),
  toggleMobileMenu: () => set((s) => solo("mobileMenuOpen", !s.mobileMenuOpen)),
  closeMobileMenu: () => set({ mobileMenuOpen: false }),
  toggleNewsCollapsed: () => set((s) => ({ newsCollapsed: !s.newsCollapsed })),
  toggleTickerCollapsed: () => set((s) => ({ tickerCollapsed: !s.tickerCollapsed })),

  /**
   * What Escape closes, in the order a reader would expect it to.
   *
   * ONE ordered rule rather than a handler per card. Panels used to each bind
   * their own Escape, so whether the key worked depended on which component
   * happened to have thought about it — and when two things were open it was
   * undefined which one went. Order runs most-blocking first: a modal that took
   * over the screen, then the auth sheet, then compare, then the company card,
   * then whichever pane the rail or the header has open (EXCLUSIVE_GROUPS
   * guarantees at most one of each family).
   *
   * Returns whether it closed anything, so the key handler can leave the event
   * alone when nothing was open and the browser's own Escape behaviour still
   * applies.
   */
  closeTopmost: () => {
    const s = get();
    if (s.comingSoon) return (set({ comingSoon: null }), true);
    if (s.authOpen)
      return (set({ authOpen: false, pendingFollowId: null, pendingFollowSkill: null }), true);
    if (s.compareOpen) return (set({ compareOpen: false, selectedId: s.lastId }), true);
    if (s.selectedId) return (set({ selectedId: null }), true);
    const panes = [
      "searchOpen",
      "filterOpen",
      "heatOpen",
      "trendingOpen",
      "analystOpen",
      "dataQualityOpen",
      "mobileMenuOpen",
      "feedbackOpen",
      "helpTourOpen",
      "settingsOpen",
      "alertsOpen",
    ] as const;
    const open = panes.filter((k) => s[k]);
    if (!open.length) return false;
    set(Object.fromEntries(open.map((k) => [k, false])));
    return true;
  },
}));

// Mirror account + saved companies + settings to localStorage whenever any of
// them change.
useAppStore.subscribe((s, prev) => {
  if (
    s.followedIds !== prev.followedIds ||
    s.followedSkills !== prev.followedSkills ||
    s.reduceMotion !== prev.reduceMotion ||
    s.nightMode !== prev.nightMode ||
    s.placeLabels !== prev.placeLabels ||
    s.newsCollapsed !== prev.newsCollapsed ||
    s.tickerCollapsed !== prev.tickerCollapsed
  ) {
    savePersisted({
      followedIds: s.followedIds,
      followedSkills: s.followedSkills,
      reduceMotion: s.reduceMotion,
      nightMode: s.nightMode,
      placeLabels: s.placeLabels,
      newsCollapsed: s.newsCollapsed,
      tickerCollapsed: s.tickerCollapsed,
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
  // A marker with NO company roster at all is not a company marker — the EU
  // country markers carry Eurostat vacancy rates, not employers. Treating
  // "holds no companies" as "holds no matching company" made all 26 of them
  // vanish the instant any slider moved, at every threshold equally, which is
  // not the filter answering the question — it is the filter deleting a
  // different dataset. A marker that makes no claim about company headcount or
  // pay cannot be contradicted by a filter on headcount or pay, so it stays.
  //
  // Every real city hub has companies (all 54 do), so this only ever exempts
  // the vacancy-only markers.
  if (!list || !list.length) return true;
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
