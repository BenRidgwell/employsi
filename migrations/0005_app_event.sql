-- Product events, for the admin console's Engagement tab.
--
-- WHY THIS TABLE EXISTS
-- The admin console's four engagement sections — leading indicators, retention
-- by signup cohort, lagging outcomes, time in app — cannot be derived from
-- anything the app already stores. The archive knows about vacancies; the auth
-- tables know when an account was created and when a session token was issued,
-- but a session token is minted once per sign-in and refreshed on a schedule,
-- so it answers "did they authenticate" rather than "did they come back and
-- use it". Nothing at all records a search, a company opened or how long
-- someone stayed. Those sections were shipped as static markup for exactly that
-- reason. This is the missing capture.
--
-- WHAT IS AND IS NOT STORED
-- One row per event. No IP address, no user agent, no free text, no URL. The
-- `detail` column is deliberately low-cardinality — a skill name, a city id, a
-- sector — never a search string, because a search box is where people type
-- things they would not want kept.
--
--   user_key   lower-cased account email, matching feedback.author_key and
--              market_interest.user_key so the three identify a person the same
--              way. Empty for a signed-out visitor.
--   anon_key   a random per-browser id for signed-out visitors, so "visitors"
--              and "signed-in users" can be counted separately without a
--              signed-out person becoming identifiable. Empty once signed in.
--   session_id one page session, so session length and events-per-session are
--              answerable. Not the auth session token.
--   at / day   stamped by the SERVER. A client clock can be wrong by years, and
--              every cohort and trend on the console is a date bucket, so a
--              browser-supplied timestamp would silently poison all of them.
--   ms         session_end only: how long the session lasted, in milliseconds.
--              0 everywhere else.
--
-- The day column is redundant with `at` and indexed on purpose: every query
-- behind the console groups by day or by week, and substr() on a timestamp
-- cannot use an index.
CREATE TABLE IF NOT EXISTS app_event (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key   TEXT NOT NULL DEFAULT '',
  anon_key   TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL,
  day        TEXT NOT NULL,
  ms         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_app_event_day ON app_event (day);
CREATE INDEX IF NOT EXISTS idx_app_event_name_day ON app_event (name, day);
CREATE INDEX IF NOT EXISTS idx_app_event_user_day ON app_event (user_key, day);
-- Retention joins each signed-in person's activity back to their signup week,
-- so "which days did this person appear on" is the hot path.
CREATE INDEX IF NOT EXISTS idx_app_event_user ON app_event (user_key, day, name);
