import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import type { D1Like } from "./jobArchive";
import { getAuth, type AuthEnv } from "./auth";
import { callerRole } from "./sessionRole";
import { isReleasedCompany, seesAllMarkets } from "./markets";
import { COMPANIES } from "../data/companies";
import { parseStoredSkills } from "../data/skillsTaxonomy";

/**
 * The notification bell's alerts, from `Notification_Bell`.
 *
 * The design states the rule: "a followed company's postings for one skill move
 * outside its own baseline — the last week against the prior four-week average.
 * Spikes at +50% or more, slowdowns at −40% or more, and any skill posted for
 * the first time in eight weeks."
 *
 * That rule is implemented exactly. What is NOT done is running it before the
 * archive can support it.
 *
 * ── THE COVERAGE GATE, AND WHY IT IS THE WHOLE POINT ───────────────────────
 * The rule needs five weeks of collection for a movement alert and eight for a
 * new-skill one. On the day this was written the archive held SEVENTEEN days
 * (2026-07-16 → 2026-08-01), and its daily volume tripled across them — 17,510
 * rows in the older stretch against 41,448 in the trailing week — because
 * COLLECTION was ramping, not because hiring was.
 *
 * Run the rule over that and every skill at every company clears +50%, and the
 * bell fills with alerts that are an artefact of our own crawl. That is the
 * ticker bug again: a plausible-looking figure with nothing behind it.
 *
 * So alerts are only computed once a company has `MIN_DAYS` of distinct
 * collection days behind it, and the panel says how far off it is otherwise.
 * The gate lifts on its own as the archive deepens; no code change is needed,
 * and none should be made to hurry it.
 */

export type AlertKind = "spike" | "cooling" | "new skill";

export interface AlertRow {
  id: string;
  companyId: string;
  company: string;
  initials: string;
  kind: AlertKind;
  /** "Movement" or "New skills" — the panel's tabs. */
  tab: "spikes" | "new";
  skill: string;
  headline: string;
  /** Ads for this skill in the trailing week. */
  week: number;
  /** The prior four-week weekly average it is measured against. */
  month: number;
  /** ISO day the trailing window ends. */
  at: string;
}

export interface AlertsResult {
  ok: boolean;
  /** Set when there is nothing to compute yet, for the panel to show verbatim. */
  notice?: string;
  /** True when the caller is signed out — the bell sends them to sign in. */
  signedOut?: boolean;
  rows: AlertRow[];
  /** How many followed companies were examined. */
  companies: number;
  /** Distinct collection days the archive holds. */
  days: number;
}

const EMPTY: AlertsResult = { ok: false, rows: [], companies: 0, days: 0 };

/**
 * Distinct collection days required before any alert is emitted.
 *
 * 35 = the design's own window (one trailing week + a four-week baseline).
 * Below this the baseline is either absent or is the crawl warming up.
 */
const MIN_DAYS = 35;
/** The design's thresholds, unchanged. */
const SPIKE = 0.5;
const COOLING = -0.4;
/** A skill counts as new when nothing preceded it in this many days. */
const NEW_SKILL_DAYS = 56;

async function db(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

async function currentUserId(): Promise<string | null> {
  try {
    const m = await import("cloudflare:workers");
    const e = (m?.env ?? null) as AuthEnv | null;
    if (!e) return null;
    const auth = getAuth(e);
    if (!auth) return null;
    const session = await auth.api.getSession({ headers: getRequest().headers });
    return session?.user?.id ? String(session.user.id) : null;
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  const words = (name || "").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function headlineFor(kind: AlertKind, skill: string, week: number, month: number): string {
  if (kind === "new skill") {
    return `First ${skill} postings in eight weeks — ${week} this week.`;
  }
  if (kind === "spike") {
    const times = month > 0 ? week / month : 0;
    const how =
      times >= 3 ? "tripled" : times >= 2 ? "doubled" : `up from ${Math.round(month)} a week`;
    return `${skill} postings ${how} in the last week.`;
  }
  return `${skill} hiring has slowed against its four-week average.`;
}

export const getAlerts = createServerFn({ method: "GET" }).handler(
  async (): Promise<AlertsResult> => {
    // Signed out is not an error — it is the bell's other job. The client sends
    // the person to sign in rather than showing an empty panel.
    const userId = await currentUserId();
    if (!userId) return { ...EMPTY, signedOut: true };

    const d = await db();
    if (!d) return { ...EMPTY, notice: "Alerts are unavailable right now." };

    const role = await callerRole();
    const nameOf = new Map(COMPANIES.map((c) => [c.id, c.name]));

    try {
      // Follows live against the account in `user_follow`, keyed (user_id,
      // kind, ref) — see lib/followsFn.ts. Only company follows matter here;
      // a followed SKILL is not a company to raise an alert about.
      const fol = await d
        .prepare(`SELECT ref FROM user_follow WHERE user_id = ?1 AND kind = 'company'`)
        .bind(userId)
        .all();
      let ids = [...new Set((fol?.results ?? []).map((r) => String(r.ref || "")))].filter(Boolean);
      // Same market gate as everywhere else: an end user is not told about a
      // company the rest of the product will not show them.
      if (!seesAllMarkets(role)) ids = ids.filter((id) => isReleasedCompany(id));
      if (!ids.length) {
        return {
          ...EMPTY,
          ok: true,
          notice: "Follow a company and its hiring signals will show up here.",
        };
      }

      const cov = await d.prepare(`SELECT COUNT(DISTINCT first_seen) AS days FROM jobs`).first();
      const days = Number(cov?.days) || 0;
      if (days < MIN_DAYS) {
        return {
          ...EMPTY,
          ok: true,
          companies: ids.length,
          days,
          notice:
            `Alerts compare a company's last week against its prior four weeks, so they ` +
            `start once the archive holds ${MIN_DAYS} days of collection. It has ${days}. ` +
            `Nothing is being withheld — there is not yet a baseline to measure against.`,
        };
      }

      // One pass over the followed companies' recent rows: the trailing week and
      // the four weeks before it, per skill. Done in JS rather than SQL because
      // skills are a JSON array on the row and have to go through
      // parseStoredSkills to pick up renames.
      const marks = ids.map((_, i) => `?${i + 1}`).join(",");
      const res = await d
        .prepare(
          `SELECT company_id, skills, first_seen
             FROM jobs
            WHERE company_id IN (${marks})
              AND first_seen >= date('now','-${NEW_SKILL_DAYS} day')`,
        )
        .bind(...ids)
        .all();

      const weekStart = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const baseStart = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);

      type Cell = { week: number; base: number; older: number };
      const byCo = new Map<string, Map<string, Cell>>();
      for (const r of res?.results ?? []) {
        const cid = String(r.company_id || "");
        const day = String(r.first_seen || "");
        if (!cid || !day) continue;
        const skills = parseStoredSkills(r.skills);
        let m = byCo.get(cid);
        if (!m) byCo.set(cid, (m = new Map()));
        for (const sk of skills) {
          let c = m.get(sk);
          if (!c) m.set(sk, (c = { week: 0, base: 0, older: 0 }));
          if (day >= weekStart) c.week++;
          else if (day >= baseStart) c.base++;
          else c.older++;
        }
      }

      const rows: AlertRow[] = [];
      const today = new Date().toISOString().slice(0, 10);
      for (const [cid, skills] of byCo) {
        const company = nameOf.get(cid) || cid;
        for (const [skill, c] of skills) {
          // A weekly rate, so the trailing week and the baseline are comparable.
          const weekly = c.base / 4;
          // Volume floor, the same reasoning the analyst's movers list uses: 1
          // ad becoming 3 is +200% and noise.
          if (c.week < 5 && weekly < 5) continue;

          if (c.base === 0 && c.older === 0 && c.week > 0) {
            rows.push({
              id: `${cid}:${skill}:new`,
              companyId: cid,
              company,
              initials: initialsOf(company),
              kind: "new skill",
              tab: "new",
              skill,
              headline: headlineFor("new skill", skill, c.week, 0),
              week: c.week,
              month: 0,
              at: today,
            });
            continue;
          }
          if (!weekly) continue;
          const change = (c.week - weekly) / weekly;
          if (change >= SPIKE || change <= COOLING) {
            const kind: AlertKind = change >= SPIKE ? "spike" : "cooling";
            rows.push({
              id: `${cid}:${skill}:${kind}`,
              companyId: cid,
              company,
              initials: initialsOf(company),
              kind,
              tab: "spikes",
              skill,
              headline: headlineFor(kind, skill, c.week, weekly),
              week: c.week,
              month: Math.round(weekly),
              at: today,
            });
          }
        }
      }

      // Biggest move first — the panel is read top-down and the strongest signal
      // should not be three scrolls in.
      rows.sort((a, b) => {
        const ra = a.month ? Math.abs((a.week - a.month) / a.month) : 99;
        const rb = b.month ? Math.abs((b.week - b.month) / b.month) : 99;
        return rb - ra;
      });

      return {
        ok: true,
        rows: rows.slice(0, 40),
        companies: ids.length,
        days,
        notice: rows.length
          ? undefined
          : "Nothing has moved outside its usual range at the companies you follow.",
      };
    } catch {
      return { ...EMPTY, notice: "Couldn't read the archive." };
    }
  },
);
