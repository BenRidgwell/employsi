/**
 * The two weighted feed-coverage rules, one per end of a window, shared by
 * every series drawn over the archive: the analyst, the company card's skill
 * trends, and the career-pathway build (which runs in the scraper Worker, so
 * this module must import nothing).
 *
 *   coveredFrom — the START: the day by which the feeds carrying 95% of the
 *                 rows had arrived. Before it, a climb is the archive filling.
 *   coverageDay — the END: the newest day the feeds carrying 95% of the rows
 *                 have reported. After it, a fall is a feed not yet run.
 *
 * Moved here unchanged from analystFn and jobHistoryFn, so that the Worker
 * could share the rule rather than restate it — with the analyst's two guards
 * on the END rule, FEED_LOOKBACK_DAYS and MAX_STEP_BACK_DAYS.
 */

/** How far back a feed can have last written and still count toward coverage.
 *  Past this it is dead or dormant, and a dead feed must not be able to veto
 *  every recent day for everyone else. */
export const FEED_LOOKBACK_DAYS = 21;
/**
 * How far coverage is allowed to drag the reference day back.
 *
 * A floor, because the two failure modes are not symmetric. Reporting a short
 * day as a real fall is a wrong answer; reporting a complete day from a while
 * ago is a true answer about the wrong moment — worse the further back it
 * goes, and past a few days it stops being an answer about now at all.
 *
 * It is a real risk, not a hypothetical: BHP clears the 95% target by 882 rows
 * against 876.85 needed. Had its dormant vendor feed carried a little more,
 * coverage would have pointed at 2026-07-29 and the answer would have been a
 * fortnight stale without saying anything was wrong. Past this floor the
 * shortfall is accepted, and the date the note already prints is what lets a
 * reader see which day they are being told about.
 */
export const MAX_STEP_BACK_DAYS = 3;

/**
 * Share of an employer's rows whose feeds must have been running before a day
 * counts as covered for that employer — and, at the other end of the window,
 * the share coverageDay waits for. One value, one argument: below about this
 * much the shortfall is inside ordinary daily noise, above it the missing feed
 * is visible as a trend.
 */
export const FEED_COVERAGE_TARGET = 0.95;

/**
 * The day by which feeds carrying FEED_COVERAGE_TARGET of an employer's rows
 * had begun covering it, or "" when that cannot be established.
 *
 * Walk the feeds oldest-start first, accumulating their share; the day the
 * running total clears the target is the first day the picture is essentially
 * complete. Everything before it is missing whichever feeds had not arrived,
 * which is the archive assembling itself rather than a market moving.
 */
export function coveredFrom(starts: Record<string, string>, rows: Record<string, number>): string {
  const feeds = Object.keys(starts);
  if (!feeds.length) return "";
  const total = feeds.reduce((t, s) => t + (rows[s] || 0), 0);
  if (!total) return "";
  const need = total * FEED_COVERAGE_TARGET;
  let acc = 0;
  for (const s of feeds.sort((a, b) =>
    starts[a] < starts[b] ? -1 : starts[a] > starts[b] ? 1 : 0,
  )) {
    acc += rows[s] || 0;
    if (acc >= need) return starts[s];
  }
  return "";
}

/**
 * The most recent day the scope's feeds have actually confirmed.
 *
 * LIVE_ON_DAY can only see an ad as live on day D if some feed pulled it on or
 * after D. Feeds run on their own crons, so the last day or two is always
 * short: whatever has not cycled yet is missing, and the count climbs as the
 * day's runs land. Measured on production 2026-08-12, BHP's live-on-day curve
 * sat between 360 and 452 for a fortnight, then read 235 for the 11th and 92
 * for the 12th — no vacancies closed, two feeds simply had not run.
 *
 * Stepping back one fixed day does not fix it (the 11th is short too), and
 * requiring EVERY feed to have pulled is worse: one weekly feed with six rows
 * would permanently pin the whole world scope five days back. So the rule is
 * by weight — walk the feeds newest-pull first and take the day at which the
 * ones counted reach FEED_COVERAGE_TARGET of the scope's rows. Measured the same
 * day, that picks the 10th for BHP (452 live, and the short 11th correctly
 * rejected) and the 11th for Perth and for worldwide, both of which were
 * stable there. A slow feed carrying under 5% is outvoted rather than
 * obeyed — the cost is that its ads are missing from the last day or two,
 * which is why the target is 95% and not lower.
 */
export function coverageDay(feeds: Array<{ mx: string; n: number }>): string {
  const total = feeds.reduce((t, f) => t + f.n, 0);
  if (!total) return "";
  const need = total * FEED_COVERAGE_TARGET;
  let acc = 0;
  for (const f of [...feeds].sort((a, b) => (a.mx < b.mx ? 1 : a.mx > b.mx ? -1 : 0))) {
    acc += f.n;
    if (acc >= need) return f.mx;
  }
  return "";
}
