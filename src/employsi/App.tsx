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

function App() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);

  // The global Mapbox view has a dark globe/space backdrop, so the
  // transparent-background top-bar labels + wordmark must flip to light; the
  // domestic and local layers have a light basemap and keep the dark defaults.
  const onDark = globalOut && zoomedOut;

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
