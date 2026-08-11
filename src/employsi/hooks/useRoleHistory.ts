import { useQuery } from "@tanstack/react-query";
import {
  getRoleHistory,
  getVacancyTrend,
  getSkillTrends,
  getCompanySkillTrends,
} from "../lib/jobHistoryFn";
import type { RoleHistory, SkillMover, CompanySkillTrends } from "../lib/jobHistoryFn";
import type { RolePoint } from "../lib/openRolesFn";

// Stable empty value, so a card that has not loaded yet does not get a fresh
// object identity on every render and re-run its memos.
const EMPTY_SKILL_TRENDS: CompanySkillTrends = { days: [], skills: [], areas: [] };

// A company's archived role history (D1). Null until the archive has at least
// one listing for the company, or off-Worker. Cached for the session — the
// archive only changes on the daily cron / a fresh live fetch.
export function useRoleHistory(id: string | undefined, enabled: boolean): RoleHistory | null {
  const { data } = useQuery({
    queryKey: ["roleHistory", id],
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
    queryKey: ["vacancyTrend", id],
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
    queryKey: ["skillTrends", id],
    queryFn: () => getSkillTrends({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return data ?? [];
}

// Everything one company is currently recruiting for, skill by skill, with a
// daily series behind each (D1). Backs the card's skill search and the
// per-skill sparklines. Same session-length cache as its neighbours — the
// archive only moves on the daily cron or a fresh live fetch.
export function useCompanySkillTrends(
  id: string | undefined,
  enabled: boolean,
): CompanySkillTrends {
  const { data } = useQuery({
    queryKey: ["companySkillTrends", id],
    queryFn: () => getCompanySkillTrends({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
  });
  return data ?? EMPTY_SKILL_TRENDS;
}
