-- The feedback board's design carries a one-or-two-line description under each
-- title: the composer asks "Describe the problem it solves", and the row shows
-- it beneath the heading. Nullable, because every request posted before this
-- column existed has a title and nothing else — those rows render title-only
-- rather than being backfilled with invented detail.
ALTER TABLE feedback ADD COLUMN body TEXT;
