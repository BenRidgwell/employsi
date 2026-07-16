import { useQuery } from '@tanstack/react-query';
import { getCompanyStats } from '../lib/companyStatsFn';
import type { CompanyStats } from '../lib/companyStatsFn';

// Fetches live company fundamentals (headcount, revenue, EBITDA, market cap
// and per-employee ratios) for a ticker on the Worker. Returns undefined until
// it resolves or if the ticker yields no usable data, so callers fall back to
// the illustrative figures.
export function useCompanyStats(ticker: string | null, exchange: string | undefined, enabled: boolean): CompanyStats | undefined {
  const { data } = useQuery({
    queryKey: ['companyStats', ticker, exchange],
    queryFn: () => getCompanyStats({ data: { ticker: ticker as string, exchange } }),
    enabled: enabled && !!ticker,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
  if (!data || (!data.headcount && !data.revPerEmp && !data.ebitdaPerEmp)) return undefined;
  return data;
}
