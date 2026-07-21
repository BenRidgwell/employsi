import { createServerFn } from '@tanstack/react-start';
import { yahooSymbol } from './shareSeriesFn';

// Live company fundamentals, fetched on the Worker from Yahoo Finance's
// quoteSummary API. Unlike the chart endpoint, quoteSummary needs a
// crumb + cookie pair, so we acquire one once per Worker and reuse it,
// re-fetching only if Yahoo rejects it. Returns real headcount, revenue,
// EBITDA and market cap plus the per-employee ratios the panel shows.

export interface CompanyStats {
  headcount: number; // full-time employees
  revenue: number; // trailing total revenue, native currency
  ebitda: number; // trailing EBITDA, native currency
  marketCap: number; // market capitalisation, native currency
  revPerEmp: number; // revenue per employee, in $m
  ebitdaPerEmp: number; // EBITDA per employee, in $m
  currency: string;
}

const EMPTY: CompanyStats = {
  headcount: 0, revenue: 0, ebitda: 0, marketCap: 0, revPerEmp: 0, ebitdaPerEmp: 0, currency: '',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Cached crumb + cookie for the Worker instance. Yahoo issues a session
// cookie (A3) from fc.yahoo.com, then a matching crumb from the getcrumb
// endpoint; both must be sent together on quoteSummary calls.
let auth: { crumb: string; cookie: string } | null = null;

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getAuth(): Promise<{ crumb: string; cookie: string } | null> {
  if (auth) return auth;
  try {
    // 1. Hit fc.yahoo.com to receive the session cookie (returns 404 by design).
    const c = await fetchWithTimeout('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } }, 6000);
    const setCookie = c.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0];
    if (!cookie) return null;
    // 2. Exchange the cookie for a crumb.
    const cr = await fetchWithTimeout(
      'https://query2.finance.yahoo.com/v1/test/getcrumb',
      { headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'text/plain,*/*' } },
      6000,
    );
    if (!cr.ok) return null;
    const crumb = (await cr.text()).trim();
    if (!crumb || crumb.includes('<')) return null;
    auth = { crumb, cookie };
    return auth;
  } catch {
    return null;
  }
}

async function queryYahoo(sym: string): Promise<any | null> {
  const a = await getAuth();
  if (!a) return null;
  const modules = 'assetProfile,financialData,price';
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}&crumb=${encodeURIComponent(a.crumb)}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': UA, Cookie: a.cookie, Accept: 'application/json,*/*' } },
    6000,
  );
  if (res.status === 401 || res.status === 403) {
    // Crumb/cookie expired — drop it so the next call re-acquires.
    auth = null;
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

// Cache per ticker for an hour — fundamentals barely move intraday.
const cache = new Map<string, { at: number; data: CompanyStats }>();
const TTL = 60 * 60 * 1000;

export const getCompanyStats = createServerFn({ method: 'GET' })
  .validator((data: { ticker: string; exchange?: string }) => data)
  .handler(async ({ data }): Promise<CompanyStats> => {
    const ticker = (data.ticker || '').trim().toUpperCase();
    if (!ticker) return EMPTY;
    const key = `${ticker}::${data.exchange || ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
    try {
      const sym = yahooSymbol(ticker, data.exchange);
      let json = await queryYahoo(sym);
      // One retry if the crumb had just gone stale.
      if (!json) json = await queryYahoo(sym);
      const r = json?.quoteSummary?.result?.[0];
      if (!r) return EMPTY;
      const headcount = Number(r.assetProfile?.fullTimeEmployees) || 0;
      const revenue = Number(r.financialData?.totalRevenue?.raw) || 0;
      const ebitda = Number(r.financialData?.ebitda?.raw) || 0;
      const marketCap = Number(r.price?.marketCap?.raw) || 0;
      const currency = r.price?.currency || r.financialData?.financialCurrency || '';
      if (!headcount && !revenue && !ebitda && !marketCap) return EMPTY;
      const revPerEmp = headcount && revenue ? +(revenue / headcount / 1e6).toFixed(2) : 0;
      const ebitdaPerEmp = headcount && ebitda ? +(ebitda / headcount / 1e6).toFixed(2) : 0;
      const result: CompanyStats = {
        headcount, revenue, ebitda, marketCap, revPerEmp, ebitdaPerEmp, currency,
      };
      cache.set(key, { at: Date.now(), data: result });
      return result;
    } catch {
      return EMPTY;
    }
  });
