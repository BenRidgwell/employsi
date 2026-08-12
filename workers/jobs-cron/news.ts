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
 * EVERY company, EVERY night — but spread over four ticks ten minutes apart
 * rather than one invocation. The roster is 355 companies (205 listed + 150
 * private), and one pass would be ~355 fetches plus ~355 KV writes plus a retry
 * sweep: both count against a Worker's 1000-subrequest budget, so a single run
 * would sit uncomfortably close to the ceiling with no headroom for the roster
 * growing. Four slices of ~89 leave each invocation at roughly a quarter of it.
 *
 * The slice is taken by index modulo, not a cursor: tick 0 takes companies
 * 0,4,8…, tick 1 takes 1,5,9… — so the four together are exactly the roster,
 * every night, with no state to drift and no company able to be skipped because
 * a cursor was written twice.
 *
 * Within a slice the constraint is the upstream, not Cloudflare: firing 89
 * requests at once gets us throttled, which would silently leave companies on
 * stale coverage. So each slice runs at a bounded concurrency, and anything that
 * came back empty is retried once at the end — a transient 429 in the first
 * sweep is by far the likeliest reason a company would otherwise miss its day.
 *
 * An empty result is still never written, so even a company that fails both
 * passes keeps yesterday's articles rather than blanking its card, and the app's
 * on-demand path is still there for anything stale or off-roster. Nothing is
 * ever BLOCKED on the cron.
 */

import { isBlockedArticle } from "../../src/employsi/data/newsBlocklist";
import { officialFeedFor, type OfficialFeed } from "../../src/employsi/data/officialNewsFeeds";
import { scrapeNewsroom } from "../../src/employsi/lib/newsroomScrape";
import { newsQueryFor } from "../../src/employsi/data/newsQueries";

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

// An organisation's own newsroom feed, where it has one (see
// data/officialNewsFeeds.ts). Read INSTEAD of the Bing search, so the nightly
// KV entry matches what the app serves rather than overwriting it with search
// results the next time the cron runs.
async function fetchOfficial(feed: OfficialFeed, limit: number): Promise<StoredNewsItem[]> {
  const { url, publisher } = feed;
  const isHtml = feed.kind === "html";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: isHtml
          ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
          : "application/rss+xml,application/xml,text/xml;q=0.9",
      },
    });
    if (!res.ok) return [];
    // Newsrooms with no feed are read from the listing page, through the same
    // parser the app uses (src/employsi/lib/newsroomScrape.ts) so the cron and
    // the on-demand path can never disagree about what a page says.
    if (isHtml) {
      const items = scrapeNewsroom(await res.text(), { ...(feed.scrape ?? {}), page: feed.page });
      return items.slice(0, limit).map((i) => ({
        title: i.title,
        url: i.url,
        publisher,
        published: i.published,
        image: i.image,
      }));
    }
    const xml = await res.text();
    const out: StoredNewsItem[] = [];
    const seen = new Set<string>();
    for (const raw of xml.split(/<item>/i).slice(1, 40)) {
      const block = raw.split(/<\/item>/i)[0];
      const title = tag(block, "title");
      const link = tag(block, "link");
      if (!title || !link || seen.has(link)) continue;
      seen.add(link);
      const pub = tag(block, "pubDate");
      const t = pub ? Date.parse(pub) : NaN;
      out.push({
        title,
        url: link,
        publisher,
        published: Number.isNaN(t) ? "" : new Date(t).toISOString(),
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

async function fetchNews(name: string, limit: number): Promise<StoredNewsItem[]> {
  const official = officialFeedFor(name);
  if (official) {
    const own = await fetchOfficial(official, limit);
    if (own.length) return own;
    // An unreachable feed falls through to the search rather than storing an
    // empty entry that would blank the card for a day.
  }
  // Search for the company's fuller trading name where the roster name is too
  // generic to search on (see data/newsQueries.ts). The KV key below still uses
  // the roster name, so the app finds this entry exactly where it expects to.
  const url =
    "https://www.bing.com/news/search?q=" +
    // newsQueryFor returns the FINISHED query, quotes and all — see
    // newsQueries.ts. Do not wrap it: BHP's entry is deliberately unquoted.
    encodeURIComponent(newsQueryFor(name)) +
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

/** How many feeds are in flight at once. Low enough to stay under the
 *  upstream's rate limit, high enough to finish the roster in a minute or two. */
const CONCURRENCY = 6;
/** Articles kept per company. */
const PER_COMPANY = 8;
/** Pause between a worker's requests, so the pass is a steady trickle rather
 *  than six tight loops hammering the same host. */
const THROTTLE_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `job` over every item with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await job(items[i]);
      await sleep(THROTTLE_MS);
    }
  });
  await Promise.all(workers);
}

/** How many ticks the nightly refresh is spread over. */
export const NEWS_PARTS = 4;

export async function processNews(
  env: NewsEnv,
  allNames: string[],
  part = 0,
  parts = 1,
): Promise<{ refreshed: string[]; empty: string[] }> {
  // Deterministic slice — see the header. Every index lands in exactly one part.
  const names = parts > 1 ? allNames.filter((_, i) => i % parts === part) : allNames;
  if (!names.length) return { refreshed: [], empty: [] };
  const refreshed: string[] = [];
  let empty: string[] = [];

  const sweep = async (list: string[]) => {
    const missed: string[] = [];
    await pool(list, CONCURRENCY, async (name) => {
      const items = await fetchNews(name, PER_COMPANY);
      // An empty result is NOT written: a company with no coverage today should
      // keep yesterday's articles rather than have the card go blank because one
      // request was rate-limited.
      if (!items.length) {
        missed.push(name);
        return;
      }
      await env.OPEN_ROLES_HISTORY.put(
        newsKey(name),
        JSON.stringify({ updated: new Date().toISOString(), items }),
      );
      refreshed.push(name);
    });
    return missed;
  };

  empty = await sweep(names);
  // One retry for the misses. Most of them are transient throttling rather than
  // a company with genuinely no coverage, and the second pass is small and slow
  // enough to get through.
  if (empty.length) {
    await sleep(2000);
    empty = await sweep(empty);
  }

  await env.OPEN_ROLES_HISTORY.put(
    `news:lastrun:${part}`,
    JSON.stringify({
      at: new Date().toISOString(),
      part,
      parts,
      total: names.length,
      refreshed: refreshed.length,
      empty: empty.length,
      emptyNames: empty.slice(0, 20),
    }),
  );
  return { refreshed, empty };
}
