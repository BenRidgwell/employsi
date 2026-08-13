import "./global.css";
import { PerthMapbox } from "./components/PerthMapbox";
import { TopBar } from "./components/TopBar";
import { GlobalSearch } from "./components/GlobalSearch";
import { Ticker } from "./components/Ticker";
import { HintPulse } from "./components/HintPulse";
import { ActionRail } from "./components/ActionRail";
import { FilterPane } from "./components/FilterPane";
import { MobileTabBar } from "./components/MobileTabBar";
import { MobileLayerBar } from "./components/MobileLayerBar";
import { MobileSearch } from "./components/MobileSearch";
import { MobileMenu } from "./components/MobileMenu";
import { Toast } from "./components/Toast";
import { LocalBanner } from "./components/LocalBanner";
import { WorldMapbox } from "./components/WorldMapbox";
import { CompanyPanel } from "./components/panels/CompanyPanel";
import { ComparePanel } from "./components/panels/ComparePanel";
import { WhatsTrendingPane } from "./components/panels/WhatsTrendingPane";
import { DataQualityGate } from "./components/panels/DataQualityGate";
import { AnalystPane } from "./components/panels/AnalystPane";
import { ComingSoonPane } from "./components/panels/ComingSoonPane";
import { IntroLoader } from "./components/IntroLoader";
import { useAppStore } from "./state/store";
import { useAuthSession } from "./hooks/useAuthSession";
import { useSkillIndex } from "./hooks/useSkillData";
import { useViewTracking } from "./hooks/useViewTracking";
import { startSession } from "./lib/analytics";
import { useEffect } from "react";

function App() {
  // Ask the server who is signed in, once per load. The session cookie is
  // httpOnly, so this is the only way the client can know — and the only
  // place that sets `account`.
  useAuthSession();

  // Escape closes the frontmost open surface, app-wide.
  //
  // Bound once here rather than per card. Panels used to each bind their own
  // Escape, so whether the key worked at all depended on which component had
  // thought about it, and with two things open it was undefined which one went.
  // The ORDER lives in the store (closeTopmost), next to the rules about which
  // panels may be open together.
  //
  // Typing fields are left alone: Escape in the search box already clears and
  // blurs it, and stealing that to close a card would be worse than not binding
  // the key at all. Only when nothing was open does the event stay unhandled,
  // so the browser's own Escape still applies.
  const closeTopmost = useAppStore((s) => s.closeTopmost);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (closeTopmost()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTopmost]);

  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);

  // Load the live skill-demand index once and hand it to the store so the maps
  // can colour by real demand when a skill is searched.
  const skillIndex = useSkillIndex();
  const setSkillIndex = useAppStore((s) => s.setSkillIndex);
  useEffect(() => {
    if (skillIndex) setSkillIndex(skillIndex);
  }, [skillIndex, setSkillIndex]);

  // Record real "most viewed" usage (companies / cities / regions / skills) for
  // the What's Trending pane, and the product events behind the admin console's
  // engagement tab.
  useViewTracking();

  // One session per page load, closed out with its length on unload. This is
  // the only source of "time in app" — see lib/analytics.ts for why the unload
  // path has to be a beacon rather than an ordinary request.
  useEffect(() => startSession(), []);

  // What the intro waits on. The skill index is the app's one real boot fetch —
  // the maps render from bundled geometry, but the demand data every layer
  // colours by comes over the wire — so "the index has landed" is the honest
  // answer to "has this finished loading". IntroLoader caps the wait itself, so
  // a slow or failed fetch delays the handoff rather than blocking it forever.
  const introReady = !!skillIndex;

  return (
    <div className="app">
      <IntroLoader ready={introReady} />
      {/* ── Header row ──────────────────────────────────────────────────────
          72px of white above the map, carrying the wordmark, the centred skill
          search and the account control. Previously all three floated ON the
          map, which is why the wordmark and search title had to be recoloured
          per layer (and why WorldMapbox sampled the canvas pixel underneath the
          header to decide light vs dark). On white they are simply ink, so that
          whole mechanism is gone. */}
      <div className="apphead">
        <TopBar />
        <GlobalSearch />
        {/* Phones only (CSS hides both above 680px). The design stacks a
            permanent search field and the layer segmented control under the
            wordmark, in place of the desktop's centred pill and left rail. */}
        <MobileSearch />
        <MobileLayerBar />
      </div>

      {/* ── Map frame ───────────────────────────────────────────────────────
          The map is now an inset rounded card rather than a full-bleed canvas.
          ONLY the two Mapbox mounts live inside it: `overflow: hidden` is what
          rounds the map's corners, and anything else placed in here would be
          clipped by them. The chrome below stays where it was — the design does
          the same, positioning its ticker and rail as siblings of the frame
          rather than children of it. */}
      <div className="mapframe">
        <div className="mapcard">
          <PerthMapbox />
          {/* Real Mapbox globe/domestic layers; the local (Perth) 3D layer
              above is unchanged. */}
          <WorldMapbox />
        </div>
      </div>

      {/* One rail down the left, built from the design's own markup: trends,
          the layer tray, and Filter with its panel. Feedback / Help / Settings
          are NOT here — the design puts them at the header's right edge, and
          HelpDock renders there (inside TopBar's control row). */}
      <ActionRail />
      {/* Filter's panel, opened from the rail on desktop and from the mobile
          tab bar on phones — so it lives at the root, not inside the rail. */}
      <FilterPane />

      <HintPulse />
      <Ticker hidden={!zoomedOut} />
      {/* The local layer's city + summary banner, bottom-left. Replaces the
          old CityBadge pill and Legend stats bar, which said related things in
          two different corners. */}
      <LocalBanner />
      <CompanyPanel />
      <ComparePanel />
      <WhatsTrendingPane />
      <AnalystPane />
      <DataQualityGate />
      {/* Clicking an unreleased market. Rendered at the root, outside the map
          frame: it is a modal over the whole page, and inside `.mapcard` the
          card's shadow would be clipped by the frame's rounded corners. */}
      <ComingSoonPane />
      <MobileTabBar />
      <MobileMenu />
      <Toast />
    </div>
  );
}

export default App;
