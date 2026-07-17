import { useQuery } from '@tanstack/react-query';
import { getRolesHistory } from '../lib/openRolesFn';
import type { RolePoint } from '../lib/openRolesFn';

// Stored open-roles history (daily snapshots) for an Australian company.
// Empty until the company has been queried at least once — history is recorded
// forward from now, so it fills in over the following days/weeks.
export function useRolesHistory(id: string | undefined, enabled: boolean): RolePoint[] {
  const { data } = useQuery({
    queryKey: ['rolesHistory', id],
    queryFn: () => getRolesHistory({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
  return data ?? [];
}
