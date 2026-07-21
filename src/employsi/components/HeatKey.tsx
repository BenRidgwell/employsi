import type { CSSProperties, ReactNode } from 'react';
import { useAppStore } from '../state/store';
import { activeSkill } from '../lib/skillHeat';
import { skillLegend } from '../lib/heat';
import { IVI_MONTHS } from '../data/iviSkillDemand';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtMonth(ym: string): string {
  const [y, m] = (ym || '').split('-');
  const mi = Number(m) - 1;
  return mi >= 0 && mi < 12 ? `${MON[mi]} ${y}` : ym;
}

// Small line-art icons in the app's shared icon style (24×24, currentColor
// stroke) — the same look as the What's-trending / Daily-brief dock icons — so
// the timeline events read as UI, not emoji.
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const EVENT_ICONS: Record<string, ReactNode> = {
  crash: svg(<><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></>),
  bitcoin: svg(<><circle cx="12" cy="12" r="9" /><path d="M9.6 8h3.9a2 2 0 0 1 0 4H9.6Zm0 4h4.2a2 2 0 0 1 0 4H9.6Z" /><path d="M10.7 6.4v11.2M13 6.4V8M13 16v1.6" /></>),
  pickaxe: svg(<><path d="M14 4c2.2 0 5.2 2 6.2 6" /><path d="M14 4C11.8 4 8.8 6 7.8 10" /><path d="M11 9 4 20" /></>),
  oil: svg(<path d="M12 3s6 5.5 6 10a6 6 0 0 1-12 0c0-4.5 6-10 6-10Z" />),
  vote: svg(<><rect x="4" y="5" width="16" height="14" rx="1.6" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  virus: svg(<><circle cx="12" cy="12" r="4.6" /><path d="M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6M6 6l1.7 1.7M16.3 16.3 18 18M18 6l-1.7 1.7M7.7 16.3 6 18" /></>),
  boom: svg(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>),
  flame: svg(<path d="M12 3c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.8.8-3 1.9-4.1C10.6 8.1 11.5 6.2 12 3Z" />),
  ai: svg(<><rect x="7" y="7" width="10" height="10" rx="1.6" /><rect x="10" y="10" width="4" height="4" rx="0.6" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M9 3.4v1.6M15 3.4v1.6M9 19v1.6M15 19v1.6M3.4 9H5M3.4 15H5M19 9h1.6M19 15h1.6" /></>),
};

// Key global / economic events, to give the vacancy history broader context as
// the user scrubs the slider. Each has the YYYY-MM it began; the label shown is
// the most recent event on or before the selected month (the "era" you're in).
// Each carries a small relevant line icon (shown next to the label) so the era
// you're scrubbing through reads at a glance.
const EVENTS: { ym: string; label: string; icon: string }[] = [
  { ym: '2007-08', label: 'Global Financial Crisis', icon: 'crash' },
  { ym: '2009-01', label: 'Bitcoin launched', icon: 'bitcoin' },
  { ym: '2011-09', label: 'Mining investment boom', icon: 'pickaxe' },
  { ym: '2014-11', label: 'Oil price crash', icon: 'oil' },
  { ym: '2016-06', label: 'Brexit referendum', icon: 'vote' },
  { ym: '2020-03', label: 'COVID-19 pandemic', icon: 'virus' },
  { ym: '2021-06', label: 'Post-COVID hiring boom', icon: 'boom' },
  { ym: '2022-02', label: 'War in Ukraine · inflation surge', icon: 'flame' },
  { ym: '2022-11', label: 'Generative-AI boom (ChatGPT)', icon: 'ai' },
];
function eventFor(ym: string): { label: string; icon: string } | null {
  let cur: { label: string; icon: string } | null = null;
  for (const e of EVENTS) {
    if (e.ym <= ym) cur = { label: e.label, icon: e.icon };
    else break;
  }
  return cur;
}

// The map is neutral until a skill is searched, so the legend only appears then
// — showing the demand scale for the active skill. On the Australian domestic
// view it also carries a time slider that scrubs the real Jobs & Skills
// Australia IVI history (2006 → latest) so the heat map animates as demand
// shifts over time.
export function HeatKey() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const globalOut = useAppStore((s) => s.globalOut);
  const domesticRegion = useAppStore((s) => s.domesticRegion);
  const heatMonth = useAppStore((s) => s.heatMonth);
  const setHeatMonth = useAppStore((s) => s.setHeatMonth);
  const skill = activeSkill(searchQuery);
  if (!skill) return null;
  const key = skillLegend(skill);

  // Time slider on the global view and the AU domestic view — the layers whose
  // heat is (partly) driven by the IVI monthly history. Hidden on non-AU
  // domestic regions, which have no time series yet.
  const showTime = zoomedOut && (globalOut || domesticRegion === 'australia') && IVI_MONTHS.length > 1;
  const lastIdx = IVI_MONTHS.length - 1;
  const idx = Math.max(0, Math.min(lastIdx, heatMonth));
  const isLatest = idx === lastIdx;
  const pct = (idx / lastIdx) * 100;
  const fill: CSSProperties = { '--fill': `${pct}%` } as CSSProperties;

  return (
    <div className="heatkey">
      <div className="hkrow">
        <span className="hktitle">{key.title}</span>
      </div>
      <div className="hkbar" />
      <div className="hkrow">
        <span className="hkv">{key.lo}</span>
        <span className="hkmute">Low → High</span>
        <span className="hkv">{key.hi}</span>
      </div>
      {showTime && (
        <div className="hktime">
          <div className="hktimehd">
            <span className="hktimemonth">{fmtMonth(IVI_MONTHS[idx])}</span>
            <span className="hktimenow">{isLatest ? 'Now · last 3 months' : 'Historic'}</span>
          </div>
          <input
            type="range"
            className="hkslider"
            style={fill}
            min={0}
            max={lastIdx}
            step={1}
            value={idx}
            onChange={(e) => setHeatMonth(Number(e.target.value))}
            aria-label="Vacancy month"
          />
          <div className="hktimeends">
            <span>{fmtMonth(IVI_MONTHS[0])}</span>
            <span>{fmtMonth(IVI_MONTHS[lastIdx])}</span>
          </div>
          {(() => {
            const ev = eventFor(IVI_MONTHS[idx]);
            return ev ? (
              <div className="hktimeevent">
                <span className="hktimeicon" aria-hidden="true">{EVENT_ICONS[ev.icon]}</span>
                {ev.label}
              </div>
            ) : null;
          })()}
          {/* What the ▲/▼ figures on the city pills mean while scrubbing. */}
          <div className="hktimenote">
            ▲ / ▼ = change in {key.title.replace(/ demand$/i, '')} job ads vs the previous month
          </div>
        </div>
      )}
    </div>
  );
}
