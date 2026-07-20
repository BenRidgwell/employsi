import { useQuery } from '@tanstack/react-query';
import { getRoleHistory } from '../lib/jobHistoryFn';
import type { RoleHistory } from '../lib/jobHistoryFn';

// A company's archived role history (D1). Null until the archive has at least
// one listing for the company, or off-Worker. Cached for the session — the
// archive only changes on the daily cron / a fresh live fetch.
export function useRoleHistory(id: string | undefined, enabled: boolean): RoleHistory | null {
  const { data } = useQuery({
    queryKey: ['roleHistory', id],
    queryFn: () => getRoleHistory({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return data ?? null;
}
