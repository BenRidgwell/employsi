import { createServerFn } from '@tanstack/react-start';

// NB: kept out of any `server/` directory — the bundler denies importing paths
// under **/server/**. createServerFn provides the client→server RPC bridge, so
// this handler only ever runs on the Cloudflare Worker (never in the browser),
// which is what lets it make the cross-origin fetch a browser's CORS/CSP rules
// would otherwise block.

// What we scrape from an article's <head>: the share image, the publish date
// (ISO string) and the publisher's name. Any field can be '' when the page
// doesn't expose it.
export interface ArticleMeta {
  image: string;
  published: string;
  publisher: string;
}

// Per-isolate memo so repeated opens of the same card don't refetch the same
// article. Values include an all-empty result so we don't retry known-empty
// pages.
const cache = new Map<string, ArticleMeta>();
const EMPTY: ArticleMeta = { image: '', published: '', publisher: '' };

function absolutise(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

// Pull the article's social-share image out of its HTML <head>: Open Graph
// first (og:image / og:image:secure_url), then Twitter's card image as a
// fallback. Both are the images publishers curate for link previews, so they're
// the genuine "thumbnail sourced from the article".
function extractImage(html: string, base: string): string | null {
  // Most sites put og:image in the <head>, but some (notably Google News, which
  // is where our live-feed links point) emit it near the very END of a large
  // document. So scan the head first and, if nothing's found, the tail too.
  const head = html.length > 260_000 ? html.slice(0, 200_000) + '\n' + html.slice(-260_000) : html;
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m && m[1]) {
      const abs = absolutise(m[1].replace(/&amp;/g, '&'), base);
      if (abs && /^https?:\/\//i.test(abs)) return abs;
    }
  }
  return null;
}

// Grab the first content match for any of the given meta patterns.
function metaContent(head: string, res: RegExp[]): string | null {
  for (const re of res) {
    const m = head.match(re);
    if (m && m[1]) return m[1].replace(/&amp;/g, '&').trim();
  }
  return null;
}

// The article's publish date as an ISO string, from the standard article /
// Open Graph / schema.org timestamps (or a <time datetime>). Returns '' when
// nothing parseable is present.
function extractPublished(head: string): string {
  const raw = metaContent(head, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
    /<meta[^>]+property=["']og:article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["'](?:pubdate|publishdate|date|dc\.date\.issued|article:published_time)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ]);
  if (!raw) return '';
  const t = Date.parse(raw);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

// The publisher's display name: og:site_name / schema publisher when present,
// otherwise a cleaned-up hostname (e.g. "www.mining.com" -> "MINING.COM").
function extractPublisher(head: string, base: string): string {
  const named = metaContent(head, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
    /<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']+)["']/i,
  ]);
  if (named) return named.slice(0, 40);
  try {
    const host = new URL(base).hostname.replace(/^www\./, '');
    return host === 'mining.com' ? 'MINING.COM' : host;
  } catch {
    return '';
  }
}

// Resolves a single article URL on the Worker to its share image, publish date
// and publisher. Returns empty fields when there's no data (or the fetch fails)
// so the client can fall back without treating it as an error.
export const getArticleImage = createServerFn({ method: 'GET' })
  .validator((data: { url: string }) => data)
  .handler(async ({ data }): Promise<ArticleMeta> => {
    const url = data.url;
    if (!/^https?:\/\//i.test(url)) return EMPTY;
    const cached = cache.get(url);
    if (cached) return cached;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // A real browser UA + Accept so publishers serve the full HTML head
          // (some gate the social meta behind a non-bot request).
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        cache.set(url, EMPTY);
        return EMPTY;
      }
      const html = await res.text();
      const head = html.slice(0, 200_000); // meta tags live in <head>; cap the scan
      const finalUrl = res.url || url;
      const meta: ArticleMeta = {
        image: extractImage(html, finalUrl) ?? '',
        published: extractPublished(head),
        publisher: extractPublisher(head, finalUrl),
      };
      cache.set(url, meta);
      return meta;
    } catch {
      cache.set(url, EMPTY);
      return EMPTY;
    }
  });
