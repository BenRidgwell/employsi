-- Company-to-company talent flows. COUNTS ONLY: no person, no profile, no
-- per-person date is ever stored here. See docs/talent-flows-plan.md.
-- Written by scripts/flows-to-d1.py from the canonical interchange format.
-- Apply with:
--   wrangler d1 execute employsi-jobs-archive --remote \
--     --file=workers/jobs-cron/migrations/0002_talent_flows.sql

-- One row per file loaded. How the numbers were measured lives here, so no
-- flow row can be read without its method.
CREATE TABLE IF NOT EXISTS flow_import (
  import_id     TEXT PRIMARY KEY,  -- source|delivered|sha256(flows.csv)[:12]
  source        TEXT NOT NULL,     -- revelio | lti | linkedin-sample | ...
  product       TEXT,
  delivered     TEXT NOT NULL,     -- YYYY-MM-DD, the delivery's own date
  loaded_at     TEXT NOT NULL,
  method        TEXT NOT NULL,     -- shown verbatim under the numbers
  scope         TEXT NOT NULL,     -- all pairs | base company | sampled profiles
  base_ref      TEXT,              -- set when scope = base company
  top_n         INTEGER,           -- set when the vendor truncated the list
  filters       TEXT,              -- JSON, as delivered
  notes         TEXT,
  superseded_by TEXT               -- a newer delivery of the same source replaces this one
);

-- The counts. from_id/to_id are NULL when the vendor company is not on the
-- roster; those rows still count toward "moves to companies not on the map".
CREATE TABLE IF NOT EXISTS flows (
  import_id     TEXT NOT NULL,
  from_ref      TEXT NOT NULL,
  from_name     TEXT NOT NULL,
  to_ref        TEXT NOT NULL,
  to_name       TEXT NOT NULL,
  from_id       TEXT,              -- app company id (same id as jobs.company_id)
  to_id         TEXT,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  moves         REAL NOT NULL,
  count_kind    TEXT NOT NULL,     -- observed | weighted | nowcast | sampled
  PRIMARY KEY (import_id, from_ref, to_ref, period_start, count_kind)
);
CREATE INDEX IF NOT EXISTS idx_flows_from ON flows (from_id);
CREATE INDEX IF NOT EXISTS idx_flows_to   ON flows (to_id);

-- For a SAMPLED source, how many profiles each company's numbers rest on, so
-- the card can say "N moves among M profiles" instead of implying a
-- workforce total. Empty for sources that are not samples.
CREATE TABLE IF NOT EXISTS flow_sample (
  import_id  TEXT NOT NULL,
  ref        TEXT NOT NULL,
  company_id TEXT,
  profiles   INTEGER NOT NULL,
  PRIMARY KEY (import_id, ref)
);

-- Vendor company -> app company. Separate so a matching fix is one row, not
-- a reload. company_id NULL = confirmed NOT on the roster.
CREATE TABLE IF NOT EXISTS flow_company_map (
  ref        TEXT PRIMARY KEY,     -- revelio:<rcid> | lti:<name> | li:<slug> | name:<name>
  company_id TEXT,
  method     TEXT NOT NULL,        -- linkedin-slug | exact-name | manual
  checked_at TEXT NOT NULL
);
