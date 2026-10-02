-- ════════════════════════════════════════════════════════════════════════════
-- Employsi D1 (employsi-jobs-archive, 1c5f3ffb-…) — retire the Hong Kong
-- Meituan roster line into the Beijing one.
--                      Prepared and RUN 2026-10-02 06:2x UTC, after the code
--                      that stops the Zhaopin feed writing the retired id was
--                      merged. Verified: the backup holds 41 rows,
--                      hongkong-03690 reads 0, and beijing-03690 reads 2,546 —
--                      2,505 + 41, as predicted. The backup table is still
--                      there; section 3 drops it.
--
--   retired id        -> kept id         company
--   hongkong-03690    -> beijing-03690   Meituan
--
-- WHY. HKEX 03690 is Meituan's only listing, and the roster carried that one
-- listing as two lines: a Beijing card (head office, and the id wired to the
-- zhaopin.meituan.com feed — 2,420 rows) and a Hong Kong card. This is the
-- same case as Tencent, Xiaomi and China Life, which went on 2026-09-30; this
-- one was missed. Same map as src/employsi/data/mergedCompanies.ts.
--
-- WHY NOT AN ALIAS. `COMPANY_ID_ALIAS` would have the Hong Kong card READ the
-- Beijing rows, which is right for HSBC, Rio Tinto and Chevron, where both
-- lines stay on the roster. It is wrong here, because the Hong Kong line has
-- 41 Zhaopin rows of its OWN and not one of them is a duplicate of the Beijing
-- line's 85 — measured 2026-10-02, zero shared url and zero shared
-- title+location. An alias leaves those 41 under a card nothing draws. They
-- are re-pointed instead.
--
-- NOTHING ELSE HOLDS THE ID. Measured 2026-10-02: company_slugs 0,
-- flow_company_map 0, flows 0, flow_months 0, user_follow 0, views 0. Only
-- `jobs`, and company_id is not part of job_key (source|title|company|
-- location), so re-pointing cannot collide.
--
-- DEPLOY THE CODE FIRST so the Zhaopin feed stops writing the retired id:
-- data/chinaJobsTargets.ts no longer lists it. This script is idempotent, so a
-- re-run after the next nightly sweeps anything written in between.
--
-- Run it with
--   npx wrangler d1 execute employsi-jobs-archive --remote \
--     --file scripts/migrations/2026-10-02-retire-meituan-hongkong-line.sql
-- (One statement per section. The duplicate-id merge of 2026-09-30 had to be
-- split because the whole file in one batch answered {"D1_RESET_DO":true};
-- this one is three statements and goes through as a file.)
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0. BACKUP — the rows this script will move, before it moves them ───────
-- Restore = UPDATE jobs SET company_id = 'hongkong-03690'
--            WHERE job_key IN (SELECT job_key FROM _bak_meituan_20261002_jobs);
-- Drop it once the result is checked.

CREATE TABLE IF NOT EXISTS _bak_meituan_20261002_jobs AS
  SELECT * FROM jobs WHERE company_id = 'hongkong-03690';

-- Expect 41.
SELECT COUNT(*) AS backed_up FROM _bak_meituan_20261002_jobs;


-- ── 1. Re-point them ───────────────────────────────────────────────────────
UPDATE jobs SET company_id = 'beijing-03690' WHERE company_id = 'hongkong-03690';  -- expect 41


-- ── 2. CHECK ───────────────────────────────────────────────────────────────
-- Expect retired 0, and kept 2,546 = 2,505 + 41 (it moves with the nightly).
SELECT (SELECT COUNT(*) FROM jobs WHERE company_id = 'hongkong-03690') AS retired_left,
       (SELECT COUNT(*) FROM jobs WHERE company_id = 'beijing-03690')  AS kept_now;


-- ── 3. CLEAN-UP, once verified ─────────────────────────────────────────────
-- DROP TABLE _bak_meituan_20261002_jobs;
