import './global.css';
import { PerthMapbox } from './components/PerthMapbox';
import { TopBar } from './components/TopBar';
import { Ticker } from './components/Ticker';
import { HintPulse } from './components/HintPulse';
import { ZoomSlider } from './components/ZoomSlider';
import { Legend } from './components/Legend';
import { HeatKey } from './components/HeatKey';
import { ZoomOverlay } from './components/geo/ZoomOverlay';
import { CompanyPanel } from './components/panels/CompanyPanel';
import { ComparePanel } from './components/panels/ComparePanel';
import { useAppStore } from './state/store';

function App() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);

  return (
    <div className="app">
      <ZoomSlider />
      <PerthMapbox />
      <HintPulse />
      <Ticker hidden={zoomedOut} />
      <ZoomOverlay />
      <TopBar />
      <Legend />
      <HeatKey />
      <CompanyPanel />
      <ComparePanel />
    </div>
  );
}

export default App;
