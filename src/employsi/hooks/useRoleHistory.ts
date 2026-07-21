import { useQuery } from '@tanstack/react-query';
import { getRoleHistory, getVacancyTrend, getSkillTrends } from '../lib/jobHistoryFn';
import type { RoleHistory, SkillMover } from '../lib/jobHistoryFn';
import type { RolePoint } from '../lib/openRolesFn';

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

// A company's daily "live vacancies" series derived from the D1 archive — the
// history-backed movement chart (used for WA government agencies, whose live
// count comes from the scraped board rather than Adzuna).
export function useVacancyTrend(id: string | undefined, enabled: boolean): RolePoint[] {
  const { data } = useQuery({
    queryKey: ['vacancyTrend', id],
    queryFn: () => getVacancyTrend({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return data ?? [];
}

// Top skill increases / decreases for a company (D1 historical analysis).
export function useSkillTrends(id: string | undefined, enabled: boolean): SkillMover[] {
  const { data } = useQuery({
    queryKey: ['skillTrends', id],
    queryFn: () => getSkillTrends({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return data ?? [];
}
