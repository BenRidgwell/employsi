import type { CSSProperties } from 'react';
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

// Key global / economic events, to give the vacancy history broader context as
// the user scrubs the slider. Each has the YYYY-MM it began; the label shown is
// the most recent event on or before the selected month (the "era" you're in).
// Each event carries a small relevant icon (shown next to the label instead of
// a plain bullet) so the era you're scrubbing through reads at a glance.
const EVENTS: { ym: string; label: string; icon: string }[] = [
  { ym: '2007-08', label: 'Global Financial Crisis', icon: '📉' },
  { ym: '2009-01', label: 'Bitcoin launched', icon: '₿' },
  { ym: '2011-09', label: 'Mining investment boom', icon: '⛏️' },
  { ym: '2014-11', label: 'Oil price crash', icon: '🛢️' },
  { ym: '2016-06', label: 'Brexit referendum', icon: '🗳️' },
  { ym: '2020-03', label: 'COVID-19 pandemic', icon: '🦠' },
  { ym: '2021-06', label: 'Post-COVID hiring boom', icon: '📈' },
  { ym: '2022-02', label: 'War in Ukraine · inflation surge', icon: '🔥' },
  { ym: '2022-11', label: 'Generative-AI boom (ChatGPT)', icon: '🤖' },
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
                <span className="hktimeicon" aria-hidden="true">{ev.icon}</span>
                {ev.label}
              </div>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}
