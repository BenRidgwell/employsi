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

  // Both the global globe/space backdrop AND the domestic overview keep a dark
  // backdrop behind the top-bar, so the transparent-background wordmark + labels
  // must stay light on both. Only the local city view (a light 3D basemap)
  // flips back to the dark defaults.
  const onDark = zoomedOut;

  return (
    <div className={`app${onDark ? ' ondark' : ''}`}>
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
