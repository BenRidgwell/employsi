import { useMemo } from 'react';
import { companyNews, liveToCompanyNews, CURATED_NEWS_COMPANIES, type CompanyNews, type NewsItem } from '../../data/news';
import { useArticleImages } from '../../hooks/useArticleImages';
import { useLiveNews } from '../../hooks/useLiveNews';
import type { ArticleMeta } from '../../lib/articleImageFn';

// "[company] in the news" feed that sits to the right of the company card,
// styled as a modern news app: a large hero card with the article photo behind
// an overlaid category pill, meta line and headline, then a two-column grid of
// smaller cards (image on top, pill + meta + headline below).
//
// The 14 pilot companies use a hand-curated real feed; everyone else pulls a
// live feed on the Worker (Bing News → GDELT → named outlet RSS), falling back
// to generated copy only if the live feed is empty. Article images come from
// the feed's own image, or the Worker's og:image scrape of the article page.

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
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
// Article image: the feed's own image first, then the scraped og:image.
function imageOf(item: NewsItem, meta?: ArticleMeta): string | undefined {
  return item.image || (meta?.image || undefined);
}

// Deterministic gradient placeholder for items with no image, so the layout
// never shows a blank tile — keyed off the headline so it's stable per article.
function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const a = h;
  const b = (h + 40) % 360;
  return `linear-gradient(135deg, hsl(${a} 55% 32%), hsl(${b} 60% 20%))`;
}

function articleUrl(item: NewsItem, name: string): string {
  return item.url || 'https://news.google.com/search?q=' + encodeURIComponent(`${item.title} ${name}`);
}

// The meta line "Category · Publisher · 6 hours ago".
function metaBits(item: NewsItem, meta?: ArticleMeta): string {
  const iso = publishedOf(item, meta);
  const time = (iso && relTime(iso)) || item.time;
  const publisher = pubOf(item, meta);
  return [item.cat, publisher, time].filter(Boolean).join(' · ');
}

function Thumb({ img, seed, className }: { img?: string; seed: string; className: string }) {
  const style = img
    ? { backgroundImage: `url("${img}")` }
    : { backgroundImage: gradientFor(seed) };
  return <div className={className} style={style} aria-hidden />;
}

export function NewsPanel({ name, sector, ticker, live }: { name: string; sector: string; ticker?: string; live?: CompanyNews | null }) {
  const generated = useMemo(() => companyNews(name, sector), [name, sector]);
  const curated = CURATED_NEWS_COMPANIES.has(name);
  // Non-curated companies fetch a live news feed keyed on the company name alone
  // (the most reliable query). Curated companies (and BHP's live feed) skip this.
  void ticker;
  const liveQuery = !curated && !live ? `"${name}"` : null;
  const liveItems = useLiveNews(liveQuery, 6);
  const liveFeed = useMemo(() => liveToCompanyNews(liveItems), [liveItems]);

  const news = live ?? (curated ? generated : liveFeed ?? generated);

  // Scrape article pages for the real image + publisher + publish date. Live
  // feed items may already carry an image; curated items are scraped.
  const scrapeUrls = [news.hero, ...news.items].filter((a) => a.url).map((a) => a.url);
  const meta = useArticleImages(scrapeUrls);
  const heroMeta = news.hero.url ? meta[news.hero.url] : undefined;

  // Cap the feed to recent coverage once a real publish date is known.
  const RECENT_MS = 300 * 24 * 3600 * 1000;
  const isStale = (a: NewsItem) => {
    const p = publishedOf(a, a.url ? meta[a.url] : undefined);
    return p ? Date.now() - Date.parse(p) > RECENT_MS : false;
  };
  const fresh = news.items.filter((a) => !isStale(a));
  const items = fresh.length >= 3 ? fresh : news.items.slice(0, 4);

  const heroImg = imageOf(news.hero, heroMeta);

  return (
    <aside className="newspanel flashfeed">
      <div className="ffhd">
        <span className="ffhdname">In the news</span>
      </div>
      <div className="ffscroll">
        <a className="ffhero" style={{ animationDelay: '0.02s' }} href={articleUrl(news.hero, name)} target="_blank" rel="noreferrer">
          <Thumb img={heroImg} seed={news.hero.title} className="ffhero-img" />
          <div className="ffhero-shade" />
          <div className="ffhero-body">
            <span className="ffpill ffpill-hero">{news.hero.cat}</span>
            <div className="ffhero-title">{news.hero.title}</div>
            <div className="ffhero-meta">{metaBits(news.hero, heroMeta)}</div>
          </div>
        </a>

        <div className="ffgrid">
          {items.map((a, i) => {
            const m = a.url ? meta[a.url] : undefined;
            return (
              <a className="ffcard" style={{ animationDelay: `${0.08 + i * 0.06}s` }} key={i} href={articleUrl(a, name)} target="_blank" rel="noreferrer">
                <Thumb img={imageOf(a, m)} seed={a.title} className="ffcard-img" />
                <div className="ffcard-body">
                  <span className="ffpill">{a.cat}</span>
                  <div className="ffcard-title">{a.title}</div>
                  <div className="ffcard-meta">{metaBits(a, m)}</div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
