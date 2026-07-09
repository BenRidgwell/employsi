import { useAppStore } from '../../state/store';
import { COMPANIES } from '../../data/companies';
import { TREND_SECTIONS, type TrendIcon, type TrendItem } from '../../data/trending';

const TICKER_TO_ID: Record<string, string> = Object.fromEntries(COMPANIES.map((c) => [c.ticker, c.id]));

function SectionIcon({ icon }: { icon: TrendIcon }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (icon === 'movers') return <svg viewBox="0 0 24 24"><path {...common} d="M4 15l5-5 3 3 6-7M14 6h5v5" /></svg>;
  if (icon === 'salary') return <svg viewBox="0 0 24 24"><path {...common} d="M12 3v18M8.5 7.5a3 3 0 0 1 3-2.5h1a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h1a3 3 0 0 0 3-2.5" /></svg>;
  return (
    <svg viewBox="0 0 24 24">
      <path {...common} d="M12 3c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.8.8-3 1.9-4.1C10.6 8.1 11.5 6.2 12 3Z" />
    </svg>
  );
}

function fmtDelta(d: number): string {
  return (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + '%';
}

export function WhatsTrendingPane() {
  const trendingOpen = useAppStore((s) => s.trendingOpen);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const closeTrending = useAppStore((s) => s.closeTrending);
  const select = useAppStore((s) => s.select);
  const toggleSkillQuery = useAppStore((s) => s.toggleSkillQuery);

  const open = trendingOpen && zoomedOut;

  const activate = (it: TrendItem) => {
    if (it.ticker && TICKER_TO_ID[it.ticker]) {
      select(TICKER_TO_ID[it.ticker]);
    } else if (it.skill) {
      toggleSkillQuery(it.skill);
      closeTrending();
    }
  };

  return (
    <aside className={`briefpane trendpane ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="briefhead">
        <div className="briefmark">
          <svg className="trendmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <g className="flameicon">
              <path d="M12 3c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.8.8-3 1.9-4.1C10.6 8.1 11.5 6.2 12 3Z" />
              <path className="flameember" d="M12 10.5c.8 1.3 1.6 2 1.6 3.1a1.6 1.6 0 0 1-3.2 0c0-1.1.8-1.8 1.6-3.1Z" />
            </g>
          </svg>
        </div>
        <div className="briefheadtxt">
          <div className="brieftitle">What's Trending</div>
          <div className="briefdate">Movers this quarter</div>
        </div>
        <button className="briefclose" onClick={closeTrending} aria-label="Close">✕</button>
      </div>

      <div className="briefscroll">
        {TREND_SECTIONS.map((s) => (
          <section className="trendcard" key={s.id}>
            <div className="trendcardhead">
              <span className={`trendcardicon ic-${s.icon}`}>
                <SectionIcon icon={s.icon} />
              </span>
              <div className="trendcardmeta">
                <div className="trendcardtitle">{s.title}</div>
                <div className="trendcardcap">{s.caption}</div>
              </div>
            </div>
            <div className="trendrows">
              {s.items.map((it, i) => {
                const up = it.delta >= 0;
                const link = !!(it.ticker || it.skill);
                return (
                  <div
                    className={`trendrow ${link ? 'link' : ''}`}
                    key={it.label + i}
                    onClick={link ? () => activate(it) : undefined}
                    role={link ? 'button' : undefined}
                  >
                    <span className="trendrank">{i + 1}</span>
                    <span className="trendinfo">
                      <span className="trendlabel">{it.label}</span>
                      <span className="trendsub">{it.sub}</span>
                    </span>
                    <span className={`trenddelta ${up ? 'up' : 'down'}`}>
                      {up ? '▲' : '▼'} {fmtDelta(it.delta)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <div className="brieffoot">Illustrative movers · quarter on quarter</div>
      </div>
    </aside>
  );
}
