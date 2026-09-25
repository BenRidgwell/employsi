-- Talent flows BY SKILL: the company-to-company counts of 0002/0003 split by
-- the skill of the job each move went into, so the talent-flow view can
-- answer "where does BHP hire Geology from". COUNTS ONLY, as in 0002/0003.
--
-- A move's skills come from the TITLE of the job it went into, matched by the
-- app's own skillsForText (scripts/skills-for-titles.ts). The title is read
-- on the collecting machine and discarded; only the skill name is kept, here
-- or anywhere. A title can match several skills, so skill counts do not sum
-- to the company counts, and a title that matches none adds nothing here.
--
-- Written by scripts/brightdata-talent-flows.py --sync-d1 (collection) and
-- scripts/flows-to-d1.py --write (the app's import). Apply with:
--   npx wrangler d1 execute employsi-jobs-archive --remote \
--     --file=workers/jobs-cron/migrations/0004_talent_flows_skills.sql

-- Collection: skill counts by month, summed per sync batch (as flow_collect_moves).
CREATE TABLE IF NOT EXISTS flow_collect_skill_moves (
  batch_id  TEXT NOT NULL,
  source    TEXT NOT NULL,
  from_ref  TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_ref    TEXT NOT NULL,
  to_name   TEXT NOT NULL,
  month     TEXT NOT NULL,         -- YYYY-MM the new job started
  skill     TEXT NOT NULL,         -- a skillsTaxonomy.ts skill name
  moves     INTEGER NOT NULL,
  PRIMARY KEY (batch_id, from_ref, from_name, to_ref, to_name, month, skill)
);

-- Collection: per batch and seed, how many profiles the skill counts rest on.
-- Separate from flow_collect_batch because skills were recorded by a second
-- pass over profiles already counted, so the two samples differ until it ends.
CREATE TABLE IF NOT EXISTS flow_collect_skill_batch (
  batch_id       TEXT NOT NULL,
  seed_ref       TEXT NOT NULL,
  source         TEXT NOT NULL,
  profiles_ok    INTEGER NOT NULL,
  profiles_empty INTEGER NOT NULL,
  synced_at      TEXT NOT NULL,
  PRIMARY KEY (batch_id, seed_ref)
);

-- Collection: profiles whose skills are counted. The key and nothing else,
-- as flow_collect_seen.
CREATE TABLE IF NOT EXISTS flow_collect_skill_seen (
  person_key TEXT PRIMARY KEY
);

-- The app's import: 0002's `flows` with a skill. Same import_id as the
-- company rows it was exported with, so one delivery is read as one.
CREATE TABLE IF NOT EXISTS flow_skills (
  import_id    TEXT NOT NULL,
  from_ref     TEXT NOT NULL,
  from_name    TEXT NOT NULL,
  to_ref       TEXT NOT NULL,
  to_name      TEXT NOT NULL,
  from_id      TEXT,
  to_id        TEXT,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  skill        TEXT NOT NULL,
  moves        REAL NOT NULL,
  count_kind   TEXT NOT NULL,
  PRIMARY KEY (import_id, from_ref, to_ref, period_start, skill, count_kind)
);
CREATE INDEX IF NOT EXISTS idx_flow_skills_to   ON flow_skills (to_id, skill);
CREATE INDEX IF NOT EXISTS idx_flow_skills_from ON flow_skills (from_id, skill);

-- The app's import: how many profiles each company's SKILL numbers rest on
-- (flow_sample holds the company-level figure).
CREATE TABLE IF NOT EXISTS flow_skill_sample (
  import_id  TEXT NOT NULL,
  ref        TEXT NOT NULL,
  company_id TEXT,
  profiles   INTEGER NOT NULL,
  PRIMARY KEY (import_id, ref)
);
