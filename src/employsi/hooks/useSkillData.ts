import { useQuery } from '@tanstack/react-query';
import { getSkillIndex, getCompanyJobs } from '../lib/skillsFn';
import type { SkillIndex, CompanyJobs } from '../lib/skillsFn';

// The whole live skill-demand index (small — one KV read). Loaded once and
// shared for search suggestions and the demand heat map.
export function useSkillIndex(enabled = true): SkillIndex | null {
  const { data } = useQuery({
    queryKey: ['skillIndex'],
    queryFn: () => getSkillIndex(),
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return data ?? null;
}

// A single company's advertised roles + mapped skills, for the card.
export function useCompanyJobs(id: string | undefined, enabled: boolean): CompanyJobs | null {
  const { data } = useQuery({
    queryKey: ['companyJobs', id],
    queryFn: () => getCompanyJobs({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return data ?? null;
}
