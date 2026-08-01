import { useQuery } from "@tanstack/react-query";
import { getCompanyPosts, type CompanyPost } from "../lib/companyPostsFn";

const EMPTY: CompanyPost[] = [];

/**
 * A company's own LinkedIn posts for the news card.
 *
 * Cached for an hour: the collector runs daily, so a shorter window would
 * re-ask the Worker for a row that cannot have changed. Returns a STABLE empty
 * array when there is nothing, so the caller's useMemo does not re-run on every
 * render (the same identity-churn bug the ticker had).
 */
export function useCompanyPosts(companyId: string | null, limit = 4): CompanyPost[] {
  const { data } = useQuery({
    queryKey: ["company-posts", companyId, limit],
    enabled: !!companyId,
    staleTime: 60 * 60 * 1000,
    queryFn: () => getCompanyPosts({ data: { companyId: companyId as string, limit } }),
  });
  return data?.posts?.length ? data.posts : EMPTY;
}
