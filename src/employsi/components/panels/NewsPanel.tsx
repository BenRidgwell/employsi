import { useMemo } from "react";
import { companyNews, liveToCompanyNews, type CompanyNews, type NewsItem } from "../../data/news";
import { useArticleImages } from "../../hooks/useArticleImages";
import { useLiveNews } from "../../hooks/useLiveNews";
import { useCompanyPosts } from "../../hooks/useCompanyPosts";
import type { ArticleMeta } from "../../lib/articleImageFn";
import { isBlockedArticle } from "../../data/newsBlocklist";
import { CardLoader } from "./CardLoader";

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
// EVERY company pulls a live feed on the Worker (Bing News → GDELT → named
// outlet RSS), falling back to whatever data/news.ts has — a hand-curated real
// feed for the 14 pilots, generated copy for everyone else — only when the live
// feed comes back empty. Article images come from the feed's own image, or the
// Worker's og:image scrape of the article page.

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
//
// The age is shown ONLY when a real publish timestamp is in hand. This used to
// fall back to a `time` string stored beside the headline, and that string was
// written once and never moved: the hero on every curated feed claimed "2d
// ago", "3d ago", "5d ago" while the articles behind them were 8 months to 2
// YEARS old (Fortescue's said 3 days for a piece published in July 2024).
//
// Worse, it was inconsistent in a way that hid itself. The fallback only
// applied when the Worker's scrape came back empty — so a card whose article
// exposes a date showed the true "1y ago", and one whose publisher blocks the
// scrape showed the invented "3d ago", in the same "Trending" slot. Half the
// feed looked current because we could not read it.
//
// So: no timestamp, no age. "Trending · MINING.COM" is the honest line.
function metaBits(item: NewsItem, meta?: ArticleMeta): string {
  const iso = publishedOf(item, meta);
  const publisher = pubOf(item, meta);
  return [item.cat, publisher, iso ? relTime(iso) : ""].filter(Boolean).join(" · ");
}

function Thumb({ img, seed, className }: { img?: string; seed: string; className: string }) {
  const style = img ? { backgroundImage: `url("${img}")` } : { backgroundImage: gradientFor(seed) };
  return <div className={className} style={style} aria-hidden />;
}

/**
 * The employer's own publications are tagged, always.
 *
 * A LinkedIn post is the company talking about itself; an article is somebody
 * else reporting on it. They carry very different weight, and side by side in
 * one list the layout alone implies they are the same kind of thing. The chip
 * is what stops the card presenting an announcement as coverage.
 */
function PostTag() {
  return (
    <span className="nwposttag">
      <svg viewBox="0 0 24 24" width={9} height={9} fill="currentColor" aria-hidden>
        <path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM3 9.75h4v10.75H3V9.75Zm6.5 0h3.83v1.47h.05a4.2 4.2 0 0 1 3.78-2.08c4.04 0 4.79 2.66 4.79 6.12v5.24h-4v-4.65c0-1.11-.02-2.54-1.55-2.54-1.55 0-1.79 1.21-1.79 2.46v4.73h-4V9.75Z" />
      </svg>
      Company post
    </span>
  );
}

/** Push-right chevron: the panel slides under the company card, not away. */
function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" aria-hidden>
      <g strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 6 15 12 9 18" />
        <line x1="19" y1="5" x2="19" y2="19" />
      </g>
    </svg>
  );
}

export function NewsPanel({
  name,
  sector,
  ticker,
  companyId,
  live,
  collapsed,
  onToggleCollapse,
  loading,
}: {
  name: string;
  sector: string;
  ticker?: string;
  companyId?: string;
  live?: CompanyNews | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** True while the company card itself is still resolving. */
  loading?: boolean;
}) {
  const generated = useMemo(() => companyNews(name, sector), [name, sector]);
  // EVERY company fetches the live feed, keyed on the company name alone (the
  // most reliable query). The fourteen pilots used to skip it and show their
  // hand-curated feed instead, and that feed does not refresh: by 2026-08 its
  // "Trending" heroes were eight months to two years old, and Fortescue's led
  // the card with a story from July 2024. A curated feed is only better than a
  // live one while somebody is curating it.
  //
  // The curated set is still here and still good — it is now the FALLBACK,
  // which is what it was always the right shape to be: real, checked articles
  // for the day the live feed returns nothing.
  void ticker;
  const liveQuery = !live ? `"${name}"` : null;
  const { items: liveItems, pending: newsPending } = useLiveNews(liveQuery, 6);
  const liveFeed = useMemo(() => liveToCompanyNews(liveItems), [liveItems]);

  // The company's own LinkedIn posts, collected daily (see
  // lib/companyPostsFn.ts). Merged into the SAME list as the articles rather
  // than given their own section: the question the card answers is "what has
  // happened here lately", and the answer includes what the employer itself
  // said. What keeps that honest is the tag on every post, not a separate box.
  const posts = useCompanyPosts(companyId ?? null, 4);
  const postItems = useMemo<NewsItem[]>(
    () =>
      posts.map((p) => ({
        cat: "Company post",
        title: p.title,
        comments: 0,
        url: p.url,
        image: p.image,
        publisher: p.author || "LinkedIn",
        publishedIso: p.published,
        kind: "post" as const,
      })),
    [posts],
  );

  // `live` (a feed handed in by the caller) beats the fetched one, which beats
  // the curated/generated fallback. One order for every company now.
  const articleNews = live ?? liveFeed ?? generated;
  // Interleaved by date, so recency decides the order and neither source can
  // permanently outrank the other. The HERO stays an article whenever one
  // exists — leading the card with the employer's own post would give a
  // marketing line the most editorial-looking slot on the card.
  const rawNews = useMemo<CompanyNews>(() => {
    if (!postItems.length) return articleNews;
    const at = (a: NewsItem) => Date.parse(a.publishedIso || "") || 0;
    const merged = [...articleNews.items, ...postItems].sort((a, b) => at(b) - at(a));
    return { hero: articleNews.hero, items: merged };
  }, [articleNews, postItems]);
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

  // `updated` is still computed — it is the feed's real recency and the
  // collapsed tab shows it — but it no longer occupies the header, which is now
  // the collapse control.
  return (
    <aside
      className={`newspanel${collapsed ? " collapsed" : ""}`}
      /* Collapsed, the whole panel is one big target: only a ~26px sliver of it
         is on screen, and asking someone to hit a 15px button inside that
         sliver would be a worse control than the one it replaced. */
      onClick={collapsed ? onToggleCollapse : undefined}
    >
      {/* The spine that stays visible when the panel is tucked behind the card.
          Rendered always so it does not pop in mid-transition. */}
      <span className="nwspine" aria-hidden={!collapsed}>
        <span className="nwspinetext">In the news</span>
      </span>
      {/* Dark tone: this column is ink, so the light loader would punch a white
          hole in it.
          Shown while the COMPANY CARD is resolving as well as while this
          column's own feed is in flight. Previously only the latter, so a
          curated company — or any company whose feed arrived first — opened
          with a finished news column beside a still-loading card, which read
          as the pair being broken rather than busy. The two now start and
          finish together. */}
      {(loading || newsPending) && !collapsed && <CardLoader tone="dark" />}
      <div className="nwhd">
        <span className="nwhdname">In the news</span>
        {onToggleCollapse && (
          <button
            type="button"
            className="nwcollapse"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Show the news panel" : "Tuck the news panel away"}
            title={
              collapsed
                ? "Show the news panel"
                : updated
                  ? `Tuck away · updated ${updated}`
                  : "Tuck the news panel away"
            }
          >
            <CollapseIcon />
          </button>
        )}
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
                <span className="nwrowmeta">
                  {a.kind === "post" && <PostTag />}
                  {metaBits(a, m)}
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </aside>
  );
}
