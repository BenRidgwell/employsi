import { useQuery } from '@tanstack/react-query';
import { getOpenRoles } from '../lib/openRolesFn';
import type { OpenRoles } from '../lib/openRolesFn';

// Live open-roles count for an Australian company (ATS feed → Adzuna on the
// Worker). Returns undefined until it resolves, or if no source is configured
// (e.g. the Adzuna key isn't set), so the card keeps its illustrative figure.
export function useOpenRoles(company: string | null, id: string | undefined, enabled: boolean): OpenRoles | undefined {
  const { data } = useQuery({
    queryKey: ['openRoles', id, company],
    queryFn: () => getOpenRoles({ data: { company: company as string, id } }),
    enabled: enabled && !!company,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
  return data ?? undefined;
}
