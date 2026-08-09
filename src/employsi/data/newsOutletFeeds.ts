// GENERATED — do not edit by hand. Run scripts/gen-news-outlets.py.
// Source: github.com/plenaryapp/awesome-rss-feeds (country lists + the
// Business & Economy recommended list), filtered to the roster's countries.
//
// These widen the shared article pool the "in the news" card already uses:
// recent articles are fetched from the outlets for a company's OWN country
// plus the business pool, and kept when the headline names the company.
//
// EVERY FEED HERE ANSWERED AND PARSED AT GENERATION TIME, with at least one
// item. A curated list is a snapshot of when it was curated, and a dead entry
// costs a request per refresh and returns nothing — invisibly, because the
// pool swallows its own failures. Feeds that failed were dropped, not carried.
//
// COVERAGE IS PARTIAL. The upstream list has no feeds for these roster
// countries: New Zealand, United Arab Emirates, Switzerland, South Korea, China, Singapore, Malaysia.
// Companies plotted there fall back to Bing and the hand-picked outlets, as
// they did before this file existed.

export interface OutletFeed {
  url: string;
  publisher: string;
}

/** Country code → national outlets. "business" is global, used everywhere. */
export const NEWS_OUTLETS: Record<string, OutletFeed[]> = {
  au: [
    { url: "https://www.abc.net.au/news/feed/1948/rss.xml", publisher: "ABC News" },
    { url: "https://www.brisbanetimes.com.au/rss/feed.xml", publisher: "Brisbane Times" },
    { url: "https://feeds.feedburner.com/com/rCTl", publisher: "Crikey" },
    { url: "http://feeds.feedburner.com/IndependentAustralia", publisher: "Independent Australia" },
    { url: "https://www.perthnow.com.au/news/feed", publisher: "PerthNow" },
    { url: "https://www.smh.com.au/rss/feed.xml", publisher: "Sydney Morning Herald" },
    { url: "https://www.theage.com.au/rss/feed.xml", publisher: "The Age" },
    { url: "https://www.canberratimes.com.au/rss.xml", publisher: "The Canberra Times" },
  ],
  business: [
    {
      url: "https://seekingalpha.com/market_currents.xml",
      publisher: "Breaking News on Seeking Alpha",
    },
    { url: "https://www.forbes.com/business/feed/", publisher: "forbes.com" },
    { url: "https://fortune.com/feed", publisher: "Fortune" },
    { url: "https://www.investing.com/rss/news.rss", publisher: "investing.com" },
    { url: "https://finance.yahoo.com/news/rssindex", publisher: "Yahoo Finance" },
  ],
  ca: [
    { url: "https://www.cbc.ca/cmlink/rss-topstories", publisher: "CBC" },
    { url: "https://business.financialpost.com/feed/", publisher: "Financial Post" },
    { url: "https://globalnews.ca/feed/", publisher: "globalnews.ca" },
    { url: "https://www.lapresse.ca/actualites/rss", publisher: "LaPresse.ca" },
    { url: "https://nationalpost.com/feed/", publisher: "National Post" },
    { url: "https://ottawacitizen.com/feed/", publisher: "Ottawa Citizen" },
    { url: "https://theprovince.com/feed/", publisher: "The Province" },
    { url: "https://torontosun.com/category/news/feed", publisher: "Toronto Sun" },
  ],
  fr: [
    { url: "https://www.nouvelobs.com/a-la-une/rss.xml", publisher: "A la une" },
    { url: "https://www.france24.com/en/rss", publisher: "france24.com" },
    { url: "https://www.francetvinfo.fr/titres.rss", publisher: "Franceinfo" },
    { url: "https://www.sudouest.fr/essentiel/rss.xml", publisher: "L'essentiel" },
    { url: "https://www.ladepeche.fr/rss.xml", publisher: "ladepeche.fr" },
    { url: "https://www.huffingtonpost.fr/feeds/index.xml", publisher: "Le Huffington Post" },
    { url: "https://www.lemonde.fr/rss/une.xml", publisher: "lemonde.fr" },
    { url: "https://www.mediapart.fr/articles/feed", publisher: "Mediapart" },
    { url: "https://www.ouest-france.fr/rss-en-continu.xml", publisher: "Ouest-France" },
    { url: "https://www.parisstaronline.com/feed", publisher: "Paris Star" },
  ],
  gb: [
    { url: "http://feeds.bbci.co.uk/news/rss.xml", publisher: "BBC News" },
    {
      url: "http://feeds.feedburner.com/daily-express-news-showbiz",
      publisher: "Daily Express :: News Feed",
    },
    { url: "https://www.dailymail.co.uk/home/index.rss", publisher: "Mail Online" },
    { url: "https://www.theguardian.com/world/rss", publisher: "The Guardian" },
  ],
  hk: [
    { url: "https://www.hongkongfp.com/feed/", publisher: "Hong Kong Free Press HKFP" },
    {
      url: "http://feeds.hongkongnews.net/rss/b82693edf38ebff8",
      publisher: "hongkongnews.net latest rss headlines",
    },
  ],
  in: [
    { url: "http://feeds.bbci.co.uk/news/world/asia/india/rss.xml", publisher: "BBC News" },
    { url: "https://www.thehindubusinessline.com/feeder/default.rss", publisher: "Business Line" },
    {
      url: "https://economictimes.indiatimes.com/rssfeedsdefault.cms",
      publisher: "Economic Times",
    },
    { url: "https://www.freepressjournal.in/stories.rss", publisher: "Free Press Journal" },
    {
      url: "https://www.business-standard.com/rss/home_page_top_stories.rss",
      publisher: "Home Page",
    },
    { url: "https://www.dnaindia.com/feeds/india.xml", publisher: "India News" },
    { url: "https://www.indiatoday.in/rss/home", publisher: "India Today" },
    { url: "https://feed.livehindustan.com/rss/3127", publisher: "Live Hindustan Rss feed" },
    { url: "https://feeds.feedburner.com/opindia", publisher: "OpIndia" },
    { url: "http://feeds.feedburner.com/ScrollinArticles.rss", publisher: "Scroll.in" },
    { url: "https://www.sebi.gov.in/sebirss.xml", publisher: "SEBI RSS Feed" },
    {
      url: "https://prod-qt-images.s3.amazonaws.com/production/swarajya/feed.xml",
      publisher: "Swarajya",
    },
    { url: "https://www.deccanchronicle.com/rss_feed/", publisher: "Technology news" },
    { url: "https://www.theguardian.com/world/india/rss", publisher: "The Guardian" },
    { url: "https://www.thehindu.com/feeder/default.rss", publisher: "The Hindu" },
    {
      url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
      publisher: "Times of India",
    },
    { url: "https://www.news18.com/rss/world.xml", publisher: "Top World News- News18.com" },
    { url: "https://feeds.feedburner.com/ndtvnews-top-stories", publisher: "Topstories" },
    {
      url: "https://www.amarujala.com/rss/breaking-news.xml",
      publisher:
        "\u0905\u092e\u0930 \u0909\u091c\u093e\u0932\u093e \u0939\u093f\u0902\u0926\u0940 \u0928\u094d\u092f\u0942\u095b",
    },
    {
      url: "https://www.bhaskar.com/rss-feed/1061/",
      publisher: "\u0926\u0948\u0928\u093f\u0915 \u092d\u093e\u0938\u094d\u0915\u0930",
    },
    {
      url: "https://www.divyabhaskar.co.in/rss-feed/1037/",
      publisher: "\u0aa6\u0abf\u0ab5\u0acd\u0aaf \u0aad\u0abe\u0ab8\u0acd\u0a95\u0ab0",
    },
  ],
  jp: [
    {
      url: "http://feeds.feedburner.com/SdJapan",
      publisher:
        "BRIDGE\uff08\u30d6\u30ea\u30c3\u30b8\uff09\u30c6\u30af\u30ce\u30ed\u30b8\u30fc\uff06\u30b9\u30bf\u30fc\u30c8\u30a2\u30c3\u30d7\u60c5\u5831",
    },
    {
      url: "https://www.japantimes.co.jp/feed/topstories/",
      publisher: "Japan Times latest articles",
    },
    { url: "https://japantoday.com/feed", publisher: "Japan Today" },
    { url: "http://www.newsonjapan.com/rss/top.xml", publisher: "News On Japan" },
    {
      url: "https://news.livedoor.com/topics/rss/top.xml",
      publisher: "\u30e9\u30a4\u30d6\u30c9\u30a2\u30cb\u30e5\u30fc\u30b9",
    },
  ],
  ph: [
    { url: "https://www.bworldonline.com/feed/", publisher: "BusinessWorld" },
    { url: "https://currentph.com/feed/", publisher: "Current PH" },
    { url: "http://feeds.feedburner.com/Techpinas", publisher: "feeds.feedburner.com" },
    { url: "https://data.gmanews.tv/gno/rss/news/feed.xml", publisher: "GMA News Online / News" },
    { url: "https://www.inquirer.net/fullfeed", publisher: "INQUIRER.net" },
    { url: "https://www.interaksyon.com/feed/", publisher: "Interaksyon" },
    { url: "https://www.philnews.xyz/feeds/posts/default?alt=rss", publisher: "PhilNews.XYZ" },
    { url: "https://www.philstar.com/rss/headlines", publisher: "philstar.com" },
    { url: "https://www.topgear.com.ph/feed/rss1", publisher: "topgear.com.ph" },
    { url: "https://www.unbox.ph/feed/", publisher: "UNBOX PH" },
  ],
  us: [
    { url: "http://feeds.foxnews.com/foxnews/latest", publisher: "FOX News" },
    { url: "https://rss.politico.com/playbook.xml", publisher: "Playbook" },
    { url: "http://feeds.washingtonpost.com/rss/world", publisher: "World" },
    { url: "https://www.latimes.com/world-nation/rss2.0.xml", publisher: "World & Nation" },
    { url: "https://www.huffpost.com/section/world-news/feed", publisher: "World News" },
    { url: "https://news.yahoo.com/rss/mostviewed", publisher: "Yahoo News" },
  ],
  za: [
    { url: "https://api.axios.com/feed/", publisher: "Axios" },
    { url: "https://www.dailymaverick.co.za/dmrss/", publisher: "Daily Maverick" },
    { url: "http://rss.iol.io/iol/news", publisher: "IOL section feed for News" },
    { url: "https://www.moneyweb.co.za/feed/", publisher: "Moneyweb" },
    { url: "https://techcentral.co.za/feed", publisher: "TechCentral" },
    { url: "https://citizen.co.za/feed/", publisher: "The Citizen" },
    { url: "https://www.thesouthafrican.com/feed/", publisher: "The South African" },
  ],
};

/** Roster countries the upstream list does not cover. */
export const OUTLETS_UNCOVERED: string[] = [
  "New Zealand",
  "United Arab Emirates",
  "Switzerland",
  "South Korea",
  "China",
  "Singapore",
  "Malaysia",
];

/**
 * Feeds that REFUSED THE GENERATOR'S ADDRESS (403/405/429/5xx), which is not
 * the same as being dead. These were checked from a datacentre host; the app
 * asks from a Cloudflare Worker, which may be served. They are NOT used —
 * they are kept so the finding is not lost and can be retested from where the
 * app actually runs, rather than being silently re-dropped by every rerun.
 */
export const OUTLETS_REFUSED_FROM_GENERATOR: OutletFeed[] = [
  { url: "https://www.michaelwest.com.au/feed/", publisher: "Michael West" }, // au: HTTPError: HTTP Error 403: Forbidden
  {
    url: "https://www.diplomatie.gouv.fr/spip.php?page=backend-fd&lang=en",
    publisher: "Ministry for Europe and Foreign Affairs",
  }, // fr: HTTPError: HTTP Error 403: Forbidden
  { url: "http://www.independent.co.uk/news/uk/rss", publisher: "The Independent" }, // gb: HTTPError: HTTP Error 403: Forbidden
  {
    url: "https://www.hket.com/rss/hongkong",
    publisher: "\u9999\u6e2f\u7d93\u6fdf\u65e5\u5831 hket.com",
  }, // hk: HTTPError: HTTP Error 405: Not Allowed
  { url: "http://api.patrika.com/rss/india-news", publisher: "api.patrika.com" }, // in: HTTPError: HTTP Error 522: <none>
  { url: "http://www.moneycontrol.com/rss/latestnews.xml", publisher: "Moneycontrol Latest News" }, // in: HTTPError: HTTP Error 403: Forbidden
  { url: "http://indianexpress.com/print/front-page/feed/", publisher: "The Indian Express" }, // in: HTTPError: HTTP Error 403: Forbidden
  {
    url: "http://rss.asahi.com/rss/asahi/newsheadlines.rdf",
    publisher: "\u671d\u65e5\u65b0\u805e\u30c7\u30b8\u30bf\u30eb",
  }, // jp: HTTPError: HTTP Error 403: Forbidden
  { url: "https://businessmirror.com.ph/feed/", publisher: "BusinessMirror" }, // ph: HTTPError: HTTP Error 403: Forbidden
  { url: "https://pia.gov.ph/news/feed.rss", publisher: "Philippine Information Agency" }, // ph: HTTPError: HTTP Error 403: Forbidden
  { url: "https://www.pna.gov.ph/latest.rss", publisher: "Philippine News Agency" }, // ph: HTTPError: HTTP Error 403: Forbidden
  { url: "http://tempo.com.ph/feed/", publisher: "The Nation's Fastest Growing Newspaper" }, // ph: HTTPError: HTTP Error 522: Unknown
  {
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    publisher: "US Top News and Analysis",
  }, // us: HTTPError: HTTP Error 403: Forbidden
  {
    url: "http://feeds.news24.com/articles/news24/TopStories/rss",
    publisher: "News24 Top Stories",
  }, // za: HTTPError: HTTP Error 403: Forbidden
];
