-- ════════════════════════════════════════════════════════════════════════════
-- Employsi D1 (employsi-jobs-archive, 1c5f3ffb-…) — merge duplicate roster ids
-- and retire the two Charter Hall REITs.            Prepared 2026-09-30. Section 0 (backups) was RUN 2026-09-30 06:0x UTC; sections 1-7 NOT RUN.
--
--   retired id        -> kept id           company
--   brisbane-smr      -> smr               Stanmore Resources
--   hongkong-00700    -> shenzhen-00700    Tencent
--   beijing-00992     -> hongkong-00992    Lenovo
--   hongkong-01810    -> beijing-01810     Xiaomi
--   hongkong-02628    -> beijing-601628    China Life Insurance
--   sydney-clw        -> sydney-chc        Charter Hall (REIT, externally managed)
--   sydney-cqr        -> sydney-chc        Charter Hall (REIT, externally managed)
--
-- Same map as src/employsi/data/mergedCompanies.ts. Deploy the code change
-- FIRST (so no ingestion path writes a retired id after this runs) — or run
-- this after the next nightly runs of Adzuna/SEEK/Jora/Indeed/LinkedIn/
-- SimplyHired/JobStreet/Zhaopin have picked up the new roster, then re-run
-- section 2 (it is idempotent) to sweep anything written in between.
--
-- Counts measured read-only 2026-09-30 are in merge_dryrun.txt; the expected
-- row counts are noted beside each statement. Run it section by section with
--   npx wrangler d1 execute employsi-jobs-archive --remote --file merge_migration.sql
-- (D1 runs a --file as one batch; a failure part-way rolls the batch back).
--
-- UNIQUE CONSTRAINTS. `jobs` is keyed by job_key (source|title|company|
-- location) — company_id is NOT in the key, so re-pointing company_id can never
-- collide. The same holds for flows / flow_months / flow_skills (ids are not in
-- their PKs) and flow_company_map (PK = ref). The tables whose PK DOES include
-- the id are company_slugs (company_id), user_follow (user_id, kind, ref) and
-- views (kind, ref); each is handled with a collision-aware form below even
-- where today's count is zero, so a re-run after new rows arrive is still safe.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. BACKUPS — every row this script will touch, before it touches it ─────
-- Restore = UPDATE/INSERT back from these. Drop them once the result is checked.

CREATE TABLE IF NOT EXISTS _bak_merge_20260930_jobs AS
  SELECT * FROM jobs
   WHERE company_id IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                        'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 87 rows (brisbane-smr 35, hongkong-00700 4, beijing-00992 21, hongkong-01810 21,
--                  hongkong-02628 2, sydney-clw 3, sydney-cqr 1)

-- The 7 Lenovo primary rows that absorb the retired duplicates' first/last_seen.
CREATE TABLE IF NOT EXISTS _bak_merge_20260930_jobs_primary AS
  SELECT * FROM jobs WHERE company_id = 'hongkong-00992' AND source = 'simplyhired';
-- expect 7

CREATE TABLE IF NOT EXISTS _bak_merge_20260930_company_slugs AS
  SELECT * FROM company_slugs
   WHERE company_id IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                        'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 1 (brisbane-smr)

CREATE TABLE IF NOT EXISTS _bak_merge_20260930_flow_company_map AS
  SELECT * FROM flow_company_map
   WHERE company_id IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                        'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 1

CREATE TABLE IF NOT EXISTS _bak_merge_20260930_flows AS
  SELECT * FROM flows
   WHERE from_id IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                     'hongkong-02628','sydney-clw','sydney-cqr')
      OR to_id   IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                     'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 74 (35 from + 39 to; no row has both ends retired)

CREATE TABLE IF NOT EXISTS _bak_merge_20260930_flow_months AS
  SELECT * FROM flow_months
   WHERE from_id IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                     'hongkong-02628','sydney-clw','sydney-cqr')
      OR to_id   IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                     'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 16

CREATE TABLE IF NOT EXISTS _bak_merge_20260930_user_follow AS
  SELECT * FROM user_follow
   WHERE kind = 'company'
     AND ref IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                 'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 0

CREATE TABLE IF NOT EXISTS _bak_merge_20260930_views AS
  SELECT * FROM views
   WHERE kind = 'company'
     AND ref IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                 'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 0


-- ── 1. jobs: rows that are NOT the company they were filed under ────────────
-- Moving these would put another employer's ads on the kept card. They are
-- UNATTRIBUTED (company_id -> NULL), not deleted: they are real ads and still
-- count in market-wide totals, just on no company's card — which is where the
-- aggregators' non-roster rows already live. company_id is never rewritten on
-- conflict (jobArchive.ts), so they stay unattributed on later sightings.

-- brisbane-smr: 2 Adzuna rows advertised by Norton Rose Fulbright ("Associate -
-- M&A"), a law firm; the company-scoped Adzuna pull for "Stanmore Resources"
-- returned them because the ad text named the client. last_seen 2026-09-01.
UPDATE jobs SET company_id = NULL
 WHERE company_id = 'brisbane-smr' AND source = 'adzuna' AND company = 'Norton Rose Fulbright';
-- expect 2

-- hongkong-02628: its only 2 rows are Zhaopin ads from Wolters Kluwer China and
-- Eisai China (pharma sales, Jinan) — not China Life. last_seen 2026-07-25.
UPDATE jobs SET company_id = NULL
 WHERE company_id = 'hongkong-02628' AND source = 'zhaopin'
   AND (company = 'Wolters Kluwer China' OR company LIKE '%Eisai China%');
-- expect 2


-- ── 2. jobs: exact duplicates — DELETE the retired copy ─────────────────────
-- beijing-00992 carries 7 SimplyHired rows that are the SAME ads as 7 on
-- hongkong-00992: identical source, title, location and ad URL. They differ in
-- job_key only because SimplyHired's key uses the roster NAME as the company
-- ("Lenovo" on the Beijing line, "Lenovo Group" on the Hong Kong one), so both
-- lines searched the board and each archived the same ads. Re-pointing them
-- would leave the kept card counting every one of those ads twice.
--
-- First fold the retired copy's dates into the kept row so no sighting is lost
-- (today they are identical — the fold is a no-op kept for safety on re-run),
-- then delete the retired copy. Matching is on (source, url) with url non-empty.
UPDATE jobs AS p
   SET first_seen = MIN(p.first_seen, s.first_seen),
       last_seen  = MAX(p.last_seen,  s.last_seen)
  FROM jobs AS s
 WHERE s.company_id = 'beijing-00992'
   AND p.company_id = 'hongkong-00992'
   AND s.source = p.source
   AND s.url = p.url AND s.url <> '';
-- expect 7 rows matched (0 values actually change today)

DELETE FROM jobs
 WHERE company_id = 'beijing-00992'
   AND url <> ''
   AND EXISTS (SELECT 1 FROM jobs p
                WHERE p.company_id = 'hongkong-00992'
                  AND p.source = jobs.source
                  AND p.url = jobs.url);
-- expect 7 (the SimplyHired rows; the 14 Zhaopin rows have no Hong Kong twin)

-- Generic guard for the other pairs, measured at 0 duplicates today (by url,
-- and by title+location). Kept so a re-run after the retired ids have written
-- again cannot create a double count.
DELETE FROM jobs
 WHERE company_id IN ('brisbane-smr','hongkong-00700','hongkong-01810','hongkong-02628',
                      'sydney-clw','sydney-cqr')
   AND url <> ''
   AND EXISTS (SELECT 1 FROM jobs p
                WHERE p.company_id = CASE jobs.company_id
                        WHEN 'brisbane-smr'   THEN 'smr'
                        WHEN 'hongkong-00700' THEN 'shenzhen-00700'
                        WHEN 'hongkong-01810' THEN 'beijing-01810'
                        WHEN 'hongkong-02628' THEN 'beijing-601628'
                        WHEN 'sydney-clw'     THEN 'sydney-chc'
                        WHEN 'sydney-cqr'     THEN 'sydney-chc' END
                  AND p.source = jobs.source
                  AND p.url = jobs.url);
-- expect 0


-- ── 3. jobs: re-point everything left ───────────────────────────────────────
UPDATE jobs SET company_id = 'smr'            WHERE company_id = 'brisbane-smr';    -- expect 33
UPDATE jobs SET company_id = 'shenzhen-00700' WHERE company_id = 'hongkong-00700';  -- expect 4
UPDATE jobs SET company_id = 'hongkong-00992' WHERE company_id = 'beijing-00992';   -- expect 14
UPDATE jobs SET company_id = 'beijing-01810'  WHERE company_id = 'hongkong-01810';  -- expect 21
UPDATE jobs SET company_id = 'beijing-601628' WHERE company_id = 'hongkong-02628';  -- expect 0 (both unattributed in §1)
UPDATE jobs SET company_id = 'sydney-chc'     WHERE company_id = 'sydney-clw';      -- expect 3
UPDATE jobs SET company_id = 'sydney-chc'     WHERE company_id = 'sydney-cqr';      -- expect 1


-- ── 4. company_slugs (PK company_id) ────────────────────────────────────────
-- smr already holds the identical row (stanmore-resources-limited, "Stanmore
-- Resources Limited", confirmed 2026-08-05). Copy only if the kept id lacks
-- one, then delete the retired row. Leaving it would let
-- resolve-linkedin-company-ids.py and gen-linkedin-logos.py (which read this
-- table) re-create a brisbane-smr entry on their next run.
INSERT INTO company_slugs (company_id, slug, actor, confirmed)
  SELECT CASE company_id
           WHEN 'brisbane-smr'   THEN 'smr'
           WHEN 'hongkong-00700' THEN 'shenzhen-00700'
           WHEN 'beijing-00992'  THEN 'hongkong-00992'
           WHEN 'hongkong-01810' THEN 'beijing-01810'
           WHEN 'hongkong-02628' THEN 'beijing-601628'
           WHEN 'sydney-clw'     THEN 'sydney-chc'
           WHEN 'sydney-cqr'     THEN 'sydney-chc' END,
         slug, actor, confirmed
    FROM company_slugs
   WHERE company_id IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                        'hongkong-02628','sydney-clw','sydney-cqr')
ON CONFLICT(company_id) DO NOTHING;
-- expect 0 inserted (smr already has it)

DELETE FROM company_slugs
 WHERE company_id IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                      'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 1


-- ── 5. talent flows ─────────────────────────────────────────────────────────
-- flow_company_map (PK ref): the decision "li:stanmore-resources-limited is
-- ours" is kept and re-pointed, so a future flows-to-d1.py import files
-- Stanmore's moves on smr.
UPDATE flow_company_map SET company_id = 'smr'            WHERE company_id = 'brisbane-smr';    -- expect 1
UPDATE flow_company_map SET company_id = 'shenzhen-00700' WHERE company_id = 'hongkong-00700';  -- expect 0
UPDATE flow_company_map SET company_id = 'hongkong-00992' WHERE company_id = 'beijing-00992';   -- expect 0
UPDATE flow_company_map SET company_id = 'beijing-01810'  WHERE company_id = 'hongkong-01810';  -- expect 0
UPDATE flow_company_map SET company_id = 'beijing-601628' WHERE company_id = 'hongkong-02628';  -- expect 0
UPDATE flow_company_map SET company_id = 'sydney-chc'     WHERE company_id IN ('sydney-clw','sydney-cqr'); -- expect 0

-- flows / flow_months: ids are not in the PKs, so re-pointing cannot collide.
-- Measured: no row has smr at the other end, so no self-move (smr -> smr) is
-- created. 9 brightdata imports of 2026-09-25 carry them.
UPDATE flows SET from_id = 'smr' WHERE from_id = 'brisbane-smr';   -- expect 35
UPDATE flows SET to_id   = 'smr' WHERE to_id   = 'brisbane-smr';   -- expect 39
UPDATE flow_months SET from_id = 'smr' WHERE from_id = 'brisbane-smr';  -- expect 8
UPDATE flow_months SET to_id   = 'smr' WHERE to_id   = 'brisbane-smr';  -- expect 8
-- flow_skills, flow_sample, flow_skill_sample, flow_collect_seed: 0 rows for any
-- retired id (measured); included for a re-run.
UPDATE flow_skills SET from_id = 'smr' WHERE from_id = 'brisbane-smr';  -- expect 0
UPDATE flow_skills SET to_id   = 'smr' WHERE to_id   = 'brisbane-smr';  -- expect 0
UPDATE flow_sample       SET company_id = 'smr' WHERE company_id = 'brisbane-smr';  -- expect 0
UPDATE flow_skill_sample SET company_id = 'smr' WHERE company_id = 'brisbane-smr';  -- expect 0
UPDATE flow_collect_seed SET company_id = 'smr' WHERE company_id = 'brisbane-smr';  -- expect 0


-- ── 6. follows and views (PK includes the id) — 0 rows today ────────────────
-- A follow held under BOTH ids by one user would collide on (user_id, kind,
-- ref); INSERT OR IGNORE + DELETE collapses it to one follow of the kept id.
INSERT OR IGNORE INTO user_follow (user_id, kind, ref, created)
  SELECT user_id, kind,
         CASE ref WHEN 'brisbane-smr'   THEN 'smr'
                  WHEN 'hongkong-00700' THEN 'shenzhen-00700'
                  WHEN 'beijing-00992'  THEN 'hongkong-00992'
                  WHEN 'hongkong-01810' THEN 'beijing-01810'
                  WHEN 'hongkong-02628' THEN 'beijing-601628'
                  WHEN 'sydney-clw'     THEN 'sydney-chc'
                  WHEN 'sydney-cqr'     THEN 'sydney-chc' END,
         created
    FROM user_follow
   WHERE kind = 'company'
     AND ref IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                 'hongkong-02628','sydney-clw','sydney-cqr');
DELETE FROM user_follow
 WHERE kind = 'company'
   AND ref IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
               'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 0 / 0

-- views: add the retired id's count onto the kept row, then drop the retired row.
INSERT INTO views (kind, ref, label, sub, count, last_viewed)
  SELECT kind,
         CASE ref WHEN 'brisbane-smr'   THEN 'smr'
                  WHEN 'hongkong-00700' THEN 'shenzhen-00700'
                  WHEN 'beijing-00992'  THEN 'hongkong-00992'
                  WHEN 'hongkong-01810' THEN 'beijing-01810'
                  WHEN 'hongkong-02628' THEN 'beijing-601628'
                  WHEN 'sydney-clw'     THEN 'sydney-chc'
                  WHEN 'sydney-cqr'     THEN 'sydney-chc' END AS nref,
         NULL, NULL, SUM(count), MAX(last_viewed)
    FROM views
   WHERE kind = 'company'
     AND ref IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
                 'hongkong-02628','sydney-clw','sydney-cqr')
   GROUP BY kind, nref
ON CONFLICT(kind, ref) DO UPDATE SET
   count = count + excluded.count,
   last_viewed = MAX(COALESCE(last_viewed, ''), COALESCE(excluded.last_viewed, ''));
DELETE FROM views
 WHERE kind = 'company'
   AND ref IN ('brisbane-smr','hongkong-00700','beijing-00992','hongkong-01810',
               'hongkong-02628','sydney-clw','sydney-cqr');
-- expect 0 / 0

-- NOT TOUCHED, on purpose:
--   app_event      analytics log; 0 rows name a retired id (measured), and a log
--                  records what happened, so it is not rewritten either way.
--   company_posts  0 rows for any retired id (smr holds 10, unchanged).
--   market_interest keyed by place, not company.
--   KV (OPEN_ROLES_HISTORY) `jobs:<id>` / `roles:<id>`: not D1, see report.


-- ── 7. VERIFY — run after; every retired id must read 0 everywhere ─────────
SELECT 'jobs' t, company_id id, COUNT(*) n FROM jobs
 WHERE company_id IN ('smr','brisbane-smr','shenzhen-00700','hongkong-00700','hongkong-00992',
                      'beijing-00992','beijing-01810','hongkong-01810','beijing-601628',
                      'hongkong-02628','sydney-chc','sydney-clw','sydney-cqr')
 GROUP BY company_id
UNION ALL
SELECT 'jobs:unattributed-by-this-script', company, COUNT(*) FROM jobs
 WHERE job_key IN (SELECT job_key FROM _bak_merge_20260930_jobs) AND company_id IS NULL
 GROUP BY company
UNION ALL
SELECT 'company_slugs', company_id, COUNT(*) FROM company_slugs
 WHERE company_id IN ('smr','brisbane-smr') GROUP BY company_id
UNION ALL
SELECT 'flow_company_map', company_id, COUNT(*) FROM flow_company_map
 WHERE company_id IN ('smr','brisbane-smr') GROUP BY company_id
UNION ALL
SELECT 'flows.from_id', from_id, COUNT(*) FROM flows
 WHERE from_id IN ('smr','brisbane-smr') GROUP BY from_id
UNION ALL
SELECT 'flows.to_id', to_id, COUNT(*) FROM flows
 WHERE to_id IN ('smr','brisbane-smr') GROUP BY to_id
UNION ALL
SELECT 'flow_months.from_id', from_id, COUNT(*) FROM flow_months
 WHERE from_id IN ('smr','brisbane-smr') GROUP BY from_id
UNION ALL
SELECT 'flow_months.to_id', to_id, COUNT(*) FROM flow_months
 WHERE to_id IN ('smr','brisbane-smr') GROUP BY to_id
UNION ALL
SELECT 'user_follow', ref, COUNT(*) FROM user_follow
 WHERE kind = 'company' AND ref IN ('brisbane-smr','hongkong-00700','beijing-00992',
       'hongkong-01810','hongkong-02628','sydney-clw','sydney-cqr') GROUP BY ref
UNION ALL
SELECT 'views', ref, SUM(count) FROM views
 WHERE kind = 'company' AND ref IN ('hongkong-00992','brisbane-smr','hongkong-00700',
       'beijing-00992','hongkong-01810','hongkong-02628','sydney-clw','sydney-cqr') GROUP BY ref;
-- expected (see merge_dryrun.txt "AFTER"):
--   jobs smr 112 · shenzhen-00700 13 · hongkong-00992 66 · beijing-01810 76 ·
--   beijing-601628 14 · sydney-chc 100 · every retired id absent
--   unattributed-by-this-script: Norton Rose Fulbright 2, Wolters Kluwer China 1,
--   卫材（中国）药业有限公司  Eisai China Inc. 1
--   company_slugs smr 1 · flow_company_map smr 1 · flows.from_id smr 35 ·
--   flows.to_id smr 39 · flow_months smr 8 / 8 · user_follow none · views hongkong-00992 2
-- (jobs figures move with tonight's scrape; the retired ids reading 0 is the check.)

-- ── 8. CLEAN-UP, once verified ─────────────────────────────────────────────
-- DROP TABLE _bak_merge_20260930_jobs;
-- DROP TABLE _bak_merge_20260930_jobs_primary;
-- DROP TABLE _bak_merge_20260930_company_slugs;
-- DROP TABLE _bak_merge_20260930_flow_company_map;
-- DROP TABLE _bak_merge_20260930_flows;
-- DROP TABLE _bak_merge_20260930_flow_months;
-- DROP TABLE _bak_merge_20260930_user_follow;
-- DROP TABLE _bak_merge_20260930_views;
