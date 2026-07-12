import { useQuery } from '@tanstack/react-query';
import { getBhpFeed } from '../lib/bhpFeedFn';
import type { BhpFeed } from '../data/bhpFeed';

// Polls the BHP live feed while the card is open. Returns undefined until the
// first response arrives, so callers fall back to the illustrative data.
export function useBhpFeed(enabled: boolean): BhpFeed | undefined {
  const { data } = useQuery({
    queryKey: ['bhpFeed'],
    queryFn: () => getBhpFeed(),
    enabled,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  return data;
}
