import { useMemo } from "react";
import {
  companyNews,
  liveToCompanyNews,
  CURATED_NEWS_COMPANIES,
  type CompanyNews,
  type NewsItem,
} from "../../data/news";
import { useArticleImages } from "../../hooks/useArticleImages";
import { useLiveNews } from "../../hooks/useLiveNews";
import type { ArticleMeta } from "../../lib/articleImageFn";
import { isBlockedArticle } from "../../data/newsBlocklist";

// "[company] in the news", the second column of `Employsi Company Card
// public.html` — a 196px hero with the article photo behind a gradient, a
// "Trending" chip and the headline, then a stacked list of rows: a 64px square
// on the left, headline and meta on the right.
//
// The design draws those squares as a flat tint with a three-letter kicker,
// because its mock has no images. We DO have real article images (feed image,
// else the Worker's og:image scrape), so a row shows the photo when there is
// one and falls back to the design's tinted kicker when there isn't.
//
// The 14 pilot companies use a hand-curated real feed; everyone else pulls a
// live feed on the Worker (Bing News → GDELT → named outlet RSS), falling back
// to generated copy only if the live feed is empty. Article images come from
// the feed's own image, or the Worker's og:image scrape of the article page.

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.round(days / 365)}y ago`;
}

// Publisher / date come from the live feed when the item carries them, else
// from the Worker's og:image scrape of a curated article.
function pubOf(item: NewsItem, meta?: ArticleMeta): string | undefined {
  return item.publisher || meta?.publisher || undefined;
}
function publishedOf(item: NewsItem, meta?: ArticleMeta): string {
  return item.publishedIso || meta?.published || "";
}
// Article image: the feed's own image first, then the scraped og:image.
function imageOf(item: NewsItem, meta?: ArticleMeta): string | undefined {
  return item.image || meta?.image || undefined;
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

// The row's fallback square: a tint and a short code, when an article has no
// image. Both are derived from the publisher so the same outlet always looks
// the same down the list — it is a label, not a measurement.
const KICKER_TINTS = ["#f2f5fa", "#f6f3ee", "#f1f6f3", "#f7f2f2"];
function kickerOf(item: NewsItem, meta?: ArticleMeta): { code: string; tint: string } {
  const src = pubOf(item, meta) || item.cat || "News";
  const letters = src.replace(/[^A-Za-z]/g, "");
  let h = 0;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) % 9973;
  return {
    code: (letters.slice(0, 3) || "NEW").toUpperCase(),
    tint: KICKER_TINTS[h % KICKER_TINTS.length],
  };
}

function articleUrl(item: NewsItem, name: string): string {
  return (
    item.url || "https://news.google.com/search?q=" + encodeURIComponent(`${item.title} ${name}`)
  );
}

// The meta line "Category · Publisher · 6 hours ago".
function metaBits(item: NewsItem, meta?: ArticleMeta): string {
  const iso = publishedOf(item, meta);
  const time = (iso && relTime(iso)) || item.time;
  const publisher = pubOf(item, meta);
  return [item.cat, publisher, time].filter(Boolean).join(" · ");
}

function Thumb({ img, seed, className }: { img?: string; seed: string; className: string }) {
  const style = img ? { backgroundImage: `url("${img}")` } : { backgroundImage: gradientFor(seed) };
  return <div className={className} style={style} aria-hidden />;
}

export function NewsPanel({
  name,
  sector,
  ticker,
  live,
}: {
  name: string;
  sector: string;
  ticker?: string;
  live?: CompanyNews | null;
}) {
  const generated = useMemo(() => companyNews(name, sector), [name, sector]);
  const curated = CURATED_NEWS_COMPANIES.has(name);
  // Non-curated companies fetch a live news feed keyed on the company name alone
  // (the most reliable query). Curated companies (and BHP's live feed) skip this.
  void ticker;
  const liveQuery = !curated && !live ? `"${name}"` : null;
  const liveItems = useLiveNews(liveQuery, 6);
  const liveFeed = useMemo(() => liveToCompanyNews(liveItems), [liveItems]);

  const rawNews = live ?? (curated ? generated : (liveFeed ?? generated));
  // Blocked publishers are dropped HERE as well as in the live fetch, because
  // four different paths converge on this component — the curated sets, the
  // generated fallback, the live feed, and BHP's own feed — and only this one
  // is common to all of them. If the hero itself is blocked, the first
  // surviving item is promoted rather than leaving the card headless.
  const news = useMemo(() => {
    const ok = (a: NewsItem) => !isBlockedArticle(a.url, a.publisher);
    const items = rawNews.items.filter(ok);
    if (ok(rawNews.hero)) return { ...rawNews, items };
    if (!items.length) return { ...rawNews, items };
    return { ...rawNews, hero: { ...items[0], cat: rawNews.hero.cat }, items: items.slice(1) };
  }, [rawNews]);

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

  // "Updated Nh ago" from the freshest article we actually have a date for —
  // the design hard-codes 18h; this is the real recency of the feed below it.
  const updated = (() => {
    const stamps = [news.hero, ...items]
      .map((a) => publishedOf(a, a.url ? meta[a.url] : undefined))
      .map((p) => (p ? Date.parse(p) : NaN))
      .filter((t) => !Number.isNaN(t));
    if (!stamps.length) return null;
    return relTime(new Date(Math.max(...stamps)).toISOString());
  })();

  return (
    <aside className="newspanel">
      <div className="nwhd">
        <span className="nwhdname">In the news</span>
        {updated && <span className="cceyebrow">Updated {updated}</span>}
      </div>
      <div className="nwscroll">
        <a className="nwhero" href={articleUrl(news.hero, name)} target="_blank" rel="noreferrer">
          <Thumb img={heroImg} seed={news.hero.title} className="nwheroimg" />
          <span className="nwheroshade" />
          <span className="nwherochip">{news.hero.cat}</span>
          <span className="nwherobody">
            <span className="nwherotitle">{news.hero.title}</span>
            <span className="nwherometa">{metaBits(news.hero, heroMeta)}</span>
          </span>
        </a>

        {items.map((a, i) => {
          const m = a.url ? meta[a.url] : undefined;
          const img = imageOf(a, m);
          const k = kickerOf(a, m);
          return (
            <a
              className="nwrow"
              key={i}
              href={articleUrl(a, name)}
              target="_blank"
              rel="noreferrer"
            >
              {img ? (
                <Thumb img={img} seed={a.title} className="nwrowimg" />
              ) : (
                <span className="nwrowimg nwrowkicker" style={{ background: k.tint }}>
                  {k.code}
                </span>
              )}
              <span className="nwrowbody">
                <span className="nwrowtitle">{a.title}</span>
                <span className="nwrowmeta">{metaBits(a, m)}</span>
              </span>
            </a>
          );
        })}
      </div>
    </aside>
  );
}
