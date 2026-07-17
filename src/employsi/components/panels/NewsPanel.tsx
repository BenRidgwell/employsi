import { useMemo } from 'react';
import { companyNews, liveToCompanyNews, CURATED_NEWS_COMPANIES, type CompanyNews, type NewsItem } from '../../data/news';
import { useArticleImages } from '../../hooks/useArticleImages';
import { useLiveNews } from '../../hooks/useLiveNews';
import type { ArticleMeta } from '../../lib/articleImageFn';

// Narrow "[company] in the news" card that sits to the right of the company
// card. The 14 pilot companies use a hand-curated real feed; everyone else
// pulls a live Google-News feed on the Worker (real, recent, with publisher +
// link), falling back to generated copy only if the live feed is empty.

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

// Publisher / date come from the live feed when the item carries them, else
// from the Worker's og:image scrape of a curated article.
function pubOf(item: NewsItem, meta?: ArticleMeta): string | undefined {
  return item.publisher || meta?.publisher || undefined;
}
function publishedOf(item: NewsItem, meta?: ArticleMeta): string {
  return item.publishedIso || meta?.published || '';
}

function Meta({ item, meta }: { item: NewsItem; meta?: ArticleMeta }) {
  const iso = publishedOf(item, meta);
  const time = (iso && relTime(iso)) || item.time;
  const publisher = pubOf(item, meta);
  return (
    <div className="newsmeta">
      <span>{item.cat}</span>
      {publisher && (
        <>
          <span className="newsmetadot">·</span>
          <span className="newsmetapub">{publisher}</span>
        </>
      )}
      {time && <span className="newsmetadot">·</span>}
      {time && (
        <span className="newsmetat">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
          {time}
        </span>
      )}
    </div>
  );
}

function articleUrl(item: NewsItem, name: string): string {
  return item.url || 'https://news.google.com/search?q=' + encodeURIComponent(`${item.title} ${name}`);
}

function thumbUrl(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

export function NewsPanel({ name, sector, ticker, live }: { name: string; sector: string; ticker?: string; live?: CompanyNews | null }) {
  const generated = useMemo(() => companyNews(name, sector), [name, sector]);
  const curated = CURATED_NEWS_COMPANIES.has(name);
  // Non-curated companies fetch a live news feed (GDELT → Google News) keyed on
  // the company name alone — the most reliable query (tickers/market suffixes
  // only narrow results). Curated companies (and BHP's live feed) skip this.
  void ticker;
  const liveQuery = !curated && !live ? `"${name}"` : null;
  const liveItems = useLiveNews(liveQuery, 6);
  const liveFeed = useMemo(() => liveToCompanyNews(liveItems), [liveItems]);

  const news = live ?? (curated ? generated : liveFeed ?? generated);

  // Only scrape og:image for items that don't already carry a real image (live
  // GDELT items bring their own socialimage; curated items need scraping).
  const scrapeUrls = [news.hero, ...news.items].filter((a) => a.url && !a.image).map((a) => a.url);
  const meta = useArticleImages(scrapeUrls);
  const heroMeta = news.hero.url ? meta[news.hero.url] : undefined;
  const heroImg = news.hero.image || heroMeta?.image || thumbUrl(name + '-hero', 640, 360);

  // Cap the feed to recent coverage once a real publish date is known.
  const RECENT_MS = 300 * 24 * 3600 * 1000;
  const isStale = (a: NewsItem) => {
    const p = publishedOf(a, a.url ? meta[a.url] : undefined);
    return p ? Date.now() - Date.parse(p) > RECENT_MS : false;
  };
  const fresh = news.items.filter((a) => !isStale(a));
  const items = fresh.length >= 3 ? fresh : news.items.slice(0, 3);

  return (
    <aside className="newspanel">
      <div className="newshd">
        <span className="newshdname">{name}</span> in the news
      </div>
      <div className="newsscroll">
        <a className="newshero" href={articleUrl(news.hero, name)} target="_blank" rel="noreferrer">
          <div className="newsheroimg">
            <img className="newsheroimgtag" src={heroImg} alt="" loading="lazy" />
            <span className="newsbadge">Trending</span>
          </div>
          <div className="newsherotitle">{news.hero.title}</div>
          <Meta item={news.hero} meta={heroMeta} />
        </a>

        {items.map((a, i) => {
          const m = a.url ? meta[a.url] : undefined;
          return (
            <a className="newsrow" key={i} href={articleUrl(a, name)} target="_blank" rel="noreferrer">
              <div className="newsrowbody">
                <div className="newsrowcat">{a.cat}</div>
                <div className="newsrowtitle">{a.title}</div>
                <Meta item={a} meta={m} />
              </div>
              <img className="newsrowthumb" src={a.image || m?.image || thumbUrl(name + '-' + i, 160, 160)} alt="" loading="lazy" />
            </a>
          );
        })}
      </div>
    </aside>
  );
}
