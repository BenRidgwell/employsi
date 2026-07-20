import { useQuery } from '@tanstack/react-query';
import { getOpenRoles } from '../lib/openRolesFn';
import type { OpenRoles } from '../lib/openRolesFn';

// Live open roles for a company in a given job market (ATS feed → Adzuna + The
// Muse on the Worker), scoped by country/where/region so it works for every
// company, not just Australian ones. `roles` is the resolved data (count +
// source + advertised-job sample), or undefined while loading / when no source
// is configured; `settled` is true once the query has run, so the card can show
// 0 for "no live vacancies" only after the check completes rather than flashing
// it during load.
export function useOpenRoles(
  company: string | null,
  id: string | undefined,
  market: { country: string | null; where: string; region: string },
  enabled: boolean,
): { roles: OpenRoles | undefined; settled: boolean } {
  const active = enabled && !!company;
  const { data, isFetched } = useQuery({
    queryKey: ['openRoles', id, company, market.country, market.where],
    queryFn: () =>
      getOpenRoles({
        data: { company: company as string, id, country: market.country ?? '', where: market.where, region: market.region },
      }),
    enabled: active,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
  return { roles: data ?? undefined, settled: active && isFetched };
}
