import { useMemo } from 'react';
import { companyNews, type CompanyNews, type NewsItem } from '../../data/news';
import { useArticleImages } from '../../hooks/useArticleImages';
import type { ArticleMeta } from '../../lib/articleImageFn';

// Narrow "[company] in the news" card that sits to the right of the company
// card. Mirrors a mobile news feed: a trending hero with a masthead image, then
// a list of compact stories — no following tabs or notification bell.

// A real publish date rendered as a compact relative age ("3d ago"). Falls back
// to the item's baked-in label until the live date resolves (or if it can't).
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

function Meta({ item, meta }: { item: NewsItem; meta?: ArticleMeta }) {
  const time = (meta?.published && relTime(meta.published)) || item.time;
  const publisher = meta?.publisher;
  return (
    <div className="newsmeta">
      <span>{item.cat}</span>
      {publisher && (
        <>
          <span className="newsmetadot">·</span>
          <span className="newsmetapub">{publisher}</span>
        </>
      )}
      <span className="newsmetadot">·</span>
      <span className="newsmetat">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
        {time}
      </span>
    </div>
  );
}

// Each headline is clickable. Every story now carries its own real article URL;
// the Google-News search is only a last-resort fallback if one is ever missing.
// Opens in a new tab.
function articleUrl(item: NewsItem, name: string): string {
  return item.url || 'https://news.google.com/search?q=' + encodeURIComponent(`${item.title} ${name}`);
}

// Article image: the real image URL when the item carries one, otherwise a
// deterministic stock photo so the same story always shows the same picture.
function thumbUrl(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

// `live` (BHP) overrides the deterministic feed so comment counts tick with the
// poll; every other company falls back to the illustrative generated feed.
export function NewsPanel({ name, sector, live }: { name: string; sector: string; live?: CompanyNews | null }) {
  const computed = useMemo(() => companyNews(name, sector), [name, sector]);
  const news = live ?? computed;
  // Resolve real og:image, publish date and publisher for every story that
  // carries a genuine article link, on the Worker. Until they arrive (or for
  // stories with no real link) the cards keep their curated/stock image and
  // baked-in label, so nothing pops in empty.
  const meta = useArticleImages([news.hero.url, ...news.items.map((a) => a.url)]);
  const heroMeta = news.hero.url ? meta[news.hero.url] : undefined;
  const heroImg = heroMeta?.image || news.hero.image || thumbUrl(name + '-hero', 640, 360);

  // Cap the feed to recent coverage: once an item's real publish date resolves,
  // drop it if it's older than the window. Items whose date hasn't resolved yet
  // are kept (optimistic), and we never fall below a few rows so the card stays
  // populated even if several stories turn out to be old.
  const RECENT_MS = 300 * 24 * 3600 * 1000; // ~10 months
  const isStale = (a: NewsItem) => {
    const p = a.url ? meta[a.url]?.published : undefined;
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
              <img className="newsrowthumb" src={m?.image || a.image || thumbUrl(name + '-' + i, 160, 160)} alt="" loading="lazy" />
            </a>
          );
        })}
      </div>
    </aside>
  );
}
