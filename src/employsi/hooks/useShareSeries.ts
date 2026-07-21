import { useQuery } from '@tanstack/react-query';
import { getShareSeries } from '../lib/shareSeriesFn';
import type { ShareSeries } from '../lib/shareSeriesFn';

// Fetches a live quarterly share-price series (+ 52-week range) for a ticker on
// the Worker. Returns undefined until it resolves or if the ticker doesn't
// resolve on the market data source, so callers fall back to the illustrative
// series.
export function useShareSeries(ticker: string | null, exchange: string | undefined, enabled: boolean): ShareSeries | undefined {
  const { data } = useQuery({
    queryKey: ['shareSeries', ticker, exchange],
    queryFn: () => getShareSeries({ data: { ticker: ticker as string, exchange } }),
    enabled: enabled && !!ticker,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
  if (!data || !data.series.length) return undefined;
  return data;
}
