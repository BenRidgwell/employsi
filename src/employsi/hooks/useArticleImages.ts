import { useQueries } from '@tanstack/react-query';
import { getArticleImage } from '../lib/articleImageFn';

// Given a list of real article URLs, resolves each one's og:image on the Worker
// and returns a { url -> imageUrl } map. Only genuine http(s) article links are
// looked up (the Google-News search fallback has no single article to scrape),
// and results are cached hard — an article's share image doesn't change, so
// there's no need to refetch across cards or sessions.
export function useArticleImages(urls: (string | undefined)[]): Record<string, string> {
  const real = Array.from(new Set(urls.filter((u): u is string => !!u && /^https?:\/\//i.test(u))));
  const results = useQueries({
    queries: real.map((url) => ({
      queryKey: ['articleImage', url],
      queryFn: () => getArticleImage({ data: { url } }),
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    })),
  });
  const map: Record<string, string> = {};
  real.forEach((url, i) => {
    const img = results[i].data?.image;
    if (img) map[url] = img;
  });
  return map;
}
