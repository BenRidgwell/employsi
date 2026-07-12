import { useEffect, useState } from 'react';
import { useAppStore } from '../state/store';

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
  const showSummary = useAppStore((s) => s.showSummary);
  const setShowSummary = useAppStore((s) => s.setShowSummary);
  const reduceMotion = useAppStore((s) => s.reduceMotion);
  const setReduceMotion = useAppStore((s) => s.setReduceMotion);

  // zoomedOut takes precedence, same reasoning as ZoomSlider.
  const layer: Layer = !zoomedOut ? 'local' : globalOut ? 'global' : 'domestic';
  const layerKey = layer === 'local' ? `local-${localCity}` : layer;

  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbText, setFbText] = useState('');
  const [fbSent, setFbSent] = useState(false);

  // Pop the pill out briefly whenever the user lands on a new layer/city.
  useEffect(() => {
    setPeek(true);
    setOpen(false);
    const t = setTimeout(() => setPeek(false), 4200);
    return () => clearTimeout(t);
  }, [layerKey]);

  const sendFeedback = () => {
    if (!fbText.trim()) return;
    setFbSent(true);
    setTimeout(() => {
      setFbOpen(false);
      setFbSent(false);
      setFbText('');
    }, 1900);
  };

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
              <div className="setlbl">Summary bar</div>
              <div className="setsub">Show the employer / roles totals along the bottom.</div>
            </div>
            <Switch on={showSummary} onChange={setShowSummary} label="Toggle summary bar" />
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
      {fbOpen && (
        <div className="fbpanel">
          {fbSent ? (
            <div className="fbthanks">
              <span className="fbcheck">✓</span>
              Thanks for your feedback!
            </div>
          ) : (
            <>
              <div className="helphd">
                <div className="helptitle">Share feedback</div>
                <button className="helpx" onClick={() => setFbOpen(false)} aria-label="Close">✕</button>
              </div>
              <textarea
                className="fbtext"
                placeholder="What's working, what's missing, ideas…"
                value={fbText}
                onChange={(e) => setFbText(e.target.value)}
                autoFocus
              />
              <button className="fbsend" disabled={!fbText.trim()} onClick={sendFeedback}>Send feedback</button>
            </>
          )}
        </div>
      )}

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
          <path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.2V16.5H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
          <path d="M8 9.5h8M8 12.5h5" />
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
          <circle cx="12" cy="17.4" r="0.6" fill="currentColor" stroke="none" />
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
        </svg>
        <span className="helplbl">Settings</span>
      </button>
    </div>
  );
}
