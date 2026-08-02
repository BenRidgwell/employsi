/**
 * Companies whose "in the news" panel reads their OWN newsroom feed rather than
 * a Bing News search on the company name.
 *
 * The default path searches for the company's name, which works for employers
 * the press writes about by name. It works badly for a public agency: a search
 * for "Public Transport Authority" returns transport stories from every
 * jurisdiction, ministerial commentary and generic coverage that mentions the
 * phrase, rather than what the agency itself published.
 *
 * Where an organisation publishes a real feed, that feed is better on every
 * axis — it is what they actually said, it is dated, and the links go to them.
 * So a name listed here bypasses Bing, GDELT and the shared outlet pool
 * entirely: the point is to change the source, not to blend one in.
 *
 * Keyed by company NAME, because that is what the news query is built from at
 * every call site (the app's liveNewsFn and the nightly cron in
 * workers/jobs-cron/news.ts both start from the roster name).
 *
 * TWO WAYS IN. `kind: "rss"` (the default) needs a real RSS/Atom endpoint,
 * because that reader parses <item> blocks — the PTA's media-statements page
 * advertises one via <link rel="alternate">, which is how its URL was found.
 * `kind: "html"` reads the newsroom LISTING PAGE itself through
 * lib/newsroomScrape.ts, for the many organisations that publish news properly
 * and no feed at all. Prefer RSS when a site has one: it is stable, dated and
 * cannot be broken by a redesign.
 */
import type { ScrapeConfig } from "../lib/newsroomScrape";

export interface OfficialFeed {
  /** RSS/Atom endpoint, or — with kind: "html" — the listing page to read. */
  url: string;
  /** Shown as the article's source in the card. */
  publisher: string;
  /** The human-facing page the feed belongs to, for reference. */
  page: string;
  /** How to read `url`. Omit for RSS. */
  kind?: "rss" | "html";
  /**
   * HTML only. `page` is filled in from the entry's own `page` when the scraper
   * runs, so an entry only states the matching rules.
   */
  scrape?: Omit<ScrapeConfig, "page">;
}

export const OFFICIAL_NEWS_FEEDS: Record<string, OfficialFeed> = {
  "Public Transport Authority": {
    url: "https://www.pta.wa.gov.au/news/media-statements/rss/3050",
    publisher: "PTA WA",
    page: "https://www.pta.wa.gov.au/news/media-statements",
  },
  // Site-wide Drupal feed rather than a news-and-events-specific one — that
  // path 404s — but its items ARE the newsroom: verified live, 10 items, the
  // most recent being "Student creativity impresses visiting muso" and
  // "GovHack TAFE students receive national recognition".
  "South Regional TAFE": {
    url: "https://www.southregionaltafe.wa.edu.au/rss.xml",
    publisher: "South Regional TAFE",
    page: "https://www.southregionaltafe.wa.edu.au/news-and-events",
  },
  // WordPress, so the feed is the standard /feed/ endpoint the news-media page
  // advertises in its <head>. Verified live: 7 items, led by "Talloman Poultry
  // Rendering Facility Opening".
  "Craig Mostyn": {
    url: "https://www.craigmostyn.com.au/feed/",
    publisher: "Craig Mostyn Group",
    page: "https://www.craigmostyn.com.au/news-media/",
  },
  // ── Read from the newsroom page, because there is no feed to read ───────
  // Both of these were previously listed as dead ends: ChemCentre publishes no
  // RSS anywhere on its domain (/rss and /news-events/news/rss both 404, and
  // the page advertises no <link rel="alternate">), and South Metropolitan
  // Health Service's /News/rss answers 200 with zero <item> elements, which is
  // worse than a 404 because it looks like a feed. Both now come through the
  // HTML path instead.
  "South Metropolitan Health Service": {
    url: "https://smhs.health.wa.gov.au/News",
    publisher: "South Metropolitan Health Service",
    page: "https://smhs.health.wa.gov.au/News",
    kind: "html",
    // Articles are pathed by publication date — /News/2026/07/24/<slug> — so
    // the pattern doubles as the date source and cannot match a nav link.
    // Measured on the live page: 4 articles, each with its own photograph.
    scrape: { match: "/News/20\\d{2}/\\d{2}/\\d{2}/" },
  },
  ChemCentre: {
    url: "https://www.chemcentre.wa.gov.au/news-events/news",
    publisher: "ChemCentre",
    page: "https://www.chemcentre.wa.gov.au/news-events/news",
    kind: "html",
    // The page carries NO article anchors at all: it is Kentico, and the news
    // ships as serialised CMS document objects inside the markup. See the
    // "kentico-json" note in lib/newsroomScrape.ts. Measured: 78 articles,
    // newest 2026-07-21.
    scrape: { strategy: "kentico-json", base: "/news-events/news" },
  },
};

/** The official feed for a news query, if the company has one. */
export function officialFeedFor(query: string): OfficialFeed | undefined {
  return OFFICIAL_NEWS_FEEDS[query.replace(/^"|"$/g, "").trim()];
}
