import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { COMPANIES, companyGroup } from '../../data/companies';
import { useLiveNews } from '../../hooks/useLiveNews';
import { useArticleImages } from '../../hooks/useArticleImages';

// "Daily Brief": a live Google-News feed, refreshed on the Worker, showing
// recent coverage with the real publisher + a click-through to the article. It
// re-queries when the sector filter changes, so selecting e.g. Financial
// Services or Consumer & Retail shows news about the companies in that sector.

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return 'just now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

function thumbUrl(seed: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/200/200`;
}

// Turn the active sector filter into a Google-News query built from the biggest
// companies in that sector, so the brief is genuinely about those firms.
function buildQuery(activeSectors: string[]): { query: string; label: string } {
  const inScope = activeSectors.length
    ? COMPANIES.filter((c) => activeSectors.includes(companyGroup(c)))
    : COMPANIES.filter((c) => companyGroup(c) === 'Energy & Natural Resources');
  const names = [...inScope]
    .sort((a, b) => b.headcount - a.headcount)
    .slice(0, 6)
    .map((c) => `"${c.name}"`);
  const label = activeSectors.length ? activeSectors.join(' · ') : 'Energy & Natural Resources';
  const query = names.length ? `${names.join(' OR ')} ASX` : 'ASX resources Australia';
  return { query, label };
}

export function DailyBriefPane() {
  const briefOpen = useAppStore((s) => s.briefOpen);
  const zoomedOut = useAppStore((s) => s.zoomedOut);
  const closeBrief = useAppStore((s) => s.closeBrief);
  const activeSectors = useAppStore((s) => s.activeSectors);

  const open = briefOpen && zoomedOut;
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  const { query, label } = useMemo(() => buildQuery(activeSectors), [activeSectors]);
  // Only fetch while the brief is actually open.
  const items = useLiveNews(open ? query : null, 12);
  // Live GDELT items already carry a real article image; only scrape the ones
  // that don't (Google-News fallback links).
  const meta = useArticleImages(items.filter((a) => !a.image).map((a) => a.url));

  return (
    <>
      {open && <div className="panescrim" onClick={closeBrief} />}
      <aside className={`briefpane ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="briefhead">
          <div className="briefmark">
            <svg className="briefmarksvg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5.6A1.2 1.2 0 0 1 5.2 4.4h9.1a1.2 1.2 0 0 1 1.2 1.2V18a1.5 1.5 0 0 1-1.5 1.5H6.2A2.2 2.2 0 0 1 4 17.3V5.6Z" />
              <path d="M15.5 8.5h2.3a1 1 0 0 1 1 1v7.3a1.7 1.7 0 0 1-1.7 1.7" />
              <path className="briefmarklines" d="M6.4 7.3h6.6M6.4 9.9h6.6M6.4 12.5h4.2" />
            </svg>
          </div>
          <div className="briefheadtxt">
            <div className="brieftitle">Daily Brief</div>
            <div className="briefdate">{today}</div>
          </div>
          <button className="briefclose" onClick={closeBrief} aria-label="Close">✕</button>
        </div>

        <div className="briefscroll">
          {items.length === 0 ? (
            <div className="briefloading">Loading live headlines…</div>
          ) : (
            items.map((a, i) => {
              const img = a.image || meta[a.url]?.image || thumbUrl(a.url || String(i));
              return (
                <a className="briefcard briefcardlink" key={a.url + i} href={a.url} target="_blank" rel="noreferrer">
                  <div className="briefthumb briefthumbimg">
                    <img src={img} alt="" loading="lazy" />
                  </div>
                  <div className="briefbody">
                    <div className="briefmeta">
                      {a.publisher && <span className="briefcat">{a.publisher}</span>}
                      {a.publisher && a.published && <span className="briefdot">•</span>}
                      {a.published && <span className="briefwhen">{relTime(a.published)}</span>}
                    </div>
                    <h3 className="briefhl">{a.title}</h3>
                  </div>
                </a>
              );
            })
          )}
          <div className="brieffoot">Live headlines · {label}</div>
        </div>
      </aside>
    </>
  );
}
