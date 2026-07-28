/**
 * Publishers that must never appear in the "In the news" feed.
 *
 * Shared by the app's live-news server function and the jobs-cron worker's
 * nightly refresh, so an outlet cannot be filtered out of one path and slip in
 * through the other.
 *
 * Each entry is matched against BOTH the publisher label and the article's
 * host, because the same outlet arrives labelled differently depending on the
 * provider — Bing may say "Motley Fool Australia", GDELT gives the bare domain,
 * and syndicated copies land on other hosts entirely. Matching the host is what
 * actually holds; the label patterns catch the syndications.
 */

export interface BlockedPublisher {
  /** Host suffixes: an article on any of these is dropped. */
  hosts: string[];
  /** Case-insensitive substrings matched against the publisher label. */
  labels: string[];
}

export const BLOCKED_PUBLISHERS: BlockedPublisher[] = [
  {
    hosts: ["fool.com", "fool.com.au", "fool.ca", "fool.co.uk", "fool.sg"],
    labels: ["motley fool", "the motley fool"],
  },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * True when this article must not be shown. Safe on partial input — an item
 * with no URL is judged on its label alone, and vice versa.
 */
export function isBlockedArticle(url: string | undefined, publisher: string | undefined): boolean {
  const host = hostOf(url || "");
  const label = (publisher || "").toLowerCase();
  return BLOCKED_PUBLISHERS.some(
    (b) =>
      (host && b.hosts.some((h) => host === h || host.endsWith(`.${h}`))) ||
      (label && b.labels.some((l) => label.includes(l))),
  );
}
