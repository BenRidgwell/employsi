/**
 * Nightly company-news refresh.
 *
 * The app's live-news server function fetches on demand and caches for eight
 * minutes in Worker memory — which means a cold isolate re-fetches, and every
 * card open is a race against Bing. This job walks the roster once a day, pulls
 * each company's recent coverage, and parks it in KV under `news:<slug>`, so
 * the card reads yesterday's refresh instantly and only goes to the network for
 * a company the roster doesn't cover.
 *
 * A shard per run, like the jobs pipeline: the roster is ~200 companies and one
 * invocation cannot politely fetch that many feeds. The cursor is persisted, so
 * successive nightly runs walk the whole roster and each company is refreshed
 * roughly every few days — with the on-demand path still there for anything
 * stale or missing, so nothing is ever BLOCKED on the cron.
 */

import { isBlockedArticle } from "../../src/employsi/data/newsBlocklist";

export interface StoredNewsItem {
  title: string;
  url: string;
  publisher: string;
  published: string;
  image?: string;
}

/** KV key for a company's stored feed. Must match the app's `newsKey`. */
export function newsKey(name: string): string {
  return `news:${name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
}

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

// Bing wraps outbound links in a click-tracker; the real destination is in the
// `url=` parameter. Same unwrapping the app's fetcher does.
function realUrl(link: string): string {
  try {
    const u = new URL(link);
    const inner = u.searchParams.get("url");
    return inner ? decodeURIComponent(inner) : link;
  } catch {
    return link;
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchNews(name: string, limit: number): Promise<StoredNewsItem[]> {
  const url =
    "https://www.bing.com/news/search?q=" +
    encodeURIComponent(`"${name}"`) +
    "&format=RSS&setmkt=en-AU";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/rss+xml,application/xml,text/xml;q=0.9" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: StoredNewsItem[] = [];
    const seen = new Set<string>();
    for (const raw of xml.split(/<item>/i).slice(1, 40)) {
      const block = raw.split(/<\/item>/i)[0];
      const link = tag(block, "link");
      const title = tag(block, "title");
      if (!link || !title) continue;
      const href = realUrl(link);
      if (/bing\.com\/news\/search/i.test(href) || seen.has(href)) continue;
      const srcM = block.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/i);
      const publisher = (srcM ? decodeEntities(srcM[1]).trim() : "")
        .replace(/\s+on\s+MSN$/i, "")
        .replace(/^www\./, "");
      // The same gate the app applies, enforced here too — otherwise a blocked
      // publisher would simply be cached overnight and served from KV.
      if (isBlockedArticle(href, publisher)) continue;
      seen.add(href);
      const imgM = block.match(/<News:Image[^>]*>([\s\S]*?)<\/News:Image>/i);
      const pub = tag(block, "pubDate");
      const t = pub ? Date.parse(pub) : NaN;
      out.push({
        title,
        url: href,
        publisher,
        published: Number.isNaN(t) ? "" : new Date(t).toISOString(),
        image: imgM ? decodeEntities(imgM[1]).trim() : undefined,
      });
    }
    out.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
    return out.slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

interface NewsEnv {
  OPEN_ROLES_HISTORY: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
}

/** How many companies one nightly run refreshes. */
const NEWS_SHARD = 40;
const PER_COMPANY = 8;

export async function processNews(
  env: NewsEnv,
  names: string[],
): Promise<{ refreshed: string[]; empty: string[] }> {
  if (!names.length) return { refreshed: [], empty: [] };
  const cursorRaw = await env.OPEN_ROLES_HISTORY.get("news:cursor");
  const cursor = Number(cursorRaw) || 0;
  const refreshed: string[] = [];
  const empty: string[] = [];
  for (let i = 0; i < NEWS_SHARD && i < names.length; i++) {
    const name = names[(cursor + i) % names.length];
    const items = await fetchNews(name, PER_COMPANY);
    // An empty result is NOT written: a company with no coverage today should
    // keep yesterday's articles rather than have the card go blank because Bing
    // rate-limited one request.
    if (!items.length) {
      empty.push(name);
      continue;
    }
    await env.OPEN_ROLES_HISTORY.put(
      newsKey(name),
      JSON.stringify({ updated: new Date().toISOString(), items }),
    );
    refreshed.push(name);
  }
  await env.OPEN_ROLES_HISTORY.put("news:cursor", String((cursor + NEWS_SHARD) % names.length));
  return { refreshed, empty };
}
