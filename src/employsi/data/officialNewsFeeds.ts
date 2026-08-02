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
 * A feed added here must be a real RSS/Atom endpoint, not a page of links —
 * the parser reads <item> blocks. The PTA's media-statements page advertises
 * one via <link rel="alternate">, which is how the URL below was found from the
 * page address.
 */
export interface OfficialFeed {
  /** RSS/Atom endpoint. */
  url: string;
  /** Shown as the article's source in the card. */
  publisher: string;
  /** The human-facing page the feed belongs to, for reference. */
  page: string;
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
};

/**
 * Asked for, but NOT listed above, because neither publishes a feed this reader
 * can consume — and the reader parses <item> blocks, so pointing it at a page
 * of links would return nothing and quietly blank the card:
 *
 *   ChemCentre   https://www.chemcentre.wa.gov.au/news-events/news
 *                No RSS anywhere on the domain; /rss and /news-events/news/rss
 *                both 404, and the page advertises no <link rel="alternate">.
 *   South Metro  https://smhs.health.wa.gov.au/News
 *   Health Svc   /News/rss answers 200 but carries zero <item> elements, which
 *                is worse than a 404 — it looks like a feed and is not one.
 *
 * Both keep the default Bing-on-company-name source until either publishes a
 * feed or this module grows an HTML-scraping path. Listing them here so the
 * next person does not re-derive the same two dead ends.
 */

/** The official feed for a news query, if the company has one. */
export function officialFeedFor(query: string): OfficialFeed | undefined {
  return OFFICIAL_NEWS_FEEDS[query.replace(/^"|"$/g, "").trim()];
}
