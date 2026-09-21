import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { CRAWL_FAMILIES } from "./crawlSchedule";

/**
 * Fire a scrape by hand, from the admin console's "Scheduled crawls" card.
 *
 * WHY THIS EXISTS. A feed that has stopped writing looks exactly like a quiet
 * market, and the console can already show you which feeds are silent — but
 * telling those two apart means waiting for the next scheduled tick, which for
 * the portals and news is up to 24 hours away. Running the family early
 * collapses that wait: if it writes, the feed is alive and the market is quiet;
 * if it comes back empty or errors, the feed is broken.
 *
 * THIS WRITES TO THE PRODUCTION ARCHIVE, FROM WHEREVER IT IS CALLED. The
 * bindings are declared in the root wrangler.jsonc rather than per-Worker, so
 * the preview Worker holds the real JOBS_ARCHIVE and the real KV — a run
 * started from employsi-preview lands in the same D1 as one started from
 * production. That is not a bug to fix here; it is the documented arrangement
 * (see CLAUDE.md), and it is the reason this is admin-only and the button says
 * what it will do before you press it.
 *
 * It is idempotent in the way that matters: the archive upserts on job_key, so
 * a manual run re-seen a row bumps last_seen and seen_count rather than
 * inserting a duplicate. The cost of an unnecessary run is upstream API quota
 * and some seconds, not corrupted data.
 *
 * ADMIN ONLY, ENFORCED HERE, and this is the one server function in the console
 * that CHANGES something rather than reading it. The role is re-derived from
 * the session cookie exactly as getDataQuality does; the caller is not trusted
 * to say who it is.
 */

interface CronEnv {
  /** Shared with the scraper Worker, which compares it to its own CRON_TOKEN. */
  CRON_TOKEN?: string;
  /** Override for the scraper's origin; defaults to its workers.dev hostname. */
  JOBS_CRON_URL?: string;
}

const DEFAULT_ORIGIN = "https://employsi-jobs-cron.employsi.workers.dev";

async function cronEnv(): Promise<CronEnv> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env ?? {}) as CronEnv;
  } catch {
    return {};
  }
}

export interface CrawlRunResult {
  ok: boolean;
  /** Set when the run could not be attempted at all. */
  error?: string;
  /** Per-endpoint outcome, in the order the family declares them. */
  steps: { path: string; ok: boolean; status: number; detail: string }[];
  /** How long the whole thing took, so a slow feed is visible as slow. */
  ms: number;
}

/**
 * Is the trigger configured on THIS deployment?
 *
 * Secrets are per-Worker, so a console served from a Worker without CRON_TOKEN
 * cannot fire anything. The card asks this and renders the reason instead of a
 * button, rather than offering one that always fails — the same rule the
 * sign-in surface follows with authAvailable().
 */
export const crawlTriggerAvailable = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: boolean; reason?: string }> => {
    if ((await callerRole()) !== "admin") return { ok: false, reason: "Not permitted." };
    const env = await cronEnv();
    if (!env.CRON_TOKEN) {
      return {
        ok: false,
        reason: "CRON_TOKEN is not set on this deployment, so crawls cannot be fired from here.",
      };
    }
    return { ok: true };
  },
);

export const runCrawl = createServerFn({ method: "POST" })
  .validator((d: { family: string }) => d)
  .handler(async ({ data }): Promise<CrawlRunResult> => {
    const started = Date.now();
    const fail = (error: string): CrawlRunResult => ({
      ok: false,
      error,
      steps: [],
      ms: Date.now() - started,
    });

    if ((await callerRole()) !== "admin") return fail("Not permitted.");

    const family = CRAWL_FAMILIES.find((f) => f.id === data.family);
    // Never build a URL from the caller's string: only an id that matches a
    // family this repo declares can reach the scraper, so this cannot be used
    // to point the token at an arbitrary path.
    if (!family) return fail("Unknown crawl family.");

    const env = await cronEnv();
    if (!env.CRON_TOKEN) return fail("CRON_TOKEN is not set on this deployment.");
    const origin = (env.JOBS_CRON_URL || DEFAULT_ORIGIN).replace(/\/+$/, "");

    const steps: CrawlRunResult["steps"] = [];
    for (const path of family.endpoints) {
      const url = `${origin}${path}?token=${encodeURIComponent(env.CRON_TOKEN)}`;
      try {
        const res = await fetch(url, { method: "GET" });
        const text = await res.text();
        let detail = text.slice(0, 300);
        try {
          const j = JSON.parse(text);
          // The scrapers answer in different shapes — a shard returns counts, a
          // portal run returns a per-site list. Summarise rather than guess a
          // single "rows written" number that some of them do not report.
          if (j && typeof j === "object") {
            if (j.error) detail = String(j.error).slice(0, 300);
            else if (Array.isArray(j.sites)) detail = `${j.sites.length} sites`;
            else {
              const nums = Object.entries(j)
                .filter(([k, v]) => k !== "ok" && typeof v === "number")
                .map(([k, v]) => `${k} ${v}`);
              detail = nums.length ? nums.join(", ") : "ok";
            }
          }
        } catch {
          /* not JSON — keep the raw prefix, which is what a 403 returns */
        }
        steps.push({ path, ok: res.ok, status: res.status, detail });
      } catch (e) {
        // A scrape that runs long enough for the fetch to give up has not
        // necessarily failed upstream, and saying so is the honest report.
        steps.push({
          path,
          ok: false,
          status: 0,
          detail: `request failed: ${(e as Error)?.message || String(e)}`,
        });
      }
    }

    return {
      // Partial success is not success: five gov boards where two failed is a
      // result the reader has to see, not a green tick.
      ok: steps.length > 0 && steps.every((s) => s.ok),
      steps,
      ms: Date.now() - started,
    };
  });
