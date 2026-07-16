import { createServerFn } from '@tanstack/react-start';

// NB: kept out of any `server/` directory — the bundler denies importing paths
// under **/server/**. createServerFn provides the client→server RPC bridge, so
// this handler only ever runs on the Cloudflare Worker (never in the browser),
// which is what lets it make the cross-origin fetch a browser's CORS/CSP rules
// would otherwise block.

// Per-isolate memo so repeated opens of the same card don't refetch the same
// article. Values include `null` (looked up, no image found) so we don't retry
// known-empty pages.
const cache = new Map<string, string | null>();

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
  const head = html.slice(0, 200_000); // meta tags live in <head>; cap the scan
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

// Resolves a single article URL to its og:image on the Worker. Returns '' when
// there's no image (or the fetch fails) so the client can fall back to its
// deterministic stock photo without treating it as an error.
export const getArticleImage = createServerFn({ method: 'GET' })
  .validator((data: { url: string }) => data)
  .handler(async ({ data }): Promise<{ image: string }> => {
    const url = data.url;
    if (!/^https?:\/\//i.test(url)) return { image: '' };
    if (cache.has(url)) return { image: cache.get(url) ?? '' };
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
        cache.set(url, null);
        return { image: '' };
      }
      const html = await res.text();
      const image = extractImage(html, res.url || url);
      cache.set(url, image);
      return { image: image ?? '' };
    } catch {
      cache.set(url, null);
      return { image: '' };
    }
  });
