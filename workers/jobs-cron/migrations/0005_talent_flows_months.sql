-- Talent flows BY MONTH: the rows of 0002's `flows` (and 0004's `flow_skills`)
-- split by the month each move's new job started, so the talent-flow card's
-- timeline can show any window inside the delivery instead of only the whole
-- of it. COUNTS ONLY, as in 0002-0004.
--
-- One table for both: `skill` is '' for the company-level rows and a
-- skillsTaxonomy.ts name for the per-skill rows. For every pair, the months
-- sum to that pair's row in `flows` (or `flow_skills`) for the same import;
-- scripts/flows-to-d1.py refuses a delivery where they do not.
--
-- Earlier months read lower for a reason that is not hiring: the sample is
-- people employed at a sampled company TODAY, so a move made by someone who
-- has since left every sampled company is never seen, and the further back
-- the month, the more of those there are (docs/talent-flows-plan.md, rule 11).
--
-- Written by scripts/flows-to-d1.py --write. Apply with:
--   npx wrangler d1 execute employsi-jobs-archive --remote \
--     --file=workers/jobs-cron/migrations/0005_talent_flows_months.sql

CREATE TABLE IF NOT EXISTS flow_months (
  import_id  TEXT NOT NULL,
  from_ref   TEXT NOT NULL,
  from_name  TEXT NOT NULL,
  to_ref     TEXT NOT NULL,
  to_name    TEXT NOT NULL,
  from_id    TEXT,
  to_id      TEXT,
  month      TEXT NOT NULL,          -- YYYY-MM the new job started
  skill      TEXT NOT NULL,          -- '' = all moves; else a skill name
  moves      REAL NOT NULL,
  count_kind TEXT NOT NULL,
  PRIMARY KEY (import_id, from_ref, to_ref, month, skill, count_kind)
);
CREATE INDEX IF NOT EXISTS idx_flow_months_to   ON flow_months (import_id, to_id, skill);
CREATE INDEX IF NOT EXISTS idx_flow_months_from ON flow_months (import_id, from_id, skill);
