-- Talent-flow COLLECTION state, so a Bright Data collection survives the
-- machine it runs on. Written by scripts/brightdata-talent-flows.py
-- --sync-d1; read back by --pull-d1 and --export --from-d1.
--
-- Separate from 0002's flows tables: those hold a finished, windowed import
-- the card reads; these hold the running totals it is exported from.
--
-- NO PERSON IS STORED HERE. No name, profile url, photo, title or employer
-- history of any individual. The only per-person value is flow_collect_seen,
-- an HMAC of Bright Data's profile id with nothing attached to it, kept so a
-- later run does not count the same profile twice. The HMAC salt is never
-- written to D1 (BRIGHTDATA_FLOWS_SALT in the environment), so a key cannot
-- be recomputed from a profile id by anyone holding this database.
--
-- Every count is written per sync batch with INSERT OR IGNORE, and totals
-- are SUMs over batches. A batch_id is derived from the profiles it covers,
-- so re-sending a batch that half-landed writes nothing twice.
--
-- Apply with:
--   npx wrangler d1 execute employsi-jobs-archive --remote \
--     --file=workers/jobs-cron/migrations/0003_talent_flows_collect.sql

-- One row per seed company: where the next run resumes. Latest write wins.
CREATE TABLE IF NOT EXISTS flow_collect_seed (
  seed_ref     TEXT PRIMARY KEY,   -- li:<slug>
  source       TEXT NOT NULL,      -- brightdata
  company_id   TEXT NOT NULL,      -- app company id
  slug         TEXT NOT NULL,
  total        INTEGER,            -- the source's total_hits when last asked
  search_after TEXT,               -- JSON cursor; does not survive a dataset refresh
  exhausted    INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);

-- Profiles already counted. The key and nothing else: deliberately no batch,
-- seed or date, so a key cannot be joined to the moves it contributed.
CREATE TABLE IF NOT EXISTS flow_collect_seen (
  person_key TEXT PRIMARY KEY      -- HMAC-SHA256(salt, profile id)[:32]
);

-- Per batch and seed: how many profiles were read and why some gave nothing.
CREATE TABLE IF NOT EXISTS flow_collect_batch (
  batch_id       TEXT NOT NULL,
  seed_ref       TEXT NOT NULL,
  source         TEXT NOT NULL,
  profiles_ok    INTEGER NOT NULL,
  profiles_empty INTEGER NOT NULL,
  refused        TEXT,             -- JSON {reason: entries}
  not_counted    TEXT,             -- JSON {reason: moves}
  year_only      INTEGER NOT NULL DEFAULT 0,  -- moves with no month; never exported
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (batch_id, seed_ref)
);

-- Company-to-company moves by month, summed within a batch. The names are
-- part of the key: one company is typed several ways across profiles, and
-- the export picks the commonest, so the spellings must be kept apart.
CREATE TABLE IF NOT EXISTS flow_collect_moves (
  batch_id  TEXT NOT NULL,
  source    TEXT NOT NULL,
  from_ref  TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_ref    TEXT NOT NULL,
  to_name   TEXT NOT NULL,
  month     TEXT NOT NULL,         -- YYYY-MM the new job started
  moves     INTEGER NOT NULL,
  PRIMARY KEY (batch_id, from_ref, from_name, to_ref, to_name, month)
);
CREATE INDEX IF NOT EXISTS idx_flow_collect_moves_to ON flow_collect_moves (to_ref, month);
