/**
 * ONE JOB'S IDENTITY, ACROSS EVERY BOARD THAT CARRIES IT.
 *
 * The archive stores one row per SOURCE: `job_key` is
 * `source|title|company|location` and source is the FIRST field, so a role
 * advertised on an employer's careers site and on a job board is two rows by
 * construction. That is deliberate and worth keeping — it is the honest record
 * of what each feed actually showed, and feed-health work (coverage, a board
 * going dark, LIVE_FEEDS_ONLY_SQL) reads it.
 *
 * But it means every COUNT of "roles" over those rows double-counts, once per
 * extra board. It was fixed surface by surface — the open-roles headline, the
 * vacancy chart, then per-company skill demand and the roles list — and each
 * time the next surface still had it, because the dedupe lived in whichever
 * reader had been looked at. Rio Tinto's "Adviser Global Payroll Systems ESPS"
 * showed as 2 ads with two identical tiles, the copies differing only in how
 * they spelled Perth.
 *
 * So the identity is defined ONCE, here, and written onto the row as
 * `role_key` at archive time. A count of roles is then
 * `COUNT(DISTINCT role_key)` — something a reader gets right by default
 * instead of by remembering, and something a SQL aggregate can do without
 * pulling every row into the Worker to fold it.
 *
 * THIS IS NOT A LOCATION PROBLEM, which is the intuitive diagnosis and the
 * wrong one. The two Rio Tinto rows differ in `source` before they differ in
 * anything else; spelling Perth identically would have left them two rows.
 * Location still matters here, but as part of the identity below rather than
 * as the cause.
 *
 * WHAT COUNTS AS ONE ROLE: one employer, one city, one normalised title.
 *
 *  - the CITY, not the location string. One employer advertising the same
 *    title across a dozen suburbs is recruiting for one role, which is the
 *    measurement behind the title fold already in use: 4,157 distinct
 *    company+title pairs occupied 9,629 rows, and CSL held 1,089 rows for 438
 *    real roles. Falling back to the raw location where a row has no hub keeps
 *    unplaced rows apart rather than collapsing a country into one role.
 *  - the COMPANY ID where there is one, else the name. Market-wide queries
 *    cover employers off the roster, which have no id; keying those on nothing
 *    would fold every untitled employer's roles together.
 *  - the TITLE, normalised exactly as normRoleTitle does — the fold the open
 *    roles headline and the vacancy chart already use, so every surface is
 *    answering in one unit.
 */

/**
 * Lowercase, collapse anything non-alphanumeric to single spaces, trim.
 *
 * THE CANONICAL DEFINITION. It lived in two files — `normRoleTitle` in
 * jobHistoryFn (the vacancy chart) and `normTitle` in openRolesFn (the
 * headline) — identical by hand, with a CI check asserting they stayed that
 * way. Both now re-export this one, so there is nothing left to drift.
 */
export function normRoleTitle(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The dedupe key for one role, as stored in `jobs.role_key`.
 *
 * Returns "" when there is no title to key on. A row with no title has no
 * identity to share with anything, and giving them all the same key would fold
 * every untitled row in a city into a single phantom role — so callers store
 * "" and count those rows individually (see the COALESCE in ROLE_COUNT_SQL).
 */
export function roleKey(
  companyId: string | null | undefined,
  company: string | null | undefined,
  hub: string | null | undefined,
  location: string | null | undefined,
  title: string | null | undefined,
): string {
  const t = normRoleTitle(title || "");
  if (!t) return "";
  const who = normRoleTitle(companyId || company || "");
  const where = normRoleTitle(hub || location || "");
  return `${who}|${where}|${t}`.slice(0, 300);
}

/**
 * Count roles, not rows, in SQL.
 *
 * The COALESCE is what makes this safe to deploy before every row has been
 * backfilled: a row whose `role_key` is still null or empty falls back to its
 * own `job_key`, which is unique per row, so it counts once — exactly the
 * behaviour the plain COUNT(*) had. Counts therefore move from "today's
 * numbers" to "deduped numbers" as the backfill lands, rather than breaking
 * in between.
 */
export const ROLE_COUNT_SQL = "COUNT(DISTINCT COALESCE(NULLIF(role_key, ''), job_key))";
