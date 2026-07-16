import { createServerFn } from '@tanstack/react-start';

// Live share-price series, fetched on the Worker from Yahoo Finance's public
// chart API (no key). Runs server-side via createServerFn so the cross-origin
// request is allowed. Returns an ~8-point quarterly close series plus the real
// 52-week low/high and last price — genuinely live market data.

export interface ShareSeries {
  series: number[]; // recent quarterly closes, oldest→newest
  low: number; // 52-week low
  high: number; // 52-week high
  last: number; // latest price
  currency: string;
}

const EMPTY: ShareSeries = { series: [], low: 0, high: 0, last: 0, currency: '' };

// Map a ticker + exchange to the Yahoo Finance symbol (per-exchange suffix).
// US exchanges use the bare symbol; other markets need Yahoo's suffix, and HK
// codes are zero-padded to 4 digits.
const YAHOO_SUFFIX: Record<string, string> = {
  ASX: '.AX', LSE: '.L', JPX: '.T', SGX: '.SI', SIX: '.SW', JSE: '.JO',
  EPA: '.PA', KRX: '.KS', TSX: '.TO', DFM: '.AE', SSE: '.SS', SZSE: '.SZ',
};
function yahooSymbol(ticker: string, exchange?: string): string {
  const ex = exchange || 'ASX';
  if (ex === 'NYSE' || ex === 'NASDAQ') return ticker;
  if (ex === 'HKEX') return `${ticker.replace(/\D/g, '').padStart(4, '0')}.HK`;
  const suf = YAHOO_SUFFIX[ex];
  return suf ? `${ticker}${suf}` : ticker;
}

// Cache per ticker for an hour — a quarterly chart doesn't need sub-hourly
// refreshes, and it keeps us well clear of any upstream rate limits.
const cache = new Map<string, { at: number; data: ShareSeries }>();
const TTL = 60 * 60 * 1000;

export const getShareSeries = createServerFn({ method: 'GET' })
  .validator((data: { ticker: string; exchange?: string }) => data)
  .handler(async ({ data }): Promise<ShareSeries> => {
    const ticker = (data.ticker || '').trim().toUpperCase();
    if (!ticker) return EMPTY;
    const key = `${ticker}::${data.exchange || ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    try {
      const sym = yahooSymbol(ticker, data.exchange);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=3mo`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Accept: 'application/json,text/plain,*/*',
        },
      });
      clearTimeout(timer);
      if (!res.ok) return EMPTY;
      const json = (await res.json()) as any;
      const r = json?.chart?.result?.[0];
      const meta = r?.meta;
      const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
      if (!meta || !Array.isArray(closes)) return EMPTY;
      // Keep the last 8 quarters of real closes.
      const series = closes
        .filter((v): v is number => typeof v === 'number' && isFinite(v))
        .slice(-8)
        .map((v) => +v.toFixed(v >= 10 ? 2 : 3));
      if (series.length < 2) return EMPTY;
      const result: ShareSeries = {
        series,
        low: +(meta.fiftyTwoWeekLow ?? Math.min(...series)).toFixed(3),
        high: +(meta.fiftyTwoWeekHigh ?? Math.max(...series)).toFixed(3),
        last: +(meta.regularMarketPrice ?? series[series.length - 1]).toFixed(3),
        currency: meta.currency ?? '',
      };
      cache.set(key, { at: Date.now(), data: result });
      return result;
    } catch {
      return EMPTY;
    }
  });
