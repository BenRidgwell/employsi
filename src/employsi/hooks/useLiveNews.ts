import { useQuery } from '@tanstack/react-query';
import { getLiveNews } from '../lib/liveNewsFn';
import type { LiveNewsItem } from '../lib/liveNewsFn';

// Fetches recent Google News results for a query on the Worker. Returns an
// empty list until it resolves (or if nothing is found), so callers can fall
// back to their illustrative feed. Refetches at most every few minutes.
export function useLiveNews(query: string | null, limit = 8): LiveNewsItem[] {
  const { data } = useQuery({
    queryKey: ['liveNews', query, limit],
    queryFn: () => getLiveNews({ data: { query: query as string, limit } }),
    enabled: !!query,
    staleTime: 8 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
  return data?.items ?? [];
}
