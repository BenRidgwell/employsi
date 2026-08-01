import "./global.css";
import { PerthMapbox } from "./components/PerthMapbox";
import { TopBar } from "./components/TopBar";
import { GlobalSearch } from "./components/GlobalSearch";
import { Ticker } from "./components/Ticker";
import { HintPulse } from "./components/HintPulse";
import { ActionRail } from "./components/ActionRail";
import { FilterPane } from "./components/FilterPane";
import { MobileTabBar } from "./components/MobileTabBar";
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
import { useAppStore } from "./state/store";
import { useAuthSession } from "./hooks/useAuthSession";
import { useSkillIndex } from "./hooks/useSkillData";
import { useViewTracking } from "./hooks/useViewTracking";
import { useEffect } from "react";

function App() {
  // Ask the server who is signed in, once per load. The session cookie is
  // httpOnly, so this is the only way the client can know — and the only
  // place that sets `account`.
  useAuthSession();
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
  // the What's Trending pane.
  useViewTracking();

  return (
    <div className="app">
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
