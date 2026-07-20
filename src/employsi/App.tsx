import './global.css';
import { PerthMapbox } from './components/PerthMapbox';
import { TopBar } from './components/TopBar';
import { GlobalSearch } from './components/GlobalSearch';
import { Ticker } from './components/Ticker';
import { HintPulse } from './components/HintPulse';
import { ZoomSlider } from './components/ZoomSlider';
import { MapActions } from './components/MapActions';
import { HelpDock } from './components/HelpDock';
import { MobileTabBar } from './components/MobileTabBar';
import { MobileMenu } from './components/MobileMenu';
import { CityBadge } from './components/CityBadge';
import { Toast } from './components/Toast';
import { Legend } from './components/Legend';
import { HeatKey } from './components/HeatKey';
import { WorldMapbox } from './components/WorldMapbox';
import { CompanyPanel } from './components/panels/CompanyPanel';
import { ComparePanel } from './components/panels/ComparePanel';
import { DailyBriefPane } from './components/panels/DailyBriefPane';
import { WhatsTrendingPane } from './components/panels/WhatsTrendingPane';
import { useAppStore } from './state/store';
import { useSkillIndex } from './hooks/useSkillData';
import { useEffect } from 'react';

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

  // `ondark` (zoomedOut) keeps the header's pixel-sampler wired on both
  // overviews. The wordmark + top-bar labels, though, sit over a dark backdrop
  // only on the GLOBAL globe (dark space); the domestic overview is a light
  // country map (mapbox standard), so there they must read dark like the local
  // city view. `onglobe` scopes the light-branding treatment to the globe only.
  const onDark = zoomedOut;
  const onGlobe = zoomedOut && globalOut;

  return (
    <div className={`app${onDark ? ' ondark' : ''}${onGlobe ? ' onglobe' : ''}`}>
      <ZoomSlider />
      <MapActions />
      <PerthMapbox />
      <HintPulse />
      <Ticker hidden={!(globalOut && zoomedOut)} />
      {/* Mapbox trial: real Mapbox globe/domestic layers replace the SVG
          ZoomOverlay. The local (Perth) 3D layer above is unchanged. */}
      <WorldMapbox />
      <TopBar />
      <GlobalSearch />
      <Legend />
      <HeatKey />
      <CompanyPanel />
      <ComparePanel />
      <DailyBriefPane />
      <WhatsTrendingPane />
      <HelpDock />
      <MobileTabBar />
      <MobileMenu />
      <CityBadge />
      <Toast />
    </div>
  );
}

export default App;
