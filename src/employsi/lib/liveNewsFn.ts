import { createServerFn } from '@tanstack/react-start';

// NB: kept out of any `server/` directory — the bundler denies importing paths
// under **/server/**. createServerFn runs this only on the Cloudflare Worker,
// which is what lets it fetch news providers cross-origin.
//
// Two providers, tried in order:
//  1. GDELT DOC API — returns DIRECT publisher article URLs plus each story's
//     real `socialimage` (its og:image), so links go straight to the source and
//     thumbnails are the genuine article images. Free, no key.
//  2. Google News RSS — fallback when GDELT is unavailable/rate-limited. Its
//     links are Google redirects and its images are generic, but it's reliable.

export interface LiveNewsItem {
  title: string;
  url: string;
  publisher: string;
  published: string; // ISO
  image?: string; // real article image when the provider supplies one (GDELT)
}

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

// GDELT seendate is "YYYYMMDDTHHMMSSZ" → ISO.
function gdeltDate(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function cleanDomain(d: string): string {
  return (d || '').replace(/^www\./, '');
}

async function fromGdelt(query: string, limit: number, signal: AbortSignal): Promise<LiveNewsItem[]> {
  const url =
    'https://api.gdeltproject.org/api/v2/doc/doc?query=' +
    encodeURIComponent(query) +
    `&mode=ArtList&maxrecords=${Math.min(limit * 2, 40)}&timespan=14d&format=json&sort=DateDesc`;
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'employsi/1.0' } });
  if (!res.ok) return [];
  const text = await res.text();
  if (!text.startsWith('{')) return []; // rate-limit / html notice
  const json = JSON.parse(text) as { articles?: any[] };
  const arts = Array.isArray(json.articles) ? json.articles : [];
  const seen = new Set<string>();
  const items: LiveNewsItem[] = [];
  for (const a of arts) {
    if (!a?.url || !a?.title || seen.has(a.url)) continue;
    seen.add(a.url);
    items.push({
      title: String(a.title),
      url: String(a.url),
      publisher: cleanDomain(String(a.domain || '')),
      published: gdeltDate(String(a.seendate || '')),
      image: a.socialimage ? String(a.socialimage) : undefined,
    });
    if (items.length >= limit) break;
  }
  return items;
}

// Google News RSS — publisher from <source>, and its " - Publisher" title
// suffix is stripped. Ordered newest-first.
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
    items.push({ title, url: link, publisher, published: Number.isNaN(t) ? '' : new Date(t).toISOString() });
  }
  items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return items.slice(0, limit);
}

async function fromGoogle(query: string, limit: number, signal: AbortSignal): Promise<LiveNewsItem[]> {
  const url =
    'https://news.google.com/rss/search?q=' + encodeURIComponent(query) + '&hl=en-AU&gl=AU&ceid=AU:en';
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) return [];
  return parseRss(await res.text(), limit);
}

export const getLiveNews = createServerFn({ method: 'GET' })
  .validator((data: { query: string; limit?: number }) => data)
  .handler(async ({ data }): Promise<{ items: LiveNewsItem[] }> => {
    const query = (data.query || '').trim();
    const limit = Math.min(Math.max(data.limit ?? 8, 1), 20);
    if (!query) return { items: [] };
    const key = `${query}::${limit}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return { items: hit.items };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      let items: LiveNewsItem[] = [];
      try {
        items = await fromGdelt(query, limit, controller.signal);
      } catch {
        items = [];
      }
      if (items.length === 0) {
        try {
          items = await fromGoogle(query, limit, controller.signal);
        } catch {
          items = [];
        }
      }
      clearTimeout(timer);
      if (items.length) cache.set(key, { at: Date.now(), items });
      return { items };
    } catch {
      clearTimeout(timer);
      return { items: [] };
    }
  });
