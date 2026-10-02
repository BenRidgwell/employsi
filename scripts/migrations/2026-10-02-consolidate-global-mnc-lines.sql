-- ════════════════════════════════════════════════════════════════════════════
-- Employsi D1 (employsi-jobs-archive, 1c5f3ffb-…) — fold the second roster line
-- of three global companies into the first.          Prepared 2026-10-02.
--
--   retired id        -> kept id       company        rows to move
--   london-rio        -> rio           Rio Tinto      0 jobs, 0 views
--   houston-cvx       -> chevron       Chevron        0 jobs, 1 view
--   hongkong-00005    -> london-hsba   HSBC Holdings  49 jobs, 1 view
--
-- WHY. Each was carried as TWO roster lines, with COMPANY_ID_ALIAS making the
-- second READ the first one's rows. Both cards drew, so one employer had two
-- pins and two cards and neither showed the whole company. For a global
-- employer the card should show total activity, because that is its scale. The
-- ids are now in MERGED_COMPANY_ID (data/mergedCompanies.ts) like any other
-- duplicate, and the city each retired line stood for is kept as a pin through
-- data/secondaryOffices.ts — Rio Tinto still appears in London, Chevron in
-- Houston, HSBC in Hong Kong.
--
-- The kept id is the one carrying the scraper feed and the rows: `rio` 2,501,
-- `chevron` 698, `london-hsba` 4,535. Two of the three retired lines held no
-- jobs at all, which is exactly why they read as a false zero and topped the
-- "no own board" list while the board was already being read.
--
-- NO COLLISIONS. company_id is not part of job_key (source|title|company|
-- location), so re-pointing cannot collide; measured 2026-10-02, none of
-- HSBC's 49 rows shares a (source, url) with a london-hsba row. `views` has
-- (kind, ref) as its PK and both HSBC refs exist, so that one is folded with
-- ON CONFLICT. company_slugs, flow_company_map, flows, flow_months and
-- user_follow hold none of the three retired ids.
--
-- DEPLOY THE CODE FIRST. data/chinaJobsTargets.ts now files the Hong Kong
-- Zhaopin target under `london-hsba` (hub still hongkong, so the ads still
-- count in Hong Kong), and until that ships the feed writes the retired id.
-- Idempotent, so a re-run after the next nightly sweeps anything in between.
--
-- Run it with
--   npx wrangler d1 execute employsi-jobs-archive --remote \
--     --file scripts/migrations/2026-10-02-consolidate-global-mnc-lines.sql
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. BACKUP ───────────────────────────────────────────────────────────────
-- Restore: UPDATE jobs SET company_id = 'hongkong-00005'
--           WHERE job_key IN (SELECT job_key FROM _bak_mnc_20261002_jobs);
--          plus the views rows from _bak_mnc_20261002_views.

CREATE TABLE IF NOT EXISTS _bak_mnc_20261002_jobs AS
  SELECT * FROM jobs
   WHERE company_id IN ('london-rio', 'houston-cvx', 'hongkong-00005');

CREATE TABLE IF NOT EXISTS _bak_mnc_20261002_views AS
  SELECT * FROM views
   WHERE kind = 'company'
     AND ref IN ('london-rio', 'houston-cvx', 'hongkong-00005');

-- Expect 49 and 2.
SELECT (SELECT COUNT(*) FROM _bak_mnc_20261002_jobs)  AS jobs_backed_up,
       (SELECT COUNT(*) FROM _bak_mnc_20261002_views) AS views_backed_up;


-- ── 1. jobs ─────────────────────────────────────────────────────────────────
UPDATE jobs SET company_id = 'rio'          WHERE company_id = 'london-rio';      -- expect 0
UPDATE jobs SET company_id = 'chevron'      WHERE company_id = 'houston-cvx';     -- expect 0
UPDATE jobs SET company_id = 'london-hsba'  WHERE company_id = 'hongkong-00005';  -- expect 49


-- ── 2. views — add the retired count onto the kept row, then drop it ────────
INSERT INTO views (kind, ref, label, sub, count, last_viewed)
  SELECT kind,
         CASE ref WHEN 'london-rio'     THEN 'rio'
                  WHEN 'houston-cvx'    THEN 'chevron'
                  WHEN 'hongkong-00005' THEN 'london-hsba' END AS nref,
         NULL, NULL, SUM(count), MAX(last_viewed)
    FROM views
   WHERE kind = 'company'
     AND ref IN ('london-rio', 'houston-cvx', 'hongkong-00005')
   GROUP BY kind, nref
ON CONFLICT(kind, ref) DO UPDATE SET
   count = count + excluded.count,
   last_viewed = MAX(COALESCE(last_viewed, ''), COALESCE(excluded.last_viewed, ''));

DELETE FROM views
 WHERE kind = 'company'
   AND ref IN ('london-rio', 'houston-cvx', 'hongkong-00005');


-- ── 3. CHECK — every retired id reads 0, the kept ones carry the total ─────
SELECT 'jobs' AS t, company_id AS id, COUNT(*) AS n FROM jobs
 WHERE company_id IN ('london-rio', 'rio', 'houston-cvx', 'chevron',
                      'hongkong-00005', 'london-hsba')
 GROUP BY company_id
UNION ALL
SELECT 'views', ref, SUM(count) FROM views
 WHERE kind = 'company'
   AND ref IN ('london-rio', 'rio', 'houston-cvx', 'chevron',
               'hongkong-00005', 'london-hsba')
 GROUP BY ref;
-- Expect: jobs rio 2,501 · chevron 698 · london-hsba 4,584 (4,535 + 49) and no
-- retired id; views chevron 1, london-hsba 3 (2 + 1), no retired id. The jobs
-- figures move with the nightly; the retired ids reading nothing is the check.


-- ── 4. CLEAN-UP, once verified ─────────────────────────────────────────────
-- DROP TABLE _bak_mnc_20261002_jobs;
-- DROP TABLE _bak_mnc_20261002_views;
