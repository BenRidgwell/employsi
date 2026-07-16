import { createServerFn } from '@tanstack/react-start';

// NB: kept out of any `server/` directory — the bundler denies importing paths
// under **/server/**. createServerFn runs this only on the Cloudflare Worker,
// which is what lets it fetch Google News (a cross-origin request the browser
// couldn't make itself) and read the RSS feed.

export interface LiveNewsItem {
  title: string;
  url: string;
  publisher: string;
  published: string; // ISO
}

// Short per-isolate cache so repeated opens of the same card / brief within a
// few minutes don't refetch. News should still feel live, so the TTL is small.
const cache = new Map<string, { at: number; items: LiveNewsItem[] }>();
const TTL = 8 * 60 * 1000;

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : null;
}

// Parse Google News RSS into clean items: publisher comes from <source>, and
// Google appends " - Publisher" to each <title>, so we strip that suffix.
// Google orders items by relevance, so we sort newest-first here and let the
// caller take the freshest N — keeping the feed genuinely recent.
function parseRss(xml: string, limit: number): LiveNewsItem[] {
  const items: LiveNewsItem[] = [];
  const blocks = xml.split(/<item>/i).slice(1, 60);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0];
    const link = tag(block, 'link');
    let title = tag(block, 'title');
    const pub = tag(block, 'pubDate');
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const publisher = sourceMatch ? decodeEntities(sourceMatch[1]).trim() : '';
    if (!link || !title) continue;
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
    const t = pub ? Date.parse(pub) : NaN;
    items.push({
      title,
      url: link,
      publisher,
      published: Number.isNaN(t) ? '' : new Date(t).toISOString(),
    });
  }
  items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return items.slice(0, limit);
}

// Fetches recent Google News results for a query on the Worker. Returns [] on
// any failure so the caller can fall back to its illustrative feed.
export const getLiveNews = createServerFn({ method: 'GET' })
  .validator((data: { query: string; limit?: number }) => data)
  .handler(async ({ data }): Promise<{ items: LiveNewsItem[] }> => {
    const query = (data.query || '').trim();
    const limit = Math.min(Math.max(data.limit ?? 8, 1), 20);
    if (!query) return { items: [] };
    const key = `${query}::${limit}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return { items: hit.items };
    try {
      const url =
        'https://news.google.com/rss/search?q=' +
        encodeURIComponent(query) +
        '&hl=en-AU&gl=AU&ceid=AU:en';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8',
        },
      });
      clearTimeout(timer);
      if (!res.ok) return { items: [] };
      const xml = await res.text();
      const items = parseRss(xml, limit);
      cache.set(key, { at: Date.now(), items });
      return { items };
    } catch {
      return { items: [] };
    }
  });
