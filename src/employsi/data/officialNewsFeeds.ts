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
};

/** The official feed for a news query, if the company has one. */
export function officialFeedFor(query: string): OfficialFeed | undefined {
  return OFFICIAL_NEWS_FEEDS[query.replace(/^"|"$/g, "").trim()];
}
