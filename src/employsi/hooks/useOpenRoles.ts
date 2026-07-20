import { useQuery } from '@tanstack/react-query';
import { getOpenRoles } from '../lib/openRolesFn';
import type { OpenRoles } from '../lib/openRolesFn';

// Live open-roles count for an Australian company (ATS feed → Adzuna + The Muse
// on the Worker). `roles` is the resolved count (or undefined while loading /
// when no source is configured); `settled` is true once the query has run, so
// the card can show 0 for "no live vacancies" only after the check completes
// rather than flashing it during load.
export function useOpenRoles(
  company: string | null,
  id: string | undefined,
  enabled: boolean,
): { roles: OpenRoles | undefined; settled: boolean } {
  const active = enabled && !!company;
  const { data, isFetched } = useQuery({
    queryKey: ['openRoles', id, company],
    queryFn: () => getOpenRoles({ data: { company: company as string, id } }),
    enabled: active,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
  return { roles: data ?? undefined, settled: active && isFetched };
}
