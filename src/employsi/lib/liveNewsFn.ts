import { createServerFn } from '@tanstack/react-start';

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

async function fromBing(query: string, limit: number, signal: AbortSignal): Promise<LiveNewsItem[]> {
  const url = 'https://www.bing.com/news/search?q=' + encodeURIComponent(query) + '&format=RSS&setmkt=en-AU';
  const res = await fetch(url, {
    signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'application/rss+xml, application/xml, text/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const items: LiveNewsItem[] = [];
  const seen = new Set<string>();
  const blocks = xml.split(/<item>/i).slice(1, 60);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0];
    const link = tag(block, 'link');
    const title = tag(block, 'title');
    const pub = tag(block, 'pubDate');
    const srcM = block.match(/<News:Source[^>]*>([\s\S]*?)<\/News:Source>/i);
    let publisher = srcM ? decodeEntities(srcM[1]).trim() : '';
    publisher = publisher.replace(/\s+on\s+MSN$/i, '').trim();
    if (!link || !title) continue;
    const real = bingRealUrl(link);
    if (/bing\.com\/news\/search/i.test(real) || seen.has(real)) continue; // skip the self-referential feed link
    seen.add(real);
    const t = pub ? Date.parse(pub) : NaN;
    items.push({ title, url: real, publisher: cleanDomain(publisher), published: Number.isNaN(t) ? '' : new Date(t).toISOString() });
  }
  items.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  return items.slice(0, limit);
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
          items = await fromBing(query.replace(/^"|"$/g, ''), limit, controller.signal);
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
