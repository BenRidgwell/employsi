import { useAppStore } from '../../state/store';
import { COMPANIES } from '../../data/companies';
import { TREND_SECTIONS, MOST_VIEWED, type TrendIcon, type TrendItem, type ViewedItem } from '../../data/trending';

const TICKER_TO_ID: Record<string, string> = Object.fromEntries(COMPANIES.map((c) => [c.ticker, c.id]));

function ViewedIcon({ kind }: { kind: ViewedItem['kind'] }) {
  const c = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (kind === 'company') return <svg viewBox="0 0 24 24"><path {...c} d="M5 21V6.5l6-2.5v17M11 9l6 2v10M4 21h16M8 8v.01M8 11v.01M8 14v.01" /></svg>;
  if (kind === 'continent') return <svg viewBox="0 0 24 24"><circle {...c} cx="12" cy="12" r="8.5" /><path {...c} d="M3.5 12h17M12 3.5a13 13 0 0 1 0 17M12 3.5a13 13 0 0 0 0 17" /></svg>;
  return <svg viewBox="0 0 24 24"><path {...c} d="M13 3 5 13h5l-1 8 8-11h-5l1-7Z" /></svg>;
}

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
  const setGlobalOut = useAppStore((s) => s.setGlobalOut);

  const open = trendingOpen && zoomedOut;

  const activateViewed = (v: ViewedItem) => {
    if (v.kind === 'company' && v.ticker && TICKER_TO_ID[v.ticker]) select(TICKER_TO_ID[v.ticker]);
    else if (v.kind === 'skill' && v.skill) {
      toggleSkillQuery(v.skill);
      closeTrending();
    } else if (v.kind === 'continent') {
      setGlobalOut(v.label !== 'Australia');
      closeTrending();
    }
  };

  const activate = (it: TrendItem) => {
    if (it.ticker && TICKER_TO_ID[it.ticker]) {
      select(TICKER_TO_ID[it.ticker]);
    } else if (it.skill) {
      toggleSkillQuery(it.skill);
      closeTrending();
    }
  };

  return (
    <>
      {open && <div className="panescrim" onClick={closeTrending} />}
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
        <div className="trendsnap">
          <div className="trendsnaphd">
            <span className="trendsnaptitle">Most viewed</span>
            <span className="trendsnapcap">What people are exploring now</span>
          </div>
          {MOST_VIEWED.map((v) => (
            <button className="trendsnaprow" key={v.kind} onClick={() => activateViewed(v)}>
              <span className={`trendsnapic tv-${v.kind}`}>
                <ViewedIcon kind={v.kind} />
              </span>
              <span className="trendsnapinfo">
                <span className="trendsnaplabel">{v.label}</span>
                <span className="trendsnapsub">{v.sub}</span>
              </span>
              <span className="trendsnapshare">
                <b>{v.share}</b>
                <span>of views</span>
              </span>
            </button>
          ))}
        </div>

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
    </>
  );
}
