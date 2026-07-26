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
import { CityBadge } from "./components/CityBadge";
import { Toast } from "./components/Toast";
import { Legend } from "./components/Legend";
import { WorldMapbox } from "./components/WorldMapbox";
import { CompanyPanel } from "./components/panels/CompanyPanel";
import { ComparePanel } from "./components/panels/ComparePanel";
import { WhatsTrendingPane } from "./components/panels/WhatsTrendingPane";
import { AnalystPane } from "./components/panels/AnalystPane";
import { useAppStore } from "./state/store";
import { useSkillIndex } from "./hooks/useSkillData";
import { useViewTracking } from "./hooks/useViewTracking";
import { useEffect } from "react";

function App() {
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
      <Legend />
      <CompanyPanel />
      <ComparePanel />
      <WhatsTrendingPane />
      <AnalystPane />
      <MobileTabBar />
      <MobileMenu />
      <CityBadge />
      <Toast />
    </div>
  );
}

export default App;
