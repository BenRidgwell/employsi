import { useQueries } from '@tanstack/react-query';
import { getArticleImage } from '../lib/articleImageFn';
import type { ArticleMeta } from '../lib/articleImageFn';

// Given a list of real article URLs, resolves each one's og:image, publish date
// and publisher on the Worker and returns a { url -> ArticleMeta } map. Only
// genuine http(s) article links are looked up (the Google-News search fallback
// has no single article to scrape), and results are cached hard — an article's
// metadata doesn't change, so there's no need to refetch across cards.
export function useArticleImages(urls: (string | undefined)[]): Record<string, ArticleMeta> {
  const real = Array.from(new Set(urls.filter((u): u is string => !!u && /^https?:\/\//i.test(u))));
  const results = useQueries({
    queries: real.map((url) => ({
      queryKey: ['articleMeta', url],
      queryFn: () => getArticleImage({ data: { url } }),
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    })),
  });
  const map: Record<string, ArticleMeta> = {};
  real.forEach((url, i) => {
    const d = results[i].data;
    if (d) map[url] = d;
  });
  return map;
}
