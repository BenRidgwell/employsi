import { createServerFn } from "@tanstack/react-start";
import { LIVE_FEEDS_ONLY_SQL, type D1Like } from "./jobArchive";
import { SKILL_CATEGORY, parseStoredSkills } from "../data/skillsTaxonomy";
import { detectIntent, type AnalystIntent } from "./analystIntent";
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
 * The design's mock had four intents — hiring volume, pay, skills and candidate
 * competition — with invented figures for each. Three of them map onto data we
 * actually hold. The fourth never did: competition is applicants-per-role and
 * fill rates, employer-side funnel data employsi has never collected. It was
 * carried for a while as an intent that declined the question and offered ad
 * persistence instead; it was removed entirely on 2026-08-06. Those questions
 * now fall to "unknown" along with everything else outside the archive, which
 * is a plainer answer than a partial one dressed up as a related one.
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

// ── Charts ──────────────────────────────────────────────────────────────────
// The shapes an answer can draw, from `Analyst_Chart_Outputs`. The design's
// second series is a share price; see lib/analystCharts.ts for why it is a
// published vacancy series here instead, and why the correlogram is absent.
// These types live beside the answer they hang off so the renderer and the
// builder cannot drift.

export interface ChartSeries {
  label: string;
  /** Index values, already rebased — the renderer scales, it does not compute. */
  points: number[];
  /** Solid ink = the subject; dashed grey = what it is being read against. */
  tone: "ink" | "muted";
}

export interface AnalystChartLine {
  kind: "line";
  /** YYYY-MM, oldest first, index-aligned with every series' points. */
  months: string[];
  series: ChartSeries[];
  note: string;
}

export interface ScatterPoint {
  label: string;
  /** Year-on-year %. */
  x: number;
  /** Five-year %. */
  y: number;
  /** Latest-month vacancies — the bubble's area. */
  w: number;
}

export interface AnalystChartScatter {
  kind: "scatter";
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
}

export interface MultiplePanel {
  name: string;
  points: number[];
  note: string;
  delta: string;
  down?: boolean;
}

export interface AnalystChartMultiples {
  kind: "multiples";
  panels: MultiplePanel[];
}

export type AnalystChart = AnalystChartLine | AnalystChartScatter | AnalystChartMultiples;

export interface AnalystAnswer {
  intent: string;
  text: string;
  stats?: AnalystStat[];
  bars?: AnalystBar[];
  /** Drawn above the stats when the answer has a series worth seeing. */
  chart?: AnalystChart;
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

/** Whole-day median. Sorts a copy, so callers keep their insertion order. */
function median(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(
    quantile(
      [...values].sort((a, b) => a - b),
      0.5,
    ),
  );
}

// How much evidence the duration answer needs before it will quote a figure.
// The scope-wide floor stops a near-empty city reading as a market insight; the
// per-skill floor stops one long-running ad from crowning a skill "hardest to
// fill". Both are deliberately low-ish because the archive is young — raise
// them as it deepens rather than lowering them to fill the card.
const MIN_DURATION_ADS = 40;
const MIN_DURATION_PER_SKILL = 8;

// ── Scope → SQL ─────────────────────────────────────────────────────────────
// Hub values in the archive are mostly lower-case city keys, but a few rows
// carry a capitalised or country-level hub ("Singapore", "Australia"), so
// matching is done on lower(hub) against the scope's keys plus its own label.
/** Exported only so scripts/check-analyst-scope.ts can assert the invariant
 *  below — that every branch excludes the closed corpora. Nothing else calls
 *  it. */
export function scopeClause(
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

  // EVERY analyst statement inherits this, which is the point of putting it
  // here rather than on the individual queries.
  //
  // The analyst only ever answers about the market NOW — what is open, which
  // way it is moving, what the ads disclose, how long they run — and it dates
  // its own evidence off MIN(first_seen) for the scope. The Wayback corpus
  // (see HISTORICAL_SOURCES) is 2003–2018 ads recovered from career sites that
  // no longer exist, so on all four questions it is not old data, it is the
  // wrong data. Measured on production 2026-08-12 with it included:
  //
  //   · "collected 2003-12-29 to 2026-08-12" on any scope holding BHP, and
  //     2011-09-30 on any holding Rio. Real starts: 2026-07-16 and 2026-07-21.
  //   · spanDays ~8,262 instead of 27, which pins the comparison window at its
  //     7-day ceiling and makes canCompare true on scopes whose live feeds are
  //     a day or two deep — the archive-depth guard those two exist to be.
  //   · the duration median for BHP built from 2,746 closed ads of which 2,271
  //     (83%) came down between 2003 and 2018. Excluding them moves the mean
  //     span 15.0d → 22.5d on the 475 ads that are actually recent.
  //   · worst of all, `latest` is MAX(last_seen) WITHIN THE SCOPE, so a scope
  //     with no live coverage dated itself off the corpus: Santiago's 572 rows
  //     are all Wayback, and asking about it answered "2 roles live in the
  //     latest pull (2018-01-04)" — a seven-year-old number presented as now.
  //     It is the only such scope today; after this it correctly reports no
  //     coverage instead, which is the honest answer and not a regression.
  //
  // The company card still reads the corpus; it is asking a question the
  // corpus can answer. This one is not.
  const feedsOnly = ` AND ${LIVE_FEEDS_ONLY_SQL}`;

  if (scope.kind === "company" && scope.id) {
    return { where: `company_id = ?${feedsOnly}`, binds: [scope.id] };
  }
  if (!hubs.length) return { where: `1=1${sectorWhere}${feedsOnly}`, binds: [] };
  const keys = hubs.map((h) => h.toLowerCase());
  return {
    where: `lower(hub) IN (${keys.map(() => "?").join(",")})${sectorWhere}${feedsOnly}`,
    binds: keys,
  };
}

const dayStr = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

/** `n` days before an ISO day, so a window can be anchored to a day in the data
 *  rather than to the clock. */
const minusDays = (iso: string, n: number) => {
  const t = Date.parse(iso + "T00:00:00Z");
  if (Number.isNaN(t)) return iso;
  return new Date(t - n * 86400000).toISOString().slice(0, 10);
};

/**
 * How many ads were live on a given day, as a WHERE fragment.
 *
 * An ad is live on day D if it was first seen on or before D and last seen on
 * or after D. That is the archive's only honest answer to "how many were open
 * then", and — crucially — it is the SAME question on both sides of a
 * comparison. Counting today with `last_seen = <newest day>` and the past with
 * this reconstruction compares two different measures and produces a change
 * figure that is mostly the difference between them.
 *
 * It also spans collection gaps: an ad first seen on the 3rd and last seen on
 * the 9th is live on the 6th whether or not any row carries last_seen = the
 * 6th, so a day the crons skipped does not read as an empty market.
 */
const LIVE_ON_DAY = "first_seen <= ? AND last_seen >= ?";

/** How far back a feed can have last written and still count toward coverage.
 *  Past this it is dead or dormant, and a dead feed must not be able to veto
 *  every recent day for everyone else. */
const FEED_LOOKBACK_DAYS = 21;
/** Share of the scope's rows that must be evidenced before a day is usable. */
const COVERAGE_TARGET = 0.95;
/**
 * How far coverage is allowed to drag the reference day back.
 *
 * A floor, because the two failure modes are not symmetric. Reporting a short
 * day as a real fall is a wrong answer; reporting a complete day from a while
 * ago is a true answer about the wrong moment — worse the further back it
 * goes, and past a few days it stops being an answer about now at all.
 *
 * It is a real risk, not a hypothetical: BHP clears the 95% target by 882 rows
 * against 876.85 needed. Had its dormant vendor feed carried a little more,
 * coverage would have pointed at 2026-07-29 and the answer would have been a
 * fortnight stale without saying anything was wrong. Past this floor the
 * shortfall is accepted, and the date the note already prints is what lets a
 * reader see which day they are being told about.
 */
const MAX_STEP_BACK_DAYS = 3;

/**
 * The most recent day the scope's feeds have actually confirmed.
 *
 * LIVE_ON_DAY can only see an ad as live on day D if some feed pulled it on or
 * after D. Feeds run on their own crons, so the last day or two is always
 * short: whatever has not cycled yet is missing, and the count climbs as the
 * day's runs land. Measured on production 2026-08-12, BHP's live-on-day curve
 * sat between 360 and 452 for a fortnight, then read 235 for the 11th and 92
 * for the 12th — no vacancies closed, two feeds simply had not run.
 *
 * Stepping back one fixed day does not fix it (the 11th is short too), and
 * requiring EVERY feed to have pulled is worse: one weekly feed with six rows
 * would permanently pin the whole world scope five days back. So the rule is
 * by weight — walk the feeds newest-pull first and take the day at which the
 * ones counted reach COVERAGE_TARGET of the scope's rows. Measured the same
 * day, that picks the 10th for BHP (452 live, and the short 11th correctly
 * rejected) and the 11th for Perth and for worldwide, both of which were
 * stable there. A slow feed carrying under 5% is outvoted rather than
 * obeyed — the cost is that its ads are missing from the last day or two,
 * which is why the target is 95% and not lower.
 */
export function coverageDay(feeds: Array<{ mx: string; n: number }>): string {
  const total = feeds.reduce((t, f) => t + f.n, 0);
  if (!total) return "";
  const need = total * COVERAGE_TARGET;
  let acc = 0;
  for (const f of [...feeds].sort((a, b) => (a.mx < b.mx ? 1 : a.mx > b.mx ? -1 : 0))) {
    acc += f.n;
    if (acc >= need) return f.mx;
  }
  return "";
}

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
  /**
   * The intent this turn resolved to, once the conversation is taken into
   * account (see lib/analystTurn.ts).
   *
   * Sent rather than re-derived because a follow-up does not contain its own
   * intent: "what about Sydney?" classifies as "unknown" on its own, so reading
   * the sentence again here would answer the fallback and discard the question
   * it was following up on. Absent, the sentence is classified on its own — the
   * behaviour every caller had before follow-ups existed.
   */
  intent?: AnalystIntent;
}

// POST rather than GET: a GET server fn serialises its payload into the URL,
// and a worldwide sector filter carries several hundred company ids — enough to
// overrun the request-line limit and fail as a 414 rather than an answer. The
// call is a read either way; only the transport changed.
export const askAnalyst = createServerFn({ method: "POST" })
  .validator((data: AnalystRequest) => data)
  .handler(async ({ data }): Promise<AnalystAnswer> => {
    const { question, scope, hubs, country, sector, companyIds } = data;
    const intent = data.intent ?? detectIntent(question || "");
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
    // When each feed in this scope last pulled, and how much of the scope it
    // carries — the inputs to asOf below. Bounded to the recent past so a feed
    // that died months ago cannot inflate the denominator with its back
    // catalogue and drag the reference day down with it.
    let feeds: Array<{ mx: string; n: number }> = [];
    try {
      const [span, srcs] = await Promise.all([
        db
          .prepare(`SELECT MIN(first_seen) AS mn, MAX(last_seen) AS mx FROM jobs WHERE ${where}`)
          .bind(...binds)
          .first(),
        db
          .prepare(
            `SELECT MAX(last_seen) AS mx, COUNT(*) AS n FROM jobs
               WHERE ${where} AND last_seen >= ? GROUP BY source`,
          )
          .bind(...binds, dayStr(FEED_LOOKBACK_DAYS))
          .all(),
      ]);
      since = String(span?.mn || "");
      latest = String(span?.mx || "");
      feeds = (srcs?.results ?? []).map((r) => ({ mx: String(r.mx || ""), n: Number(r.n) || 0 }));
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
    /**
     * The day every figure below is measured AS AT: the most recent one the
     * archive can actually stand behind.
     *
     * Not `latest`. The crons run right through the day, so a day still in
     * progress holds only what has been re-pulled so far. Anchoring "live now"
     * to it and comparing against a completed day a week back had the analyst
     * reporting BHP down 75% on a week when nothing of the sort happened —
     * measured on production 2026-08-12. getVacancyTrend and the card's skill
     * trends already end a day back for the same reason.
     *
     * Two guards, because one is not enough. Today is always partial, so step
     * off it; and the day before can be short too where a feed has not cycled,
     * which is what coverageDay measures. Both are data-anchored rather than
     * clock-anchored, so a stalled scraper degrades sensibly instead of the
     * analyst insisting on a "yesterday" the archive never saw.
     *
     * Last resort: a scope younger than the guards can serve has no settled day
     * to step back to, so the partial one is all there is. It is reported with
     * `steppedBack` false and the note says plainly what it was measured to.
     */
    const yesterday = dayStr(1);
    let asOf = latest > yesterday ? yesterday : latest;
    const coverage = coverageDay(feeds);
    if (coverage && coverage < asOf) {
      const floor = minusDays(asOf, MAX_STEP_BACK_DAYS);
      asOf = coverage > floor ? coverage : floor;
    }
    if (asOf < since) asOf = latest;
    const steppedBack = asOf !== latest;

    const spanDays = daysBetween(since, asOf);
    // Compare the reference day against a day this far back; capped by how much
    // history exists, so the comparison is always over real collected days.
    const window = Math.max(1, Math.min(7, Math.floor(spanDays / 2)));
    // Anchored to asOf rather than to today, so both ends of the comparison sit
    // on days the archive actually completed. Taking it off the clock instead
    // could put `then` AFTER the newest data whenever collection is behind.
    const then = minusDays(asOf, window);
    const canCompare = spanDays >= 2;
    const archiveNote =
      `employsi vacancy archive · ${label} · collected ${since} to ${latest}` +
      // The archive runs to `latest`, but the figures are measured to the last
      // finished day. Both facts, because a reader who checks will find rows
      // dated after the day the answer claims.
      (steppedBack
        ? ` · measured as at ${asOf}, the most recent day every feed had reported`
        : "") +
      // Say how the sector was resolved, so the figure can be reproduced and so
      // it is clear this counts employers, not every ad in the market.
      (sectorOn ? ` · ${plural(companyIds?.length ?? 0, "employer")} matched` : "");

    // Live = open on the reference day, by the same reconstruction the
    // comparison below uses. See LIVE_ON_DAY.
    const liveRow = await db
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where} AND ${LIVE_ON_DAY}`)
      .bind(...binds, asOf, asOf)
      .first();
    const live = Number(liveRow?.n) || 0;
    if (!live) {
      return {
        intent,
        text: `Nothing was live for ${label} as at ${asOf}, so any figure I gave you would be about a market that isn't there. Try a wider scope.`,
        source: archiveNote,
      };
    }

    if (intent === "pay") {
      const rows = await db
        .prepare(
          `SELECT salary, hub FROM jobs
             WHERE ${where} AND salary IS NOT NULL AND salary <> '' AND ${LIVE_ON_DAY}`,
        )
        .bind(...binds, asOf, asOf)
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
          // Both ends by the same reconstruction. `ls === latest` counted only
          // the ads re-pulled so far on a day still in progress, against a
          // completed day for `before` — every skill then looked like it was
          // collapsing, in proportion to how far through the day the crons were.
          if (fs <= asOf && ls >= asOf) now[s] = (now[s] || 0) + 1;
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

    if (intent === "duration") {
      // How long ads stay up, aggregated by skill — the archive's answer to
      // "which skills are hard to hire for".
      //
      // THREE DELIBERATE CHOICES, EACH OF WHICH CHANGES THE NUMBER:
      //
      //  1. CLOSED ADS ONLY. A live ad's last_seen is today, so its span says
      //     "still open", not how long it ran. Including live ads would drag
      //     every figure toward zero and make the hardest-to-fill skills look
      //     the fastest, which is exactly backwards. "Closed" is not the same
      //     as "any old row" — the Wayback corpus is closed too, and is kept
      //     out by scopeClause, because how long a BHP ad ran in 2007 is not
      //     an answer to how long one runs now.
      //  2. MEASURED FROM THE AD'S OWN POSTED DATE, not from first_seen.
      //     Collection began recently, so first_seen is capped by the archive's
      //     depth: measured that way the whole market averages under two days,
      //     which is an artefact of when we started watching. days_since_posted
      //     is null where the source publishes no date, so this answers on the
      //     subset that does and says how big that subset is.
      //  3. MEDIAN, NOT MEAN. A few hundred rows carry evergreen postings a
      //     year or more old; they are real ads but they are not what "how long
      //     does this take to hire" means, and a mean would follow them.
      //
      // What it still is NOT: time to fill. The archive sees ads, never hires.
      // An ad coming down may mean filled, expired, withdrawn or a parser
      // breaking, and nothing here separates those. The wording below says so
      // rather than letting the column name imply otherwise.
      const rows = await db
        .prepare(
          `SELECT skills, days_since_posted AS d FROM jobs
             WHERE ${where} AND last_seen < ? AND days_since_posted IS NOT NULL
               AND skills IS NOT NULL
             ORDER BY last_seen DESC LIMIT 8000`,
        )
        // Closed as at the reference day, not as at `latest`: an ad whose last
        // sighting is the reference day may simply not have been re-pulled yet,
        // and counting it as finished truncates its run.
        .bind(...binds, asOf)
        .all();
      const bySkill: Record<string, number[]> = {};
      const all: number[] = [];
      for (const r of rows?.results ?? []) {
        const d = Number(r.d);
        if (!Number.isFinite(d) || d < 0) continue;
        all.push(d);
        for (const s of parseStoredSkills(r.skills)) {
          if (!(s in SKILL_CATEGORY)) continue;
          (bySkill[s] ||= []).push(d);
        }
      }
      if (all.length < MIN_DURATION_ADS) {
        return {
          intent,
          text: `I can't give you a duration read for ${label} yet. It needs ads that have come down (so the run is complete) AND that carried their own posted date, and only ${plural(all.length, "ad")} here meet both — under the ${MIN_DURATION_ADS} I'd want before quoting a figure. Indeed and the state government boards publish no posted date at all, so a scope leaning on those stays thin until the archive deepens.`,
          source: archiveNote,
        };
      }
      // Rank by median, longest first, over skills with enough closed ads to
      // mean anything. The cut is per-skill, not global: a scope can hold
      // plenty of ads overall and still have one skill resting on three.
      const ranked = Object.entries(bySkill)
        .filter(([, v]) => v.length >= MIN_DURATION_PER_SKILL)
        .map(([name, v]) => ({ name, med: median(v), n: v.length }))
        .sort((a, b) => b.med - a.med);
      if (!ranked.length) {
        return {
          intent,
          text: `${label} has ${plural(all.length, "closed ad")} I can time, but no single skill reaches ${MIN_DURATION_PER_SKILL} of them, so any ranking would rest on a handful of ads. Across all of them the median ad ran ${plural(median(all), "day")} from its posted date to the day it came down.`,
          stats: [
            { k: "Median days advertised", v: String(median(all)) },
            { k: "Closed ads timed", v: all.length.toLocaleString("en-US") },
          ],
          source: `Ad duration, not time to fill · ${archiveNote}`,
        };
      }
      const slowest = ranked.slice(0, 5);
      const max = slowest[0].med || 1;
      const bars: AnalystBar[] = slowest.map((s) => ({
        name: s.name,
        pct: Math.round((s.med / max) * 100),
        v: `${s.med}d · ${s.n}`,
      }));
      const fastest = ranked[ranked.length - 1];
      const overall = median(all);
      return {
        intent,
        text: `In ${label}, ads naming ${slowest[0].name} stayed up longest — a median of ${plural(slowest[0].med, "day")} from posting to coming down, against ${plural(overall, "day")} across the market. The quickest of the skills with enough ads to rank is ${fastest.name} at ${plural(fastest.med, "day")}. Read that as how long a vacancy stays advertised, not as time to fill: employsi sees ads, not hires, so an ad disappearing might mean filled, expired or withdrawn, and I can't tell those apart. It's measured from each ad's own posted date over ${plural(all.length, "ad")} that have since come down.`,
        bars,
        stats: [
          { k: "Median days advertised", v: String(overall) },
          { k: "Slowest skill", v: `${slowest[0].name} · ${slowest[0].med}d` },
          { k: "Closed ads timed", v: all.length.toLocaleString("en-US") },
        ],
        source: `Ad duration from the ad's own posted date, not time to fill · ${archiveNote}`,
      };
    }

    if (intent === "volume") {
      const [thenRow, freshRow, employerRows, distinctRow] = await Promise.all([
        // The comparison end. `live` above is the same count on `asOf`, so the
        // two sides differ only in which day they ask about.
        db
          .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where} AND ${LIVE_ON_DAY}`)
          .bind(...binds, then, then)
          .first(),
        // Bounded at the top too: an ad first seen on a day the answer does not
        // yet claim to cover is not "new in the last N days" of that answer.
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM jobs WHERE ${where} AND first_seen >= ? AND first_seen <= ?`,
          )
          .bind(...binds, then, asOf)
          .first(),
        db
          .prepare(
            `SELECT company, COUNT(*) AS n FROM jobs
               WHERE ${where} AND ${LIVE_ON_DAY} AND company IS NOT NULL AND company <> ''
               GROUP BY company ORDER BY n DESC LIMIT 4`,
          )
          .bind(...binds, asOf, asOf)
          .all(),
        db
          .prepare(
            `SELECT COUNT(DISTINCT company) AS n FROM jobs
               WHERE ${where} AND ${LIVE_ON_DAY} AND company IS NOT NULL AND company <> ''`,
          )
          .bind(...binds, asOf, asOf)
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
        text: `${label} had ${plural(live, "role")} live as at ${asOf}${steppedBack ? ", the most recent day the feeds had all reported" : ""}, with ${plural(fresh, "ad")} first seen in the ${plural(window, "day")} before that. ${dirText}`,
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
      text: `I answer from the live vacancy archive, so I'm limited to what it holds for ${label}: how many roles are open and which way that's moving, what the ads disclose about pay, which skills they ask for, and how long roles stay advertised. Ask about one of those, or change the scope above.`,
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
      // Measured as at the last FULL day of collection, for the same reason the
      // analyst is — see asOf in askAnalyst. There is no comparison here to
      // skew, but a day still in progress holds only the ads re-pulled so far,
      // so the sample this median rests on would depend on what time the card
      // was opened, and could fall under PAY_MIN_SAMPLE and suppress a figure
      // that is perfectly well evidenced by mid-afternoon.
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const asOf = latest > yesterday ? yesterday : latest;
      // The skills column is a JSON array of canonical names, so matching the
      // QUOTED name is an exact containment test — "SQL" can't match "MySQL",
      // and "Nursing" can't match "Nursing Assistant".
      const quoted = `%${JSON.stringify(skill)}%`;
      const rows = await db
        .prepare(
          `SELECT salary, hub FROM jobs
             WHERE first_seen <= ?1 AND last_seen >= ?1 AND skills LIKE ?2
               AND salary IS NOT NULL AND salary <> ''`,
        )
        .bind(asOf, quoted)
        .all();
      const liveRow = await db
        .prepare(
          `SELECT COUNT(*) AS n FROM jobs
             WHERE first_seen <= ?1 AND last_seen >= ?1 AND skills LIKE ?2`,
        )
        .bind(asOf, quoted)
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
