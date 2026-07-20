-- Historical job archive (Cloudflare D1). Append-only, deduped by job_key.
-- Apply with:
--   wrangler d1 execute employsi-jobs-archive --remote \
--     --file=workers/jobs-cron/migrations/0001_jobs_archive.sql

CREATE TABLE IF NOT EXISTS jobs (
  job_key    TEXT PRIMARY KEY,          -- source|title|company|location (stable)
  source     TEXT NOT NULL,             -- adzuna | muse | jooble
  title      TEXT NOT NULL,
  company    TEXT,                      -- employer name from the ad
  company_id TEXT,                      -- app company id (company-scoped pulls)
  hub        TEXT,                      -- matched city / hub key
  location   TEXT,                      -- raw location text
  category   TEXT,                      -- job category / posted-via platform
  salary     TEXT,                      -- when the source states one
  url        TEXT,                      -- apply / listing link
  posted     TEXT,                      -- the ad's own date (YYYY-MM-DD)
  skills     TEXT,                      -- JSON array of mapped skills
  first_seen TEXT NOT NULL,             -- YYYY-MM-DD first archived
  last_seen  TEXT NOT NULL,             -- YYYY-MM-DD most recent run seen
  seen_count INTEGER NOT NULL DEFAULT 1 -- number of runs it appeared in
);

CREATE INDEX IF NOT EXISTS idx_jobs_company_id ON jobs (company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_hub        ON jobs (hub);
CREATE INDEX IF NOT EXISTS idx_jobs_source     ON jobs (source);
CREATE INDEX IF NOT EXISTS idx_jobs_last_seen  ON jobs (last_seen);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs (first_seen);
