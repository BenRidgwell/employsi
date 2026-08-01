-- Who asked to be told when an unreleased market goes live.
--
-- The coming-soon card's "Notify me when it's live" writes here. It is a real
-- list, not a decorative button: when a market is released the rows for that
-- place are who to contact. Keyed on (user_key, place) so asking twice is
-- idempotent rather than duplicating a person.
--
-- user_key is the lower-cased account email, matching feedback.author_key, so
-- the two tables identify the same person the same way.
CREATE TABLE IF NOT EXISTS market_interest (
  user_key TEXT NOT NULL,
  place    TEXT NOT NULL,
  label    TEXT NOT NULL DEFAULT '',
  created  TEXT NOT NULL,
  PRIMARY KEY (user_key, place)
);
CREATE INDEX IF NOT EXISTS idx_market_interest_place ON market_interest (place);
