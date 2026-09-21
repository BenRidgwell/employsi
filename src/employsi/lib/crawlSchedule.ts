/**
 * The scrape schedule, for the admin console's "Scheduled crawls" card.
 *
 * SOURCE OF TRUTH IS `workers/jobs-cron/wrangler.jsonc`. This file restates a
 * summary of it so the console can say when a family next runs, and the two can
 * drift. That is a deliberate trade — the alternative is shipping the Worker's
 * config into the client bundle to display three rows — but it means a cron
 * added there and not here shows a stale "next run" rather than an error.
 * `check-crawl-schedule.ts` asserts every expression below still appears in the
 * Worker's `crons`, so the drift fails a check instead of being discovered on
 * this card.
 *
 * Only the families worth a human knowing about are listed. The card exists to
 * answer one question — "is this feed dead, or has it just not run yet?" — so a
 * family that fires every six hours is more useful here than an exhaustive list
 * of 88 cron lines.
 */

export interface CrawlFamily {
  id: string;
  /** What a human calls this run. */
  title: string;
  /** Every cron expression in the Worker that belongs to this family. */
  crons: string[];
  /** One line on what it covers, shown under the title. */
  covers: string;
  /**
   * The scraper Worker paths a manual "Run now" fires, in order.
   *
   * One family can be several endpoints: the government boards are five
   * separate scrapes because each needs its own subrequest budget, so running
   * that family by hand is five calls and can partly succeed. The runner
   * reports which ones did rather than collapsing them to one yes/no.
   */
  endpoints: string[];
}

export const CRAWL_FAMILIES: CrawlFamily[] = [
  {
    id: "shard",
    title: "Company pull",
    // Seven ticks every six hours — see the SHARD note in workers/jobs-cron/
    // index.ts for why this is seven small runs rather than one big one.
    crons: [
      "0 */6 * * *",
      "10 */6 * * *",
      "20 */6 * * *",
      "25 */6 * * *",
      "35 */6 * * *",
      "40 */6 * * *",
      "42 */6 * * *",
    ],
    covers: "Adzuna, The Muse and Jooble, a shard of the roster per run",
    endpoints: ["/run"],
  },
  {
    id: "gov",
    title: "Government boards",
    crons: ["5 */6 * * *", "15 */6 * * *", "30 */6 * * *", "45 */6 * * *", "50 */6 * * *"],
    covers: "NT, VIC, WA, QLD and TAS job boards, one per invocation",
    endpoints: ["/run-ntgov", "/run-vicgov", "/run-wagov", "/run-qldgov", "/run-tasgov"],
  },
  {
    id: "portals",
    title: "Career portals",
    crons: ["20 4 * * *", "25 4 * * *", "35 4 * * *", "55 4 * * *"],
    covers: "Employer ATS feeds, a quarter of the portals per tick",
    // No ?group=, so a manual run walks every portal rather than one nightly
    // slice — the point of running by hand is to prove a feed is alive.
    endpoints: ["/run-portals"],
  },
  {
    id: "news",
    title: "Company news",
    crons: ["40 3 * * *", "50 3 * * *", "0 4 * * *", "10 4 * * *"],
    covers: "A quarter of the roster's news each run, nightly",
    endpoints: ["/run-news"],
  },
];

/**
 * Next UTC firing of a cron expression, at minute resolution.
 *
 * DELIBERATELY NOT A CRON LIBRARY. It understands only the two shapes this
 * repo's Worker actually uses — a fixed hour, and an every-N-hours step — and
 * returns null for anything else rather than guessing. A wrong "next run" here
 * is worse than a blank one: the card's whole purpose is deciding whether a
 * silent feed is broken or simply hasn't run, and a fabricated time answers
 * that question wrongly with total confidence.
 */
export function nextRun(cron: string, from: Date): Date | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minF, hourF, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;

  const minute = Number(minF);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  let hours: number[];
  if (hourF === "*") {
    hours = Array.from({ length: 24 }, (_, i) => i);
  } else if (/^\*\/\d+$/.test(hourF)) {
    const step = Number(hourF.slice(2));
    if (!step || step > 23) return null;
    hours = [];
    for (let h = 0; h < 24; h += step) hours.push(h);
  } else if (/^\d+$/.test(hourF)) {
    const h = Number(hourF);
    if (h > 23) return null;
    hours = [h];
  } else {
    return null;
  }

  // Walk forward from the next whole minute so a run happening right now is
  // reported as the NEXT one rather than as due.
  const start = new Date(from.getTime());
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const h of hours) {
      const c = new Date(
        Date.UTC(
          start.getUTCFullYear(),
          start.getUTCMonth(),
          start.getUTCDate() + dayOffset,
          h,
          minute,
        ),
      );
      if (c >= start) return c;
    }
  }
  return null;
}

/** Soonest firing across a family's ticks, or null if none parse. */
export function nextForFamily(f: CrawlFamily, from: Date): Date | null {
  let best: Date | null = null;
  for (const c of f.crons) {
    const n = nextRun(c, from);
    if (n && (!best || n < best)) best = n;
  }
  return best;
}

/** "in 12m" / "in 3h 20m" — the form the card shows next to the clock time. */
export function untilLabel(when: Date, from: Date): string {
  const mins = Math.max(0, Math.round((when.getTime() - from.getTime()) / 60000));
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}
