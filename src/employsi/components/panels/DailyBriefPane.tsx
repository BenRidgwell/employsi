import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../state/store';
import { COMPANIES, companyGroup } from '../../data/companies';
import { useLiveNews } from '../../hooks/useLiveNews';
import { useArticleImages } from '../../hooks/useArticleImages';
import { getMarketSkillMovers, type MarketSkillMover } from '../../lib/jobHistoryFn';

// "Daily Brief": reads the day's trending analysis (the biggest skill risers and
// fallers, from the D1 job archive) and scans the web for recent news that gives
// context for WHY those skills are moving — a live-news feed built around the
// trend, not a static one. Falls back to sector-company news until the archive
// has movers to explain.

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

// Fallback: sector-company news, used only until the archive has skill movers.
function sectorQuery(activeSectors: string[]): { query: string; label: string } {
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

// Build a news query FROM the trending movers: search recent coverage that could
// explain why these skills are rising/falling in demand (hiring booms, layoffs,
// skills shortages, new investment, automation, policy).
function moverQuery(risers: MarketSkillMover[], fallers: MarketSkillMover[]): string {
  const skills = [...risers.slice(0, 3), ...fallers.slice(0, 2)].map((m) => `"${m.skill}"`);
  const terms = '(jobs OR hiring OR "skills shortage" OR workforce OR demand OR layoffs OR redundancies OR automation)';
  return `(${skills.join(' OR ')}) ${terms} Australia`;
}

export function DailyBriefPane() {
  const briefOpen = useAppStore((s) => s.briefOpen);
  const closeBrief = useAppStore((s) => s.closeBrief);
  const activeSectors = useAppStore((s) => s.activeSectors);

  // Open whenever toggled, on any layer. The old `&& zoomedOut` gate meant that
  // opening the brief from the mobile "More" menu on the local (city) view left
  // it silently closed — the tab bar hid (briefOpen is true) but the card never
  // rendered. Same fix as the What's Trending pane.
  const open = briefOpen;
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  // Read the day's trending analysis (skill risers/fallers from the archive).
  const { data: movers } = useQuery({
    queryKey: ['marketSkillMovers'],
    queryFn: () => getMarketSkillMovers(),
    enabled: open,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
  const risers = movers?.risers ?? [];
  const fallers = movers?.fallers ?? [];
  const hasMovers = risers.length > 0 || fallers.length > 0;

  // Query the web for context on the movers when we have them; else sector news.
  const { query, label } = useMemo(() => {
    if (hasMovers) return { query: moverQuery(risers, fallers), label: 'Why skills are trending' };
    return sectorQuery(activeSectors);
  }, [hasMovers, risers, fallers, activeSectors]);
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
          {hasMovers && (
            <div className="briefmovers">
              <div className="briefmovershd">Skills on the move — the news below explains why</div>
              <div className="briefmoverrows">
                {[...risers.slice(0, 3).map((m) => ({ m, dir: 'up' as const })),
                  ...fallers.slice(0, 2).map((m) => ({ m, dir: 'down' as const }))].map(({ m, dir }) => (
                  <div className={`briefmover ${dir}`} key={`${dir}-${m.skill}`}>
                    <span className="briefmoverarrow">{dir === 'up' ? '▲' : '▼'}</span>
                    <span className="briefmovername">{m.skill}</span>
                    <span className="briefmoverpct">
                      {m.prev > 0 ? `${dir === 'up' ? '+' : '−'}${Math.abs(m.pct)}%` : 'new'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {items.length === 0 ? (
            <div className="briefloading">Scanning the web for context on today's movers…</div>
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
