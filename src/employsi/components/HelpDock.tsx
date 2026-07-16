import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';
import { FeedbackBoard } from './FeedbackBoard';

type Layer = 'local' | 'domestic' | 'global';

const CITY_NAME: Record<string, string> = { perth: 'Perth', brisbane: 'Brisbane', adelaide: 'Adelaide' };

function tourFor(layer: Layer, city: string) {
  if (layer === 'local') {
    const name = CITY_NAME[city] || 'this city';
    const hasCompanies = city === 'perth';
    return {
      title: `${name} — city view`,
      sub: 'The local employer map',
      steps: [
        hasCompanies
          ? 'Glowing dots are employers, shaded by the active heat metric.'
          : `No companies are mapped in ${name} yet — the city layout is ready for them.`,
        'Pan, zoom and rotate (right-drag) to explore the streetscape.',
        hasCompanies ? 'Click a dot or its pill to open the company profile.' : 'Switch the heat metric up top (Salary / Growth / Turnover).',
        'Scroll out to step back to the Australia view.',
      ],
    };
  }
  if (layer === 'domestic') {
    return {
      title: 'Australia — domestic view',
      sub: 'National workforce overview',
      steps: [
        'Each city glows by the selected metric (Salary, Growth, Turnover).',
        'Click Perth, Adelaide or Brisbane to zoom into that city.',
        'Search a skill up top to reveal demand hotspots.',
        'Scroll out again for the global view.',
      ],
    };
  }
  return {
    title: 'Global — world view',
    sub: 'Worldwide mining & energy hubs',
    steps: [
      'Hubs glow by the selected metric across the continents.',
      'Click the AUSTRALIA label, or a city hub, to dive in.',
      'Use the left rail for trends and the daily brief.',
      'Scroll in to return to the Australia view.',
    ],
  };
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={`ngswitch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span className="ngswitchknob" />
    </button>
  );
}

export function HelpDock() {
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const localCity = useAppStore((s) => s.localCity);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);
  const nightMode = useAppStore((s) => s.nightMode);
  const setNightMode = useAppStore((s) => s.setNightMode);

  // zoomedOut takes precedence, same reasoning as ZoomSlider.
  const layer: Layer = !zoomedOut ? 'local' : globalOut ? 'global' : 'domestic';
  const layerKey = layer === 'local' ? `local-${localCity}` : layer;

  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);

  // Pop the pill out briefly whenever the user lands on a new layer/city.
  useEffect(() => {
    setPeek(true);
    setOpen(false);
    const t = setTimeout(() => setPeek(false), 4200);
    return () => clearTimeout(t);
  }, [layerKey]);

  const tour = tourFor(layer, localCity);

  return (
    <div className="helpdock">
      {open && (
        <div className="helppanel">
          <div className="helphd">
            <div>
              <div className="helptitle">{tour.title}</div>
              <div className="helpsub">{tour.sub}</div>
            </div>
            <button className="helpx" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <ol className="helpsteps">
            {tour.steps.map((s, i) => (
              <li key={i}>
                <span className="helpnum">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {settingsOpen && (
        <div className="setpanel">
          <div className="helphd">
            <div className="helptitle">Settings</div>
            <button className="helpx" onClick={closeSettings} aria-label="Close">✕</button>
          </div>
          <div className="setrow">
            <div>
              <div className="setlbl">Night mode</div>
              <div className="setsub">A dark colour theme for the map. Coming soon.</div>
            </div>
            <Switch on={nightMode} onChange={setNightMode} label="Toggle night mode" />
          </div>
          <div className="setrow">
            <div>
              <div className="setlbl">Reduce motion</div>
              <div className="setsub">Minimise map and interface animations.</div>
            </div>
            <Switch on={reduceMotion} onChange={setReduceMotion} label="Toggle reduce motion" />
          </div>
        </div>
      )}
      {fbOpen && <FeedbackBoard onClose={() => setFbOpen(false)} />}

      <button
        className="helpbtn"
        onClick={() => {
          setFbOpen((o) => !o);
          setOpen(false);
          closeSettings();
        }}
        aria-label="Submit feedback"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <g className="fbicon">
            <path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.2V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
            <path d="M8 9.5h8M8 12.5h5" />
          </g>
        </svg>
        <span className="helplbl">Feedback</span>
      </button>

      <button
        className={`helpbtn ${peek || open ? 'wide' : ''} ${peek ? 'peek' : ''}`}
        onClick={() => {
          setOpen((o) => !o);
          setFbOpen(false);
          closeSettings();
        }}
        aria-label="Need help?"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.2 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.6 2.2-2.6 3.9" />
          <circle className="helpdotpulse" cx="12" cy="17.4" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        <span className="helplbl">Need help?</span>
      </button>

      <button
        className={`helpbtn helpsettings ${settingsOpen ? 'on' : ''}`}
        onClick={() => {
          toggleSettings();
          setOpen(false);
          setFbOpen(false);
        }}
        aria-label="Settings"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <g className="geargroup">
            <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" />
            <circle cx="12" cy="12" r="2.7" />
          </g>
        </svg>
        <span className="helplbl">Settings</span>
      </button>
    </div>
  );
}
