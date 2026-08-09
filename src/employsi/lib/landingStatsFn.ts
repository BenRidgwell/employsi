import { createServerFn } from "@tanstack/react-start";
import { callerRole } from "./sessionRole";
import { isReleasedRow, isReleasedCountry } from "./markets";
import type { D1Like } from "./jobArchive";
import { COMPANY_ID_ALIAS } from "./openRolesFn";
import { CITY_COUNTRY } from "../data/mapboxWorldGeo";

/**
 * The four counters on the public landing page, measured from the D1 job
 * archive.
 *
 * WHAT THIS REPLACED, AND WHY IT MATTERS
 * The landing page used to tween each figure between a pair of hard-coded
 * bounds — 55,800–56,200 vacancies, 1,480–1,520 employers — with a comment
 * saying they were placeholders to be wired to D1 before launch. Two of the
 * four happened to be true (6 released markets, 80 plotted cities) but they
 * were still constants, so the page asserted a measurement nobody had taken.
 * Every figure here now comes from rows.
 *
 * DEFINITIONS, because each of these has a plausible wrong reading:
 *
 *  • vacancies — DISTINCT ROLES, not archive rows. `job_key` is
 *    source|title|company|location, so one role advertised on three boards
 *    across five locations is fifteen rows. Counting rows would print a number
 *    that disagrees with the company card the visitor lands on next: the same
 *    dedupe (employer + normalised title) is what openRolesFn's "Open roles"
 *    and getVacancyTrend's chart already count, and the comment there measured
 *    rows overstating by 47% (5,873 rows for 4,006 real roles).
 *
 *  • employers — distinct employers with at least one live vacancy, across
 *    every source, not just the ones plotted on the map. See `employerKey`
 *    below for the one place this is approximate, and why.
 *
 *  • countries / cities — places the archive currently holds live vacancies
 *    FOR, not places the product draws. They are measured from the `hub`
 *    column rather than from RELEASED_MARKETS/CITY_COUNTRY, so a released
 *    market whose feed has gone dark stops being counted instead of being
 *    asserted from a constant. That is the whole point of moving them off
 *    hard-coded values.
 *
 * "Live" is `last_seen >= yesterday` — the same boundary the rest of the app
 * calls "currently advertised". Yesterday rather than today because the
 * scrapers run overnight and a feed that has not reported yet today has not
 * closed its ads (the same reasoning getVacancyTrend's series ends on).
 */
export interface LandingStats {
  /** Distinct live roles across every released market. */
  vacancies: number;
  /** Distinct employers advertising at least one of them. */
  employers: number;
  /** Released countries with live vacancies in the archive. */
  countries: number;
  /** Plotted cities with live vacancies in the archive. */
  cities: number;
  /** The UTC day these counts were measured on (YYYY-MM-DD). */
  asAt: string;
}

async function getArchiveDb(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

const day = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

/** Same normalisation openRolesFn dedupes titles with, so the counts agree. */
const norm = (s: string): string =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Hub values that name a COUNTRY rather than a city.
 *
 * markets.ts records that ~1,100 rows carry "Australia" as their hub alongside
 * the city ids. Such a row evidences the country but not any particular city,
 * so it counts toward `countries` and toward nothing else — inferring a city
 * from it would be inventing a location the row does not carry.
 */
const COUNTRY_HUB: Record<string, string> = { australia: "au" };

/**
 * THE APPROXIMATE ONE, stated plainly rather than hidden.
 *
 * Rows from the career portals carry a canonical `company_id`, so every BHP
 * feed collapses to one employer. Rows from the aggregators (Adzuna, Jooble,
 * Muse) carry only the employer name as the ad spelled it, and two boards
 * spelling one employer differently — "BHP" and "BHP Group Limited" — count as
 * two. The count is therefore an upper bound on distinct employers, and drifts
 * upward with the aggregators' share of the archive.
 *
 * It is left approximate rather than fixed with fuzzy name matching because a
 * matcher that merges "Ramsay Health Care" into "Ramsay" would also merge
 * genuinely distinct employers, and an over-merge is invisible where an
 * over-count is at least honest about its direction.
 */
function employerKey(cid: string, cname: string): string | null {
  const id = cid.trim();
  if (id) return COMPANY_ID_ALIAS[id] ?? id;
  const n = norm(cname);
  return n || null;
}

/**
 * The archive only moves when the nightly cron runs, so re-scanning it for
 * every visitor to a public marketing page would be pure waste. Worker isolates
 * are reused between requests, so a module-level memo serves most of them for
 * free; a cold isolate pays for one scan. `asAt` travels with the value, so a
 * cached figure still says which day it describes.
 */
let memo: { at: number; role: string; value: LandingStats } | null = null;
const MEMO_MS = 6 * 60 * 60 * 1000;

export const getLandingStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingStats | null> => {
    const db = await getArchiveDb();
    if (!db) return null;
    // Roll the figures up over the markets this caller can actually see — the
    // same gate the ticker applies, and for the same reason: a headline count
    // must not carry vacancies from countries the product has not released.
    const role = (await callerRole()) === "admin" ? "admin" : "user";
    if (memo && memo.role === role && Date.now() - memo.at < MEMO_MS) return memo.value;
    const seesAll = role === "admin";
    const from = day(1);
    try {
      // Grouped in SQL purely to shrink the payload: the dedupe that decides
      // the vacancy count is the JS `norm` below, since SQLite's LOWER/TRIM
      // cannot collapse punctuation the way normTitle does.
      const res = await db
        .prepare(
          `SELECT LOWER(TRIM(COALESCE(hub, ''))) AS hub,
                  COALESCE(company_id, '') AS cid,
                  LOWER(TRIM(COALESCE(company, ''))) AS cname,
                  LOWER(TRIM(title)) AS title
             FROM jobs
            WHERE last_seen >= ?1 AND title IS NOT NULL AND TRIM(title) <> ''
            GROUP BY hub, cid, cname, title`,
        )
        .bind(from)
        .all();
      const rows = res?.results ?? [];
      const roles = new Set<string>();
      const employers = new Set<string>();
      const cities = new Set<string>();
      const countries = new Set<string>();
      for (const r of rows) {
        const hub = String(r.hub || "").trim();
        const cid = String(r.cid || "");
        const cname = String(r.cname || "");
        if (!seesAll && !isReleasedRow(hub, cid)) continue;
        const emp = employerKey(cid, cname);
        const t = norm(String(r.title || ""));
        // A role needs an employer to be distinct FROM: without one, "Engineer"
        // at two unrelated companies would collapse into a single vacancy.
        if (emp && t) {
          roles.add(`${emp}|${t}`);
          employers.add(emp);
        }
        const h = hub.toLowerCase();
        const cc = CITY_COUNTRY[h];
        if (cc) {
          // A plotted city. Gated on its country so an unreleased market's
          // hub cannot leak into a public visitor's count.
          if (seesAll || isReleasedCountry(cc)) {
            cities.add(h);
            countries.add(cc);
          }
        } else if (COUNTRY_HUB[h] && (seesAll || isReleasedCountry(COUNTRY_HUB[h]))) {
          countries.add(COUNTRY_HUB[h]);
        }
      }
      // A genuine zero is returned as zero rather than suppressed. If the
      // pipeline breaks the page should read 0, not quietly keep printing the
      // last plausible-looking number — the failure is supposed to be visible.
      // `null` is reserved for "could not read the archive at all", which is a
      // different statement and is what the UI suppresses on.
      const value: LandingStats = {
        vacancies: roles.size,
        employers: employers.size,
        countries: countries.size,
        cities: cities.size,
        asAt: day(0),
      };
      // Shown, but never CACHED. An empty read is far more likely to be a
      // transient D1 failure than a day on which the entire market advertised
      // nothing, and memoising it would hold a wrong zero on the page for six
      // hours after the archive recovered. Re-reading an empty result is cheap
      // by definition.
      if (value.vacancies > 0) memo = { at: Date.now(), role, value };
      return value;
    } catch {
      return null;
    }
  },
);
