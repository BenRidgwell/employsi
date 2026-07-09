import { useAppStore } from '../../state/store';
import { COMPANIES } from '../../data/companies';
import { BRIEF_ARTICLES, type BriefIcon } from '../../data/brief';

const TICKER_TO_ID: Record<string, string> = Object.fromEntries(COMPANIES.map((c) => [c.ticker, c.id]));

function ThumbIcon({ icon }: { icon: BriefIcon }) {
  const common = { fill: 'none', stroke: 'rgba(255,255,255,0.92)', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (icon) {
    case 'energy':
      return <path {...common} d="M13 3 6 13h5l-1 8 7-11h-5l1-7Z" />;
    case 'mine':
      return <path {...common} d="M4 19h16M6 19l4-9 3 4 2-3 3 8" />;
    case 'gas':
      return <path {...common} d="M12 3c1.6 3 4.2 4.6 4.2 8.2a4.2 4.2 0 0 1-8.4 0c0-1.8.8-3 1.9-4.1" />;
    case 'battery':
      return <><rect {...common} x="4" y="8" width="14" height="8" rx="1.6" /><path {...common} d="M20 11v2M9 12h4" /></>;
    case 'metal':
      return <path {...common} d="M4 9l8-4 8 4-8 4-8-4Zm0 6 8 4 8-4" />;
    case 'carbon':
      return <><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="M9 12h6M12 9v6" /></>;
    case 'copper':
      return <><circle {...common} cx="12" cy="12" r="7" /><circle {...common} cx="12" cy="12" r="3" /></>;
  }
}

export function DailyBriefPane() {
  const briefOpen = useAppStore((s) => s.briefOpen);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const closeBrief = useAppStore((s) => s.closeBrief);
  const select = useAppStore((s) => s.select);

  const open = briefOpen && zoomedOut;
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <aside className={`briefpane ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="briefhead">
        <div className="briefmark" />
        <div className="briefheadtxt">
          <div className="brieftitle">Daily Brief</div>
          <div className="briefdate">{today}</div>
        </div>
        <button className="briefclose" onClick={closeBrief} aria-label="Close">✕</button>
      </div>

      <div className="briefscroll">
        {BRIEF_ARTICLES.map((a) => (
          <article className="briefcard" key={a.id}>
            <div className="briefthumb" style={{ background: `linear-gradient(145deg, ${a.tone}, ${a.tone}b0)` }}>
              <svg viewBox="0 0 24 24">
                <ThumbIcon icon={a.icon} />
              </svg>
            </div>
            <div className="briefbody">
              <div className="briefmeta">
                <span className="briefcat">{a.category}</span>
                <span className="briefdot">•</span>
                <span className="briefwhen">{a.date}</span>
              </div>
              <h3 className="briefhl">{a.title}</h3>
              <p className="briefsum">{a.summary}</p>
              <div className="brieftags">
                {a.tags.map((t) => (
                  <button
                    key={t}
                    className="brieftag"
                    onClick={() => TICKER_TO_ID[t] && select(TICKER_TO_ID[t])}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </article>
        ))}
        <div className="brieffoot">Illustrative headlines · resources sector</div>
      </div>
    </aside>
  );
}
