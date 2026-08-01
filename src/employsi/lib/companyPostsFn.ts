import { createServerFn } from "@tanstack/react-start";
import type { D1Like } from "./jobArchive";
import { callerRole } from "./sessionRole";
import { isReleasedCompany, seesAllMarkets } from "./markets";

/**
 * A company's own LinkedIn posts, for the "in the news" card.
 *
 * These are the employer speaking, not a publisher reporting, and the card
 * labels them as such — see NewsPanel's "Company post" tag. Mixing an
 * employer's own announcement into a list of news articles without saying so
 * would present marketing as coverage, which is the one thing a news card must
 * not do.
 *
 * Collected daily by scripts/linkedin-posts-to-d1.py into `company_posts`. That
 * script explains why the referenced scrapfly scraper could not be used (it has
 * no company-feed capability) and how the real publish date is recovered from
 * the activity id rather than the relative "1w" label.
 *
 * MARKET-GATED, like every other server function that returns company data: an
 * end user gets nothing for a company outside the released markets, so this
 * cannot be used to read around the coverage gate.
 */

export interface CompanyPost {
  /** First sentence of the post — LinkedIn posts have no title field. */
  title: string;
  body: string;
  url: string;
  image?: string;
  /** Real ISO timestamp, decoded from the activity id. */
  published: string;
  /** The posting page's own name, as LinkedIn printed it. */
  author: string;
}

async function db(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

/**
 * Posts older than this are not shown.
 *
 * The news card is a "what's happening" surface; a nine-month-old post sitting
 * above this week's coverage would misrepresent how active the employer is.
 * The rows stay in D1 either way — this bounds the VIEW, not the archive.
 */
const MAX_AGE_DAYS = 120;

export const getCompanyPosts = createServerFn({ method: "GET" })
  .validator((data: { companyId: string; limit?: number }) => data)
  .handler(async ({ data }): Promise<{ posts: CompanyPost[] }> => {
    const companyId = (data.companyId || "").trim();
    if (!companyId) return { posts: [] };
    const limit = Math.min(Math.max(data.limit ?? 4, 1), 10);

    const role = await callerRole();
    if (!seesAllMarkets(role) && !isReleasedCompany(companyId)) return { posts: [] };

    const d = await db();
    if (!d) return { posts: [] };
    try {
      const res = await d
        .prepare(
          `SELECT title, body, url, image, posted, author
             FROM company_posts
            WHERE company_id = ?1
              AND posted >= datetime('now', ?2)
            ORDER BY posted DESC
            LIMIT ?3`,
        )
        .bind(companyId, `-${MAX_AGE_DAYS} day`, limit)
        .all();
      const posts: CompanyPost[] = (res?.results ?? []).map((r) => ({
        title: String(r.title || ""),
        body: String(r.body || ""),
        url: String(r.url || ""),
        image: r.image ? String(r.image) : undefined,
        published: String(r.posted || ""),
        author: String(r.author || ""),
      }));
      return { posts: posts.filter((p) => p.title && p.url) };
    } catch {
      return { posts: [] };
    }
  });
