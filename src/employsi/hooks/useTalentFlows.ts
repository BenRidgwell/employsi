import { useQuery } from "@tanstack/react-query";
import { getCompanyFlows } from "../lib/flowsFn";
import type { CompanyFlows } from "../lib/flows";

// A company's talent flows (D1). Null until a delivery that mentions the
// company has been loaded. Deliveries arrive weekly at most, so the session
// cache is long.
export function useTalentFlows(id: string | undefined, enabled: boolean): CompanyFlows | null {
  const { data } = useQuery({
    queryKey: ["talentFlows", id],
    queryFn: () => getCompanyFlows({ data: { id: id as string } }),
    enabled: enabled && !!id,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
  return data ?? null;
}
