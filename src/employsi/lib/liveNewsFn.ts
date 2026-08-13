import { createServerFn } from "@tanstack/react-start";
import { officialFeedFor, type OfficialFeed } from "../data/officialNewsFeeds";
import { scrapeNewsroom } from "./newsroomScrape";
import { newsQueryFor } from "../data/newsQueries";
import type { JsonRecord } from "./json";
import { str } from "./json";
import { isBlockedArticle } from "../data/newsBlocklist";
import { xrefKey, XREF_MAX_AGE_MS } from "./newsMentions";
import { kvBinding } from "./kv";
import { COMPANIES } from "../data/companies";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { CITY_COUNTRY } from "../data/cityCountry";
import { NEWS_OUTLETS } from "../data/newsOutletFeeds";

// NB: kept out of any `server/` directory — the bundler denies importing paths
// under **/server/**. createServerFn runs this only on the Cloudflare Worker,
// which is what lets it fetch news providers cross-origin.
//
// Two providers, tried in order — BOTH resolve to real publisher articles (no
// aggregator redirect that dead-ends, unlike Google News which we no longer use):
//  1. Bing News RSS — query-specific, links carry the real destination URL (we
//     pull it out of Bing's click-wrapper) and the publisher name. Reliable.
//  2. GDELT DOC API — direct publisher URLs too, but it rate-limits a shared
//     Worker IP hard, so it's the secondary/top-up source.

export interface LiveNewsItem {
  title: string;
  url: string;
  publisher: string;
  published: string; // ISO
  image?: string; // article image when the provider supplies one (Bing / GDELT / outlet feeds)
}

const cache = new Map<string, { at: number; items: LiveNewsItem[] }>();
const TTL = 8 * 60 * 1000;

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]).trim() : null;
}

// GDELT seendate is "YYYYMMDDTHHMMSSZ" → ISO.
function gdeltDate(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function cleanDomain(d: string): string {
  return (d || "").replace(/^www\./, "");
}

async function fromGdelt(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<LiveNewsItem[]> {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
    encodeURIComponent(query) +
    `&mode=ArtList&maxrecords=${Math.min(limit * 2, 40)}&timespan=14d&format=json&sort=DateDesc`;
  const res = await fetch(url, { signal, headers: { "User-Agent": "employsi/1.0" } });
  if (!res.ok) return [];
  const text = await res.text();
  if (!text.startsWith("{")) return []; // rate-limit / html notice
  const json = JSON.parse(text) as { articles?: JsonRecord[] };
  const arts = Array.isArray(json.articles) ? json.articles : [];
  const seen = new Set<string>();
  const items: LiveNewsItem[] = [];
  for (const a of arts) {
    const url = str(a?.url);
    const title = str(a?.title);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    items.push({
      title: String(a.title),
      url: String(a.url),
      publisher: cleanDomain(String(a.domain || "")),
      published: gdeltDate(String(a.seendate || "")),
      image: a.socialimage ? String(a.socialimage) : undefined,
    });
    if (items.length >= limit) break;
  }
  return items;
}

// Bing News RSS. Its <link> is a click-wrapper (bing.com/news/apiclick.aspx?...&
// url=<REAL>) — we pull the real publisher URL out of the `url=` param so the
// link goes straight to the article. Publisher from <News:Source>; "X on MSN"
// is normalised to "X". Ordered newest-first.
function bingRealUrl(link: string): string {
  const m = link.match(/[?&]url=([^&]+)/i);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return link;
    }
  }
  return link;
}

/**
 * One organisation's own newsroom feed, used INSTEAD of the search providers.
 *
 * A plain RSS read — no Bing link-unwrapping, because these links already point
 * at the publisher. Every item carries the configured publisher name, since a
 * newsroom feed has only one source by definition.
 */
async function fromOfficialFeed(
  feed: OfficialFeed,
  limit: number,
  signal: AbortSignal,
): Promise<LiveNewsItem[]> {
  const html = feed.kind === "html";
  const res = await fetch(feed.url, {
    signal,
    headers: {
      "User-Agent": "employsi/1.0",
      Accept: html
        ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
        : "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) return [];
  // An organisation with a newsroom and no feed is read from the page itself.
  // Same contract either way: real items or none, never a guess.
  if (html) {
    const items = scrapeNewsroom(await res.text(), { ...(feed.scrape ?? {}), page: feed.page });
    return items.slice(0, limit).map((i) => ({
      title: i.title,
      url: i.url,
      publisher: feed.publisher,
      published: i.published,
      image: i.image,
    }));
  }
  const xml = await res.text();
  const items: LiveNewsItem[] = [];
  const seen = new Set<string>();
  for (const raw of xml.split(/<item>/i).slice(1, 60)) {
    const block = raw.split(/<\/item>/i)[0];
    const title = tag(block, "title");
    const link = tag(block, "link");
    const pub = tag(block, "pubDate");
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);
    const t = pub ? Date.parse(pub) : NaN;
    items.push({
      title,
      url: link,
      publisher: feed.publisher,
      published: Number.isNaN(t) ? "" : new Date(t).toISOString(),
      image: itemImage(block),
    });
  }
  items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return items.slice(0, limit);
}

async function fromBing(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<LiveNewsItem[]> {
  const url =
    "https://www.bing.com/news/search?q=" + encodeURIComponent(query) + "&format=RSS&setmkt=en-AU";
  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const items: LiveNewsItem[] = [];
  const seen = new Set<string>();
  const blocks = xml.split(/<item>/i).slice(1, 60);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0];
    const link = tag(block, "link");
    const title = tag(block, "title");
    const pub = tag(block, "pubDate");
    const srcM = block.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/i);
    let publisher = srcM ? decodeEntities(srcM[1]).trim() : "";
    publisher = publisher.replace(/\s+on\s+MSN$/i, "").trim();
    const imgM = block.match(/<News:Image[^>]*>([\s\S]*?)<\/News:Image>/i);
    const image = imgM ? decodeEntities(imgM[1]).trim() : undefined;
    if (!link || !title) continue;
    const real = bingRealUrl(link);
    if (/bing\.com\/news\/search/i.test(real) || seen.has(real)) continue; // skip the self-referential feed link
    seen.add(real);
    const t = pub ? Date.parse(pub) : NaN;
    items.push({
      title,
      url: real,
      publisher: cleanDomain(publisher),
      published: Number.isNaN(t) ? "" : new Date(t).toISOString(),
      image,
    });
  }
  items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return items.slice(0, limit);
}

// Direct AU / mining / business outlet feeds. Fetched once and shared across all
// companies (a rolling pool of recent coverage), then filtered by company name —
// so a company currently in the news gets straight-to-source articles from these
// named outlets on top of the Bing results. (AFR has no public RSS but Bing
// surfaces its articles; Bloomberg's markets feed stands in for it.)
const OUTLET_FEEDS: { url: string; publisher: string }[] = [
  { url: "https://www.mining.com/feed/", publisher: "MINING.COM" },
  { url: "https://www.businessnews.com.au/rssfeed/latest.rss", publisher: "Business News WA" },
  { url: "https://feeds.bloomberg.com/markets/news.rss", publisher: "Bloomberg" },
];

/**
 * Company name → country, for choosing which national press to pull.
 *
 * Built ONCE from CITY_COMPANIES rather than per call. The call site has a
 * company NAME (the news query is built from the roster name everywhere), not
 * an id, and cityForCompany() scans all 54 city lists per lookup — doing that
 * on every card open, inside a request already racing a news provider, would be
 * paying 1,500 comparisons to save a map.
 */
const COUNTRY_BY_NAME: Map<string, string> = (() => {
  const cityOf = new Map<string, string>();
  for (const [city, list] of Object.entries(CITY_COMPANIES)) {
    for (const c of list) if (!cityOf.has(c.id)) cityOf.set(c.id, city);
  }
  const out = new Map<string, string>();
  for (const c of COMPANIES) {
    const country = CITY_COUNTRY[cityOf.get(c.id) ?? ""];
    if (country) out.set(c.name.trim().toLowerCase(), country);
  }
  return out;
})();

function countryForCompanyName(name: string): string | null {
  return COUNTRY_BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/**
 * Does a headline actually name this company?
 *
 * A plain `title.includes(name)` was fine against three feeds and is not fine
 * against eighty-six. Measured on one live pull of the Australian pool: "Shell"
 * matched "Palantir CEO drops 11-word bombshell", and a company called "Built"
 * matched "built to fail". The pool's whole value is that its articles are
 * about the company, so a substring hit is worse than no hit — it puts a story
 * about US bond markets on a mining company's card, with a real image and a
 * real byline making it look thoroughly checked.
 *
 * So the name has to sit on WORD BOUNDARIES. Same fault, same fix as the skills
 * taxonomy's term matcher, which reads "legal" out of "paralegal" if you let it.
 *
 * The length floor is TWO, not four. Four was the obvious guess and it silently
 * excluded BHP — along with AGL, NAB, ANZ and every other three-letter name on
 * the roster, which are exactly the companies most written about. With word
 * boundaries doing the real work, a three-letter acronym in a headline is
 * almost always the company; one or two letters is not evidence of anything.
 *
 * What boundaries CANNOT fix is a company whose name is an ordinary word — a
 * headline saying something was "built to fail" matches a company called Built,
 * correctly by every rule available here. That is a limit of matching on names,
 * not a bug to code around, and it is why this only ever ADDS to the search
 * results rather than replacing them.
 */
function headlineMatcher(name: string): RegExp | null {
  const n = name.trim();
  if (n.length < 3) return null;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * How many feeds a single pool refresh may fetch, beyond the three above.
 *
 * The generated file holds 94 verified feeds. Fetching all of them to answer a
 * question about one company would be 94 subrequests against a Worker's
 * thousand-request budget, and ninety of them would be about the wrong country.
 * So a refresh takes the company's OWN national press plus the global business
 * pool, capped — enough to widen coverage materially without turning one card
 * open into a crawl.
 *
 * The cap bites only on India (22 feeds); every other country is under it.
 */
const MAX_COUNTRY_FEEDS = 12;
const MAX_BUSINESS_FEEDS = 8;

/**
 * The feeds to pull for a company in `country`.
 *
 * A country with no national feeds — New Zealand, the UAE, Switzerland, South
 * Korea, China, Singapore, Malaysia, 249 plotted companies — still gets the
 * business pool and the hand-picked three. It is narrower coverage, not a
 * failure, and it is the same coverage those companies had before this existed.
 */
function feedsFor(country: string | null): { url: string; publisher: string }[] {
  const national = country ? (NEWS_OUTLETS[country] ?? []).slice(0, MAX_COUNTRY_FEEDS) : [];
  const business = (NEWS_OUTLETS.business ?? []).slice(0, MAX_BUSINESS_FEEDS);
  const seen = new Set<string>();
  return [...OUTLET_FEEDS, ...national, ...business].filter((f) =>
    seen.has(f.url) ? false : (seen.add(f.url), true),
  );
}

// Cached PER COUNTRY, because the pools differ. One shared cache would serve a
// Perth company whichever country happened to warm it first — and would do so
// invisibly, since a pool that returns no name matches looks identical to a
// company nobody wrote about.
const outletCache = new Map<string, { at: number; items: LiveNewsItem[] }>();
const OUTLET_TTL = 15 * 60 * 1000;

function itemImage(block: string): string | undefined {
  const m =
    block.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i) ||
    block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) ||
    block.match(/<img[^>]+src="([^"]+)"/i);
  return m ? decodeEntities(m[1]) : undefined;
}

async function outletPool(signal: AbortSignal, country: string | null): Promise<LiveNewsItem[]> {
  const key = country ?? "-";
  const hit = outletCache.get(key);
  if (hit && Date.now() - hit.at < OUTLET_TTL) return hit.items;
  const all: LiveNewsItem[] = [];
  await Promise.all(
    feedsFor(country).map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          signal,
          headers: {
            "User-Agent": "employsi/1.0",
            Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
          },
        });
        if (!res.ok) return;
        const xml = await res.text();
        for (const raw of xml.split(/<item>/i).slice(1, 40)) {
          const block = raw.split(/<\/item>/i)[0];
          const title = tag(block, "title");
          const link = tag(block, "link");
          const pub = tag(block, "pubDate");
          if (!title || !link) continue;
          const t = pub ? Date.parse(pub) : NaN;
          all.push({
            title,
            url: link,
            publisher: feed.publisher,
            published: Number.isNaN(t) ? "" : new Date(t).toISOString(),
            image: itemImage(block),
          });
        }
      } catch {
        /* skip a failed feed */
      }
    }),
  );
  outletCache.set(key, { at: Date.now(), items: all });
  return all;
}

/** KV key for a company's stored feed. Must match the worker's `newsKey`. */
function newsKey(name: string): string {
  return `news:${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}

/** Stale after this long, at which point the on-demand fetch takes over. */
const STORE_MAX_AGE = 3 * 24 * 60 * 60 * 1000;

/**
 * Articles found under ANOTHER company that name this one — see lib/newsMentions.
 *
 * Read alongside the company's own stored feed and merged into it, so a story
 * about two employers reaches both cards. Kept as a SEPARATE key rather than
 * appended to the company's feed, because that feed is overwritten wholesale by
 * the nightly refresh and anything merged into it would be lost the same night.
 *
 * Best-effort throughout: a missing, stale or corrupt xref entry just means the
 * card shows its own coverage, which is what it showed before this existed.
 */
async function crossMentions(name: string): Promise<LiveNewsItem[]> {
  try {
    const mod = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    const kv = kvBinding(mod.env, "OPEN_ROLES_HISTORY");
    if (!kv) return [];
    const raw = await kv.get(xrefKey(name));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: LiveNewsItem[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const cutoff = Date.now() - XREF_MAX_AGE_MS;
    return items.filter((i) => {
      if (!i?.url || !i.title) return false;
      if (isBlockedArticle(i.url, i.publisher)) return false;
      const when = Date.parse(i.published || "");
      return Number.isNaN(when) || when >= cutoff;
    });
  } catch {
    return [];
  }
}

/** Merge cross-mentions into a feed, newest first, without duplicating a URL. */
function withCrossMentions(
  own: LiveNewsItem[],
  cross: LiveNewsItem[],
  limit: number,
): LiveNewsItem[] {
  if (!cross.length) return own.slice(0, limit);
  const have = new Set(own.map((i) => i.url));
  const merged = [...own, ...cross.filter((i) => !have.has(i.url))];
  merged.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return merged.slice(0, limit);
}

async function fromStore(query: string, limit: number): Promise<LiveNewsItem[] | null> {
  try {
    const mod = (await import("cloudflare:workers")) as { env?: Record<string, unknown> };
    const kv = kvBinding(mod.env, "OPEN_ROLES_HISTORY");
    if (!kv) return null;
    // The app queries with the company name in quotes; the worker keys on the
    // bare name, so strip them before hashing to the same key.
    const raw = await kv.get(newsKey(query.replace(/^"|"$/g, "")));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { updated?: string; items?: LiveNewsItem[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    if (!items.length) return null;
    const age = Date.now() - Date.parse(parsed.updated || "");
    if (!Number.isNaN(age) && age > STORE_MAX_AGE) return null;
    const clean = items.filter((i) => !isBlockedArticle(i.url, i.publisher));
    if (!clean.length) return null;
    const cross = await crossMentions(query.replace(/^"|"$/g, ""));
    return withCrossMentions(clean, cross, limit);
  } catch {
    return null;
  }
}

export const getLiveNews = createServerFn({ method: "GET" })
  .validator((data: { query: string; limit?: number }) => data)
  .handler(async ({ data }): Promise<{ items: LiveNewsItem[] }> => {
    const query = (data.query || "").trim();
    const limit = Math.min(Math.max(data.limit ?? 8, 1), 20);
    if (!query) return { items: [] };
    // What we SEARCH for can differ from what we are asked about: a roster name
    // that is also a common surname or word pulls in unrelated coverage, so
    // newsQueries.ts can supply a fuller trading name. Everything that
    // identifies the company — the cache key, the KV key, the official-feed
    // lookup — stays on the roster name, so only the provider query changes.
    // newsQueryFor returns the FINISHED query, quotes and all — see
    // newsQueries.ts. Do not re-quote it: BHP's entry is deliberately unquoted,
    // and the cron reads the same function, so re-quoting here would have the
    // app and the nightly store searching two different things for one company.
    const search = newsQueryFor(query);
    const key = `${query}::${limit}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return { items: hit.items };

    // The jobs-cron worker refreshes each rostered company's coverage nightly
    // into KV (see workers/jobs-cron/news.ts). Read that first: it makes the
    // card open instantly instead of racing an RSS fetch, and it means the feed
    // is the same for everyone who looks at a company on a given day rather
    // than whatever Bing happened to return for that request.
    //
    // Falls straight through to the live fetch when the store is cold, when the
    // company isn't on the roster, or when the entry has aged past a couple of
    // days — the cron is an accelerator, never a gate.
    // An organisation with its own newsroom feed is served from it, ahead of
    // the KV store — the nightly cron fills that store from Bing, so reading it
    // first would put search results back over the top of the official source.
    const official = officialFeedFor(query);
    if (official) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 7000);
      try {
        const own = await fromOfficialFeed(official, limit, ctrl.signal);
        if (own.length) {
          cache.set(key, { at: Date.now(), items: own });
          return { items: own };
        }
        // An empty or unreachable feed falls through to the normal path rather
        // than showing an empty card.
      } catch {
        /* fall through */
      } finally {
        clearTimeout(t);
      }
    }

    const stored = await fromStore(query, limit);
    if (stored) {
      cache.set(key, { at: Date.now(), items: stored });
      return { items: stored };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      let items: LiveNewsItem[] = [];
      // Bing News first — reliable, direct publisher links.
      try {
        items = await fromBing(search, limit, controller.signal);
      } catch {
        items = [];
      }
      // GDELT top-up (also direct links) when Bing is thin/empty.
      if (items.length < 3) {
        try {
          const g = await fromGdelt(search, limit, controller.signal);
          const have = new Set(items.map((i) => i.url));
          for (const it of g) if (!have.has(it.url)) items.push(it);
          items = items.slice(0, limit);
        } catch {
          /* keep whatever Bing gave */
        }
      }
      // Last resort: if an exact-phrase query ("Company Name") found nothing,
      // retry Bing unquoted — broader, so a real company almost always yields
      // recent coverage rather than falling back to the sourceless copy.
      if (items.length === 0 && /^".*"$/.test(search)) {
        try {
          items = await fromBing(search.replace(/^"|"$/g, ""), limit, controller.signal);
        } catch {
          items = [];
        }
      }
      // Straight-to-source top-up: pull the shared pool of recent articles from
      // the named outlets (mining.com / Business News WA / Bloomberg) and keep
      // any whose headline mentions the company. These carry real images and go
      // directly to the publisher, so they lift the feed above Bing's proxies.
      try {
        const name = search.replace(/^"|"$/g, "").trim().toLowerCase();
        if (name) {
          const pool = await outletPool(controller.signal, countryForCompanyName(name));
          const have = new Set(items.map((i) => i.url));
          const named = headlineMatcher(name);
          const matches = pool.filter(
            (p) => named !== null && named.test(p.title) && !have.has(p.url),
          );
          for (const m of matches) items.push(m);
          // Sort the whole feed newest-first so outlet articles interleave.
          items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
          items = items.slice(0, limit);
        }
      } catch {
        /* outlet pool is best-effort */
      }
      clearTimeout(timer);
      // One gate for every provider. Bing, GDELT and the outlet pool all land
      // here, so a blocked publisher cannot get in through whichever source
      // happened to answer — and the drop happens before the cache, so a
      // blocklist change can't be defeated by a warm entry.
      items = items.filter((i) => !isBlockedArticle(i.url, i.publisher));
      if (items.length) cache.set(key, { at: Date.now(), items });
      return { items };
    } catch {
      clearTimeout(timer);
      return { items: [] };
    }
  });
