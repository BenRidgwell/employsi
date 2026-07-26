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
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Map a ticker + exchange to the Yahoo Finance symbol (per-exchange suffix).
// US exchanges use the bare symbol; other markets need Yahoo's suffix, and HK
// codes are zero-padded to 4 digits.
const YAHOO_SUFFIX: Record<string, string> = {
  ASX: '.AX', LSE: '.L', JPX: '.T', SGX: '.SI', SIX: '.SW', JSE: '.JO',
  EPA: '.PA', KRX: '.KS', TSX: '.TO', DFM: '.AE', SSE: '.SS', SZSE: '.SZ',
};
export function yahooSymbol(ticker: string, exchange?: string): string {
  const ex = exchange || 'ASX';
  if (ex === 'NYSE' || ex === 'NASDAQ') return ticker;
  // Hong Kong: strip non-digits and any leading zeros, then pad back to Yahoo's
  // canonical 4-digit code (e.g. "00700" -> "0700.HK", "09988" -> "9988.HK").
  if (ex === 'HKEX') return `${(ticker.replace(/\D/g, '').replace(/^0+/, '') || '0').padStart(4, '0')}.HK`;
  const suf = YAHOO_SUFFIX[ex];
  return suf ? `${ticker}${suf}` : ticker;
}

// Cache per ticker for an hour — a quarterly chart doesn't need sub-hourly
// refreshes, and it keeps us well clear of any upstream rate limits.
const cache = new Map<string, { at: number; data: ShareSeries }>();
const TTL = 60 * 60 * 1000;

// ── FX → AUD ────────────────────────────────────────────────────────────────
// Companies on this map list across ASX, NYSE, LSE, JPX, HKEX… so their Yahoo
// closes arrive in the listing currency (USD, GBp, JPY, HKD…). Comparing a US
// major's USD line against an ASX miner's AUD line is meaningless, so every
// series is converted to AUD here on the server before it reaches the chart.
// Rates come from Yahoo's own FX pairs and are cached like the price series.
const fxCache = new Map<string, { at: number; rate: number }>();

async function toAudRate(cur: string): Promise<number> {
  const c = (cur || '').toUpperCase();
  if (!c || c === 'AUD') return 1;
  // London quotes pence (GBp/GBX), not pounds — convert via GBP then /100.
  const base = c === 'GBX' || c === 'GBP.' ? 'GBP' : c;
  const pence = c === 'GBX' || c === 'GBP.';
  const hit = fxCache.get(base);
  const now = Date.now();
  let rate = hit && now - hit.at < TTL ? hit.rate : 0;
  if (!rate) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${base}AUD=X?range=5d&interval=1d`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*' },
      });
      clearTimeout(timer);
      if (!res.ok) return 0;
      const j = (await res.json()) as any;
      const m = j?.chart?.result?.[0]?.meta;
      rate = Number(m?.regularMarketPrice) || 0;
      if (rate > 0) fxCache.set(base, { at: now, rate });
    } catch {
      return 0;
    }
  }
  if (!rate) return 0;
  return pence ? rate / 100 : rate;
}

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
      const native = String(meta.currency ?? '');
      // Normalise everything to AUD so lines from different exchanges are
      // directly comparable. If the FX lookup fails we return the native series
      // untouched (and say so via `currency`) rather than showing a wrong number.
      const fx = await toAudRate(native);
      const conv = (v: number) => +(v * fx).toFixed(v * fx >= 10 ? 2 : 3);
      const audOk = fx > 0 && fx !== 1;
      const result: ShareSeries = {
        series: audOk ? series.map(conv) : series,
        low: +(audOk
          ? conv(meta.fiftyTwoWeekLow ?? Math.min(...series))
          : (meta.fiftyTwoWeekLow ?? Math.min(...series))).toFixed(3),
        high: +(audOk
          ? conv(meta.fiftyTwoWeekHigh ?? Math.max(...series))
          : (meta.fiftyTwoWeekHigh ?? Math.max(...series))).toFixed(3),
        last: +(audOk
          ? conv(meta.regularMarketPrice ?? series[series.length - 1])
          : (meta.regularMarketPrice ?? series[series.length - 1])).toFixed(3),
        currency: fx > 0 ? 'AUD' : native,
      };
      cache.set(key, { at: Date.now(), data: result });
      return result;
    } catch {
      return EMPTY;
    }
  });
