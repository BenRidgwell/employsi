import './global.css';
import { PerthMapbox } from './components/PerthMapbox';
import { TopBar } from './components/TopBar';
import { Ticker } from './components/Ticker';
import { HintPulse } from './components/HintPulse';
import { ZoomSlider } from './components/ZoomSlider';
import { MapActions } from './components/MapActions';
import { Legend } from './components/Legend';
import { HeatKey } from './components/HeatKey';
import { ZoomOverlay } from './components/geo/ZoomOverlay';
import { CompanyPanel } from './components/panels/CompanyPanel';
import { ComparePanel } from './components/panels/ComparePanel';
import { DailyBriefPane } from './components/panels/DailyBriefPane';
import { WhatsTrendingPane } from './components/panels/WhatsTrendingPane';
import { useAppStore } from './state/store';

function App() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);

  return (
    <div className="app">
      <ZoomSlider />
      <MapActions />
      <PerthMapbox />
      <HintPulse />
      <Ticker hidden={zoomedOut} />
      <ZoomOverlay />
      <TopBar />
      <Legend />
      <HeatKey />
      <CompanyPanel />
      <ComparePanel />
      <DailyBriefPane />
      <WhatsTrendingPane />
    </div>
  );
}

export default App;
