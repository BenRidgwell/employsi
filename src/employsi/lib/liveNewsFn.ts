import { createServerFn } from "@tanstack/react-start";
import type { JsonRecord } from "./json";
import { str } from "./json";
import { isBlockedArticle } from "../data/newsBlocklist";
import { kvBinding } from "./kv";

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
let outletCache: { at: number; items: LiveNewsItem[] } | null = null;
const OUTLET_TTL = 15 * 60 * 1000;

function itemImage(block: string): string | undefined {
  const m =
    block.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i) ||
    block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) ||
    block.match(/<img[^>]+src="([^"]+)"/i);
  return m ? decodeEntities(m[1]) : undefined;
}

async function outletPool(signal: AbortSignal): Promise<LiveNewsItem[]> {
  if (outletCache && Date.now() - outletCache.at < OUTLET_TTL) return outletCache.items;
  const all: LiveNewsItem[] = [];
  await Promise.all(
    OUTLET_FEEDS.map(async (feed) => {
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
  outletCache = { at: Date.now(), items: all };
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
    return clean.length ? clean.slice(0, limit) : null;
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
        items = await fromBing(query, limit, controller.signal);
      } catch {
        items = [];
      }
      // GDELT top-up (also direct links) when Bing is thin/empty.
      if (items.length < 3) {
        try {
          const g = await fromGdelt(query, limit, controller.signal);
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
      if (items.length === 0 && /^".*"$/.test(query)) {
        try {
          items = await fromBing(query.replace(/^"|"$/g, ""), limit, controller.signal);
        } catch {
          items = [];
        }
      }
      // Straight-to-source top-up: pull the shared pool of recent articles from
      // the named outlets (mining.com / Business News WA / Bloomberg) and keep
      // any whose headline mentions the company. These carry real images and go
      // directly to the publisher, so they lift the feed above Bing's proxies.
      try {
        const name = query.replace(/^"|"$/g, "").trim().toLowerCase();
        if (name) {
          const pool = await outletPool(controller.signal);
          const have = new Set(items.map((i) => i.url));
          const matches = pool.filter(
            (p) => p.title.toLowerCase().includes(name) && !have.has(p.url),
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
