/**
 * Read a newsroom LISTING PAGE and return its articles.
 *
 * The official-feed path (data/officialNewsFeeds.ts) has always required a real
 * RSS/Atom endpoint, because the reader parses <item> blocks. Plenty of
 * organisations publish a perfectly good newsroom and no feed at all — the two
 * that forced this were ChemCentre, which has no RSS anywhere on the domain,
 * and South Metropolitan Health Service, whose /News/rss answers 200 with zero
 * items, which is worse than a 404 because it looks like a feed.
 *
 * So this is the HTML path beside the RSS one. It is deliberately a PARSER, not
 * a fetcher: it takes markup and returns items, so the app's server function and
 * the nightly cron can share exactly one implementation and one set of rules,
 * and so it can be run against saved markup when a site changes shape.
 *
 * TWO STRATEGIES, AND WHY THERE ARE TWO
 *
 *   "links" (the default) walks the anchors and keeps the ones whose href
 *   matches the site's article pattern. This is what a normal newsroom needs and
 *   it is what new sites should use. Titles come from the anchor's own text; the
 *   date comes from the URL when the site puts one there (a lot do), else from
 *   a <time datetime> or a plain date near the link; the image from the nearest
 *   <img> inside the same card.
 *
 *   "kentico-json" exists for one measured reason. ChemCentre runs Kentico and
 *   ships its news as serialised CMS document objects inside the page — there
 *   are no article anchors in the HTML at all, so the links strategy returns
 *   nothing however it is tuned. Title, slug and publish date are all there as
 *   named fields, so they are read directly. This is tied to that CMS and is
 *   expected to break if the site is rebuilt; that is why it is named after the
 *   CMS rather than the company, and why it fails to zero items rather than
 *   guessing (an empty result falls through to the search path, so the card
 *   keeps working).
 *
 * Nothing here invents a date. An article with no discoverable date gets an
 * empty `published`, which the card renders as no date rather than as today.
 */

export interface NewsroomItem {
  title: string;
  url: string;
  /** ISO string, or "" when the page does not say. Never guessed. */
  published: string;
  image?: string;
}

export interface ScrapeConfig {
  /** Absolute URL of the listing page, used to resolve relative hrefs. */
  page: string;
  /** Which reader to use. Omit for "links". */
  strategy?: "links" | "kentico-json";
  /** links: an href must match this (source string, case-insensitive). */
  match?: string;
  /** links: hrefs matching this are dropped — nav, tags, pagination, feeds. */
  exclude?: string;
  /** kentico-json: the path articles live under, e.g. "/news-events/news". */
  base?: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Anchor text minus its markup, collapsed. */
function text(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(href: string, page: string): string {
  try {
    return new URL(href, page).toString();
  } catch {
    return "";
  }
}

/**
 * A date from the article URL. Many newsrooms path articles by publication date
 * (SMHS is /News/2026/07/24/<slug>), and when they do it is the most reliable
 * date on the page — it cannot be confused with an event date, a "last
 * reviewed" stamp or a date sitting in an unrelated sidebar.
 */
function dateFromUrl(url: string): string {
  const m = url.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

/** A date from markup near the link: <time datetime>, then "24 July 2026". */
function dateFromMarkup(block: string): string {
  const iso = block.match(/datetime="([^"]+)"/i);
  if (iso) {
    const t = Date.parse(iso[1]);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  const long = block.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\s+(20\\d{2})\\b`, "i"));
  if (long) {
    const t = Date.parse(`${long[1]} ${long[2]} ${long[3]} UTC`);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return "";
}

function imageFromMarkup(block: string, page: string): string | undefined {
  const m = block.match(/<img\b[^>]*\bsrc="([^"]+)"/i);
  if (!m) return undefined;
  const url = absolute(decode(m[1]), page);
  // A data: URI is a placeholder or a spacer, never the article's photograph.
  return url && !url.startsWith("data:") ? url : undefined;
}

/**
 * A title has to look like one. Anchor text on a listing page routinely swallows
 * the teaser and the date as well ("AusAlert national test 27 July 24 July 2026
 * Australia's new national…"), so it is cut at the first date-looking run and
 * capped — the whole paragraph is not a headline.
 */
function tidyTitle(raw: string): string {
  let t = raw.replace(new RegExp(`\\s+\\d{1,2}\\s+(${MONTHS})\\s+20\\d{2}\\b.*$`, "i"), "");
  t = t.replace(/\s+\d{1,2}\/\d{1,2}\/20\d{2}\b.*$/, "").trim();
  if (t.length > 160) t = t.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  return t;
}

function byNewestFirst(a: NewsroomItem, b: NewsroomItem): number {
  return (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0);
}

/** Strategy "links": the anchors of a normal newsroom listing. */
function fromLinks(html: string, cfg: ScrapeConfig): NewsroomItem[] {
  if (!cfg.match) return [];
  const match = new RegExp(cfg.match, "i");
  const exclude = cfg.exclude ? new RegExp(cfg.exclude, "i") : null;
  // Collected first, then windowed, because a card's <time> and <img> can sit
  // on either side of its link and a fixed ±N window reaches into the NEIGHBOUR's
  // card. Measured on South Metropolitan Health Service: a 1,200-character
  // lookbehind gave the second article the first one's photograph. Bounding each
  // block by the surrounding article links instead cannot cross that line.
  type Hit = { url: string; title: string; from: number; to: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decode(m[1]);
    if (!match.test(href)) continue;
    if (exclude && exclude.test(href)) continue;
    const url = absolute(href, cfg.page);
    if (!url || seen.has(url)) continue;
    const title = tidyTitle(text(m[2]));
    // An anchor with no words is an image link or an icon; the same article
    // almost always appears again as a text link, so skipping loses nothing.
    if (title.length < 8) continue;
    seen.add(url);
    hits.push({ url, title, from: m.index, to: m.index + m[0].length });
  }

  const out: NewsroomItem[] = hits.map((h, i) => {
    const start = i === 0 ? Math.max(0, h.from - 1200) : hits[i - 1].to;
    const end = i === hits.length - 1 ? Math.min(html.length, h.to + 1200) : hits[i + 1].from;
    const block = html.slice(start, end);
    return {
      title: h.title,
      url: h.url,
      published: dateFromUrl(h.url) || dateFromMarkup(block),
      image: imageFromMarkup(block, cfg.page),
    };
  });
  return out.sort(byNewestFirst);
}

/**
 * Strategy "kentico-json": serialised CMS document objects embedded in the page.
 *
 * Each article contributes a `"NewsTitle"`, a `"NodeAlias"` (the URL slug) and a
 * `"DocumentPublishFrom"`. They are not adjacent — a document object carries
 * scores of fields — so each title is paired with the LAST alias and publish
 * date declared before it, which is that document's own. Verified against the
 * live page: 78 titles, each pairing to the matching slug and date.
 */
function fromKenticoJson(html: string, cfg: ScrapeConfig): NewsroomItem[] {
  const base = (cfg.base || "").replace(/\/$/, "");
  if (!base) return [];
  const out: NewsroomItem[] = [];
  const seen = new Set<string>();
  const re = /"NewsTitle":"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const title = decode(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")).trim();
    if (!title) continue;
    const before = html.slice(Math.max(0, m.index - 20000), m.index);
    const alias = [...before.matchAll(/"NodeAlias":"([^"]+)"/g)].pop()?.[1];
    if (!alias) continue;
    const when = [...before.matchAll(/"DocumentPublishFrom":"([^"]+)"/g)].pop()?.[1];
    // Kentico's canonical URL for the page is the alias lowercased; the
    // mixed-case form 301s to it, so it is written out already resolved.
    const url = absolute(`${base}/${alias.toLowerCase()}`, cfg.page);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const t = when ? Date.parse(when + "Z") : NaN;
    out.push({ title, url, published: Number.isNaN(t) ? "" : new Date(t).toISOString() });
  }
  return out.sort(byNewestFirst);
}

/** Articles from a newsroom listing page's markup. Empty when it cannot tell. */
export function scrapeNewsroom(html: string, cfg: ScrapeConfig): NewsroomItem[] {
  if (!html) return [];
  return cfg.strategy === "kentico-json" ? fromKenticoJson(html, cfg) : fromLinks(html, cfg);
}
