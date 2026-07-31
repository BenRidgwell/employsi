import { createServerFn } from "@tanstack/react-start";
import type { D1Like } from "./jobArchive";
import { SKILL_CATEGORY, parseStoredSkills } from "../data/skillsTaxonomy";
import { detectIntent } from "./analystIntent";
import { CITY_COUNTRY } from "../data/mapboxWorldGeo";

/**
 * "Ask an analyst" — the question-answering layer behind `ask an analyst.dc.html`.
 *
 * The design's header promises "answers grounded in live employsi vacancy
 * data", and that is taken literally here: this is NOT a language model. It
 * classifies a question into one of a few intents, runs the corresponding
 * aggregate over the D1 vacancy archive for the chosen scope, and returns real
 * figures with the sample they came from. Every number on screen is one the
 * archive can be re-queried for.
 *
 * The design's mock has four intents — hiring volume, pay, skills and candidate
 * competition — with invented figures for each. Three of them map onto data we
 * actually hold. The fourth does not: competition is applicants-per-role and
 * fill rates, which is employer-side funnel data employsi has never collected.
 * Rather than fabricate it, that intent answers with what the archive CAN say
 * about how contested a market is (how long ads stay up, how often they are
 * reposted, how many employers are bidding) and says plainly that application
 * counts are not held.
 *
 * Scope is resolved to a set of archive rows, not to a label: a company scope
 * filters on company_id, a city on hub, a country/region on that area's hubs.
 */

export type ScopeKind = "company" | "city" | "country" | "region" | "world";

export interface AnalystScope {
  kind: ScopeKind;
  /** company id / hub key / country code / region key; "" for world. */
  id: string;
  label: string;
}

export interface AnalystStat {
  k: string; // label, e.g. "Live roles"
  v: string; // headline value
  d?: string; // delta, e.g. "+6.4%"
  down?: boolean; // colour the delta as a decline
}

export interface AnalystBar {
  name: string;
  pct: number; // 0..100, relative to the biggest bar in the set
  v: string; // value label at the right
  down?: boolean;
}

export interface AnalystAnswer {
  intent: string;
  text: string;
  stats?: AnalystStat[];
  bars?: AnalystBar[];
  source?: string;
}

async function getArchiveDb(): Promise<D1Like | null> {
  try {
    const m = await import("cloudflare:workers");
    return (m?.env?.JOBS_ARCHIVE as D1Like) ?? null;
  } catch {
    return null;
  }
}

// ── Salary parsing ──────────────────────────────────────────────────────────
// The archive's `salary` column is whatever each board printed, and the formats
// genuinely differ by source: Adzuna writes a bare annual figure ("109,129"),
// MyCareersFuture a monthly SGD range ("S$2,600–S$4,600/mo"), Zhaopin a monthly
// CNY range in 万 ("2.5-4.5万"), the SA government a banded string
// ("$50k - $69k"), and SEEK often free text ("Competitive salary").
//
// Mixing those into one median would be meaningless, so each value is parsed to
// an ANNUAL figure tagged with its currency, and an answer is only given when
// one currency dominates the scope's sample. Anything unparseable is dropped
// rather than guessed at.
interface ParsedPay {
  annual: number;
  currency: string;
}

const NUM = String.raw`\d[\d,.]*`;

function parsePay(raw: string, fallbackCurrency: string): ParsedPay | null {
  const s = raw.trim();
  if (!s) return null;
  // Free text with no digits at all ("Competitive salary…").
  if (!/\d/.test(s)) return null;

  const num = (t: string) => Number(t.replace(/,/g, ""));

  // Zhaopin: "2.5-4.5万" or "8万" — 万 = 10,000 CNY, quoted per month.
  const wan = s.match(new RegExp(`(${NUM})\\s*(?:[-–~]\\s*(${NUM}))?\\s*万`));
  if (wan) {
    const lo = num(wan[1]);
    const hi = wan[2] ? num(wan[2]) : lo;
    return { annual: ((lo + hi) / 2) * 10000 * 12, currency: "CNY" };
  }

  // MyCareersFuture: "S$2,600–S$4,600/mo" (also handles a single value).
  const sgd = s.match(new RegExp(`S\\$\\s*(${NUM})(?:\\s*[-–]\\s*S?\\$?\\s*(${NUM}))?`));
  if (sgd) {
    const lo = num(sgd[1]);
    const hi = sgd[2] ? num(sgd[2]) : lo;
    const mid = (lo + hi) / 2;
    // "/mo" is explicit on this source; treat anything under 30k as monthly.
    const monthly = /\/\s*mo|per month|monthly/i.test(s) || mid < 30000;
    return { annual: monthly ? mid * 12 : mid, currency: "SGD" };
  }

  // Banded "k" strings, e.g. "$50k - $69k, $110k - $149k" — take the full span
  // of every band mentioned, which is what the employer actually advertised.
  const ks = [...s.matchAll(new RegExp(`(${NUM})\\s*k\\b`, "gi"))].map((m) => num(m[1]) * 1000);
  if (ks.length) {
    const mid = (Math.min(...ks) + Math.max(...ks)) / 2;
    return { annual: mid, currency: fallbackCurrency };
  }

  // Plain numbers, optionally a range: "109,129" or "80,000 - 95,000".
  const plain = [...s.matchAll(new RegExp(NUM, "g"))].map((m) => num(m[0])).filter((n) => n > 0);
  if (!plain.length) return null;
  const mid = (Math.min(...plain) + Math.max(...plain)) / 2;
  // Below this a figure is an hourly or monthly rate, not an annual salary, and
  // there is no reliable way to tell which — so it is dropped.
  if (mid < 20000) return null;
  return { annual: mid, currency: fallbackCurrency };
}

// The currency an unqualified number is quoted in, by country. Only countries
// the archive actually carries hubs for.
const COUNTRY_CURRENCY: Record<string, string> = {
  au: "AUD",
  nz: "NZD",
  sg: "SGD",
  jp: "JPY",
  hk: "HKD",
  ae: "AED",
  kr: "KRW",
  cn: "CNY",
  ca: "CAD",
  us: "USD",
  gb: "GBP",
  ch: "CHF",
  fr: "EUR",
  za: "ZAR",
};

const CURRENCY_SYMBOL: Record<string, string> = {
  AUD: "A$",
  NZD: "NZ$",
  SGD: "S$",
  JPY: "¥",
  HKD: "HK$",
  AED: "AED ",
  KRW: "₩",
  CNY: "CN¥",
  CAD: "C$",
  USD: "$",
  GBP: "£",
  CHF: "CHF ",
  EUR: "€",
  ZAR: "R",
};

function money(n: number, currency: string): string {
  const sym = CURRENCY_SYMBOL[currency] ?? currency + " ";
  if (n >= 1000) return `${sym}${Math.round(n / 1000)}k`;
  return `${sym}${Math.round(n)}`;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// ── Scope → SQL ─────────────────────────────────────────────────────────────
// Hub values in the archive are mostly lower-case city keys, but a few rows
// carry a capitalised or country-level hub ("Singapore", "Australia"), so
// matching is done on lower(hub) against the scope's keys plus its own label.
function scopeClause(
  scope: AnalystScope,
  hubs: string[],
  companyIds?: string[],
): { where: string; binds: (string | number)[] } {
  // A sector narrows to the employers in it. The ids are INLINED rather than
  // bound: a worldwide sector spans several hundred companies and D1 caps bound
  // parameters far below that. They are safe to inline because they are roster
  // slugs re-validated here — anything that is not /^[a-z0-9-]+$/ is dropped,
  // so nothing user-supplied can reach the statement.
  const ids = (companyIds ?? []).filter((id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id));
  // An empty set after filtering means the sector has no employers here at all;
  // `IN ()` is not valid SQL, so it becomes an explicit "matches nothing" and
  // the caller's no-rows message explains it.
  const sectorWhere = companyIds?.length
    ? ids.length
      ? ` AND company_id IN (${ids.map((id) => `'${id}'`).join(",")})`
      : " AND 0=1"
    : "";

  if (scope.kind === "company" && scope.id) {
    return { where: "company_id = ?", binds: [scope.id] };
  }
  if (!hubs.length) return { where: `1=1${sectorWhere}`, binds: [] };
  const keys = hubs.map((h) => h.toLowerCase());
  return {
    where: `lower(hub) IN (${keys.map(() => "?").join(",")})${sectorWhere}`,
    binds: keys,
  };
}

const dayStr = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string) => {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.max(0, Math.round((tb - ta) / 86400000));
};

function plural(n: number, one: string, many = one + "s") {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export interface AnalystRequest {
  question: string;
  scope: AnalystScope;
  /** Hub keys the scope covers; resolved on the client from the geo tables. */
  hubs: string[];
  /** ISO country code when the scope sits in exactly one country, for currency. */
  country?: string;
  /** Sector group the answer is narrowed to, for the wording and the source line. */
  sector?: string;
  /**
   * Roster company ids in that sector and scope, resolved on the client (the
   * archive stores an employer, not a sector). Empty/absent = no narrowing.
   */
  companyIds?: string[];
}

// POST rather than GET: a GET server fn serialises its payload into the URL,
// and a worldwide sector filter carries several hundred company ids — enough to
// overrun the request-line limit and fail as a 414 rather than an answer. The
// call is a read either way; only the transport changed.
export const askAnalyst = createServerFn({ method: "POST" })
  .validator((data: AnalystRequest) => data)
  .handler(async ({ data }): Promise<AnalystAnswer> => {
    const { question, scope, hubs, country, sector, companyIds } = data;
    const intent = detectIntent(question || "");
    const db = await getArchiveDb();
    if (!db) {
      return {
        intent: "unavailable",
        text: "The vacancy archive isn't reachable from here, so I can't answer against real data right now. Everything I say comes from that archive, so I'd rather tell you it's down than guess.",
      };
    }

    // A company scope is already one employer, so a sector filter on top of it
    // would either be a no-op or contradict it; it is ignored there.
    const sectorOn = !!sector && scope.kind !== "company" && !!companyIds;
    const { where, binds } = scopeClause(scope, hubs, sectorOn ? companyIds : undefined);
    // Everything the answer says about WHERE it looked. With a sector on, that
    // is not just a place — it is a place and a named set of employers, and the
    // difference matters because unattributed board rows drop out.
    const label = sectorOn ? `${sector} in ${scope.label}` : scope.label;

    // The archive's own span bounds every window below — it started collecting
    // recently, so a "month on month" read is not yet available and claiming one
    // would be false.
    let since = "";
    let latest = "";
    try {
      const span = await db
        .prepare(`SELECT MIN(first_seen) AS mn, MAX(last_seen) AS mx FROM jobs WHERE ${where}`)
        .bind(...binds)
        .first();
      since = String(span?.mn || "");
      latest = String(span?.mx || "");
    } catch {
      /* handled below */
    }
    if (!since || !latest) {
      return {
        intent,
        text: sectorOn
          ? `The archive holds no vacancies for ${sector} employers in ${scope.label} yet. A sector filter only sees ads I can attribute to a named employer in that sector — board listings I haven't matched to a company are left out rather than guessed at — so this can read empty even where the wider market is busy. Try another sector, or set it back to all sectors.`
          : `The archive holds no vacancies for ${label} yet, so there's nothing I can tell you about it without making it up. Try a wider scope, or one of the cities with live coverage.`,
        source: "employsi vacancy archive",
      };
    }
    const spanDays = daysBetween(since, latest);
    // Compare the latest day against a day this far back; capped by how much
    // history exists, so the comparison is always over real collected days.
    const window = Math.max(1, Math.min(7, Math.floor(spanDays / 2)));
    const then = dayStr(window);
    const canCompare = spanDays >= 2;
    const archiveNote =
      `employsi vacancy archive · ${label} · collected ${since} to ${latest}` +
      // Say how the sector was resolved, so the figure can be reproduced and so
      // it is clear this counts employers, not every ad in the market.
      (sectorOn ? ` · ${plural(companyIds?.length ?? 0, "employer")} matched` : "");

    // Live now = still appearing in the most recent pull.
    const liveRow = await db
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where} AND last_seen = ?`)
      .bind(...binds, latest)
      .first();
    const live = Number(liveRow?.n) || 0;
    if (!live) {
      return {
        intent,
        text: `Nothing is live for ${label} in the most recent pull (${latest}), so any figure I gave you would be about a market that isn't there. Try a wider scope.`,
        source: archiveNote,
      };
    }

    if (intent === "pay") {
      const rows = await db
        .prepare(
          `SELECT salary, hub FROM jobs
             WHERE ${where} AND salary IS NOT NULL AND salary <> '' AND last_seen = ?`,
        )
        .bind(...binds, latest)
        .all();
      const fallback = (country && COUNTRY_CURRENCY[country]) || "";
      const byCurrency: Record<string, number[]> = {};
      for (const r of rows?.results ?? []) {
        const p = parsePay(String(r.salary || ""), fallback);
        if (!p || !p.currency) continue;
        (byCurrency[p.currency] ||= []).push(p.annual);
      }
      const ranked = Object.entries(byCurrency).sort((a, b) => b[1].length - a[1].length);
      const [cur, vals] = ranked[0] ?? ["", []];
      const disclosed = Object.values(byCurrency).reduce((n, v) => n + v.length, 0);
      // Too thin a sample says more about which boards disclose pay than about
      // the market, so it is suppressed rather than shown with a caveat.
      if (!cur || vals.length < 20) {
        return {
          intent,
          text: `I can't give you a defensible pay figure for ${label}. Only ${plural(disclosed, "live ad")} there state a salary in a form I can compare, which is too few to quote a median from — most boards in this scope publish "competitive" instead of a number.`,
          source: archiveNote,
        };
      }
      const sorted = [...vals].sort((a, b) => a - b);
      const median = quantile(sorted, 0.5);
      const p25 = quantile(sorted, 0.25);
      const p75 = quantile(sorted, 0.75);
      const share = Math.round((vals.length / live) * 100);
      const mixed = ranked.length > 1;
      return {
        intent,
        text: `Median advertised pay in ${label} is ${money(median, cur)} a year, across the ${plural(vals.length, "live ad")} that actually publish a figure — ${share}% of what's open. The middle half of the market runs ${money(p25, cur)} to ${money(p75, cur)}.${mixed ? ` Ads quoted in other currencies are excluded rather than converted.` : ""}`,
        stats: [
          { k: `Median (${cur})`, v: money(median, cur) },
          { k: "25th percentile", v: money(p25, cur) },
          { k: "75th percentile", v: money(p75, cur) },
        ],
        source: `Advertised salaries on live ads · ${vals.length} of ${live} disclose pay · ${archiveNote}`,
      };
    }

    if (intent === "skills") {
      const rows = await db
        .prepare(
          `SELECT skills, first_seen, last_seen FROM jobs
             WHERE ${where} AND skills IS NOT NULL AND last_seen >= ?`,
        )
        .bind(...binds, then)
        .all();
      const now: Record<string, number> = {};
      const before: Record<string, number> = {};
      for (const r of rows?.results ?? []) {
        // Archived rows keep the skill names they were written with, so a
        // renamed skill is mapped forward here (see SKILL_ALIAS) rather than
        // being dropped as unrecognised.
        const skills = parseStoredSkills(r.skills);
        const fs = String(r.first_seen || "");
        const ls = String(r.last_seen || "");
        for (const s of skills) {
          if (!(s in SKILL_CATEGORY)) continue;
          if (ls === latest) now[s] = (now[s] || 0) + 1;
          if (fs <= then && ls >= then) before[s] = (before[s] || 0) + 1;
        }
      }
      const top = Object.entries(now)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (!top.length) {
        return {
          intent,
          text: `None of the live ads for ${label} carry a skill I can map to the taxonomy, so I have nothing to rank. That usually means the source for this scope publishes titles only.`,
          source: archiveNote,
        };
      }
      const max = top[0][1];
      const bars: AnalystBar[] = top.map(([name, n]) => {
        const prev = before[name] || 0;
        const delta = canCompare && prev > 0 ? Math.round(((n - prev) / prev) * 100) : null;
        return {
          name,
          pct: Math.round((n / max) * 100),
          v: delta === null ? `${n}` : `${n} · ${delta > 0 ? "+" : ""}${delta}%`,
          down: delta !== null && delta < 0,
        };
      });
      const lead = top[0];
      const changeNote = canCompare
        ? ` Change is measured against ${then}, ${plural(window, "day")} back — the archive only starts at ${since}, so this is a short-run read, not month on month.`
        : ` The archive is only ${plural(spanDays, "day")} deep here, so I can show what's in demand but not yet how it's moving.`;
      return {
        intent,
        text: `The most demanded skill in ${label} right now is ${lead[0]}, named in ${plural(lead[1], "live ad")}.${changeNote}`,
        bars,
        source: `Skills extracted from live ad titles · ${archiveNote}`,
      };
    }

    if (intent === "competition") {
      // No applicant data exists — see the file header. These are the real
      // contest signals the archive does carry.
      const agg = await db
        .prepare(
          `SELECT
             AVG(julianday(last_seen) - julianday(first_seen)) AS avg_days,
             SUM(CASE WHEN seen_count > 1 THEN 1 ELSE 0 END) AS repeated,
             COUNT(DISTINCT company) AS employers,
             COUNT(*) AS n
           FROM jobs WHERE ${where} AND last_seen = ?`,
        )
        .bind(...binds, latest)
        .first();
      const avgDays = Number(agg?.avg_days) || 0;
      const repeated = Number(agg?.repeated) || 0;
      const employers = Number(agg?.employers) || 0;
      const n = Number(agg?.n) || live;
      const repeatShare = n ? Math.round((repeated / n) * 100) : 0;
      return {
        intent,
        text: `I can't answer that one properly: employsi holds advertised vacancies, not application funnels, so applicants per role and fill rates aren't figures I have. What the archive can tell you about how contested ${label} is: ${plural(employers, "employer")} are advertising into it right now, the average live ad has been up ${avgDays.toFixed(1)} days, and ${repeatShare}% have been re-seen across more than one daily pull.`,
        stats: [
          { k: "Employers hiring", v: employers.toLocaleString("en-US") },
          { k: "Avg days advertised", v: avgDays.toFixed(1) },
          { k: "Re-seen ads", v: `${repeatShare}%` },
        ],
        source: `Ad persistence, not application data · ${archiveNote}`,
      };
    }

    if (intent === "volume") {
      const [thenRow, freshRow, employerRows, distinctRow] = await Promise.all([
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM jobs WHERE ${where} AND first_seen <= ? AND last_seen >= ?`,
          )
          .bind(...binds, then, then)
          .first(),
        db
          .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where} AND first_seen >= ?`)
          .bind(...binds, then)
          .first(),
        db
          .prepare(
            `SELECT company, COUNT(*) AS n FROM jobs
               WHERE ${where} AND last_seen = ? AND company IS NOT NULL AND company <> ''
               GROUP BY company ORDER BY n DESC LIMIT 4`,
          )
          .bind(...binds, latest)
          .all(),
        db
          .prepare(
            `SELECT COUNT(DISTINCT company) AS n FROM jobs
               WHERE ${where} AND last_seen = ? AND company IS NOT NULL AND company <> ''`,
          )
          .bind(...binds, latest)
          .first(),
      ]);
      const prior = Number(thenRow?.n) || 0;
      const fresh = Number(freshRow?.n) || 0;
      const pct = canCompare && prior > 0 ? ((live - prior) / prior) * 100 : null;
      const employers = employerRows?.results ?? [];
      const max = employers.length ? Number(employers[0].n) || 1 : 1;
      const bars: AnalystBar[] = employers.map((e) => ({
        name: String(e.company),
        pct: Math.round((Number(e.n) / max) * 100),
        v: String(e.n),
      }));
      const dirText =
        pct === null
          ? `The archive is only ${plural(spanDays, "day")} deep for this scope, so I can tell you the level but not yet the direction.`
          : `That's ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% on ${then}, ${plural(window, "day")} back — a short-run read, not month on month, because collection here starts at ${since}.`;
      return {
        intent,
        text: `${label} has ${plural(live, "role")} live in the latest pull (${latest}), with ${plural(fresh, "ad")} first seen in the last ${plural(window, "day")}. ${dirText}`,
        stats: [
          {
            k: "Live roles",
            v: live.toLocaleString("en-US"),
            d: pct === null ? undefined : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
            down: pct !== null && pct < 0,
          },
          { k: `New in ${window}d`, v: fresh.toLocaleString("en-US") },
          {
            k: "Employers",
            v: String(new Set(employers.map((e) => e.company)).size || employers.length),
          },
        ],
        bars,
        source: archiveNote,
      };
    }

    return {
      intent: "unknown",
      text: `I answer from the live vacancy archive, so I'm limited to what it holds for ${label}: how many roles are open and which way that's moving, what the ads disclose about pay, which skills they ask for, and how contested the market looks. Ask about one of those, or change the scope above.`,
      source: archiveNote,
    };
  });

// ── Advertised pay for one skill ────────────────────────────────────────────
// Powers the "Median salary" figure on the skill search card. Same parser and
// same discipline as the analyst's pay intent: only ads that state a figure in
// a comparable form count, only the dominant currency is reported, and a thin
// sample is suppressed entirely rather than shown with a caveat.

export interface SkillPay {
  median: number;
  currency: string;
  /** Ads that stated a parseable figure in that currency. */
  n: number;
  /** Live ads demanding the skill at all, so the card can show coverage. */
  live: number;
}

const PAY_MIN_SAMPLE = 20;

export const getSkillPay = createServerFn({ method: "GET" })
  .validator((data: { skill: string }) => data)
  .handler(async ({ data }): Promise<SkillPay | null> => {
    const skill = (data.skill || "").trim();
    if (!skill) return null;
    const db = await getArchiveDb();
    if (!db) return null;
    try {
      const latestRow = await db.prepare(`SELECT MAX(last_seen) AS mx FROM jobs`).first();
      const latest = String(latestRow?.mx || "");
      if (!latest) return null;
      // The skills column is a JSON array of canonical names, so matching the
      // QUOTED name is an exact containment test — "SQL" can't match "MySQL",
      // and "Nursing" can't match "Nursing Assistant".
      const quoted = `%${JSON.stringify(skill)}%`;
      const rows = await db
        .prepare(
          `SELECT salary, hub FROM jobs
             WHERE last_seen = ?1 AND skills LIKE ?2 AND salary IS NOT NULL AND salary <> ''`,
        )
        .bind(latest, quoted)
        .all();
      const liveRow = await db
        .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE last_seen = ?1 AND skills LIKE ?2`)
        .bind(latest, quoted)
        .first();
      const live = Number(liveRow?.n) || 0;
      const byCurrency: Record<string, number[]> = {};
      for (const r of rows?.results ?? []) {
        // The card is market-wide, so there is no single country to fall back
        // on — but every row carries its own hub, and the hub gives the country
        // and therefore the currency. That matters: the most common format in
        // the archive is a bare "$100k", which is meaningless until you know
        // whether the ad is Australian or American. Rows whose hub doesn't map
        // to a known country are dropped rather than assumed to be dollars.
        const hub = String(r.hub || "").toLowerCase();
        const fallback = COUNTRY_CURRENCY[CITY_COUNTRY[hub] ?? ""] ?? "";
        const p = parsePay(String(r.salary || ""), fallback);
        if (!p || !p.currency) continue;
        (byCurrency[p.currency] ||= []).push(p.annual);
      }
      const ranked = Object.entries(byCurrency).sort((a, b) => b[1].length - a[1].length);
      const [currency, vals] = ranked[0] ?? ["", []];
      if (!currency || vals.length < PAY_MIN_SAMPLE) return null;
      const sorted = [...vals].sort((a, b) => a - b);
      return { median: quantile(sorted, 0.5), currency, n: vals.length, live };
    } catch {
      return null;
    }
  });

/** Formats a pay figure for display; exported so the card renders it the same
 *  way the analyst's answers do. */
export function formatPay(p: SkillPay): string {
  return money(p.median, p.currency);
}
