-- How long an ad stayed up: last_seen - first_seen, in whole days.
--
-- WHY A GENERATED COLUMN AND NOT A STORED ONE
-- last_seen moves every time a live ad is re-seen, so a stored days_advertised
-- would be wrong the moment the next daily pull lands and would need all ~11k
-- live rows rewritten nightly to stay right. VIRTUAL costs nothing to write,
-- is never stale, and reads the same as any other column. SQLite computes it on
-- access; ALTER TABLE ADD COLUMN accepts VIRTUAL (but not STORED), which is
-- exactly the case here.
--
-- WHAT IT DOES AND DOES NOT MEASURE
-- This is DAYS ADVERTISED, not time to fill. The archive observes ads, never
-- hires, so a disappearance means the ad came down — filled, expired, withdrawn
-- or the parser broke — and nothing here can tell those apart. Three further
-- limits that any aggregate over this column has to respect:
--
--  1. RIGHT-CENSORED. A live ad's last_seen is today, so its span is truncated
--     at "still open". Averaging live and closed ads together drags the figure
--     down. Aggregate over closed ads only (last_seen < the latest pull).
--  2. FLOORED BY COLLECTION. first_seen is when WE first saw the ad, not when
--     it was posted. Collection began 2026-07-16, so no span can exceed the
--     archive's own depth, and an ad already running before that date reads as
--     starting on the day we arrived.
--  3. ONE-DAY GRANULARITY. Pulls are daily, so a span is accurate to +/- a day
--     and an ad posted and pulled within one day reads as 0.
--
-- The `posted` column carries the ad's own publication date for ~80% of rows
-- and escapes limit 2 where present, which is why days_since_posted exists
-- alongside this rather than replacing it — the two answer different questions
-- and the caller picks.
ALTER TABLE jobs ADD COLUMN days_advertised INTEGER
  GENERATED ALWAYS AS (
    CAST(julianday(last_seen) - julianday(first_seen) AS INTEGER)
  ) VIRTUAL;

-- The same span measured from the ad's own posted date where the source
-- publishes one, so an ad that was already up when collection started is not
-- truncated to the day we found it. NULL when the source gives no date, when
-- the date is not ISO (indeed and the state government boards publish none),
-- or when it post-dates last_seen — a few hundred rows across adzuna, jora and
-- mycareersfuture carry a future posted date, and a negative span is a parser
-- artefact, not a short ad.
ALTER TABLE jobs ADD COLUMN days_since_posted INTEGER
  GENERATED ALWAYS AS (
    CASE
      WHEN posted GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       AND posted <= last_seen
      THEN CAST(julianday(last_seen) - julianday(posted) AS INTEGER)
    END
  ) VIRTUAL;
