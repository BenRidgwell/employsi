/**
 * The "Live trends" computation — market-wide skill-demand movers over the D1
 * job archive — as a PURE function of the archive rows, so two callers can
 * share it byte for byte:
 *
 *  • getLiveSkillTrends (jobHistoryFn.ts), the server function behind the
 *    app's ticker and the marketing site's ticker and hero callouts;
 *  • the scraper Worker's nightly TRENDS_CACHE_CRON tick
 *    (workers/jobs-cron/index.ts), which pre-computes the worldwide answer
 *    into KV so no visitor waits on the 60-day scan.
 *
 * It imports nothing that touches a request, a session or the TanStack
 * runtime, which is what lets the Worker bundle it — keep it that way. The
 * caller decides WHO is asking (`seesAll`) and supplies the query function.
 */
import { liveDaysFor, type SqlValue } from "./jobArchive";
import { isReleasedRow } from "./markets";
import {
  SKILL_CATEGORY,
  dropRedundantKin,
  withParent,
  parseStoredSkills,
} from "../data/skillsTaxonomy";
import { coverageDay } from "./feedCoverage";
import { annualAud, medianAnnual } from "./salaryParse";
import { CITY_COUNTRY, REGION_HUBS } from "../data/mapboxWorldGeo";

// One "Live trends" ticker row: a canonical skill and how its vacancy demand has
// moved, market-wide, over the most recent window versus the one before it.
export interface LiveSkillTrend {
  name: string; // canonical skill
  tag: string; // 'Demand'
  v: number; // % change (positive = rising demand); newly-surging capped at +24
  // Daily count of live vacancies demanding this skill, oldest → newest, for
  // the ticker's sparkline. Omitted when the archive is too young to draw an
  // honest line (see SPARK_MIN_POINTS below) — the ticker then shows the row
  // without one rather than inventing a shape.
  spark?: number[];
  /**
   * Median annual salary, in AUD, advertised across the currently-live
   * Australian vacancies that demand this skill.
   *
   * Omitted when too few of them state one. Australian only, and never
   * converted from another currency — see lib/salaryParse for why the currency
   * of an archived salary string is knowable only from its hub, and why
   * averaging a San Jose figure with a Brisbane one produces a number that is
   * not a salary anywhere.
   */
  pay?: number;
}

// The three windows the ticker's window control cycles through, matching the
// design. Each is computed independently from the archive against its OWN prior
// window (24h vs the day before, 7d vs the week before, 30d vs the month
// before), so switching window changes what is being measured rather than
// rescaling one number — the design's mock multiplied a single delta by 2.1 and
// 3.4, which would have been a fabricated figure here.
export type TrendWindow = "24h" | "7d" | "30d";
export const TREND_WINDOWS: { key: TrendWindow; days: number; label: string; short: string }[] = [
  { key: "24h", days: 1, label: "· Last 24 hours", short: "24h" },
  { key: "7d", days: 7, label: "· Last 7 days", short: "7d" },
  { key: "30d", days: 30, label: "· Last 30 days", short: "30d" },
];
export type LiveSkillTrends = Record<TrendWindow, LiveSkillTrend[]>;

/**
 * Re-order a ranked list so risers and fallers alternate.
 *
 * WHY THE TICKER NEEDED THIS. The movers are ranked by how big the change is,
 * and a day's biggest changes are not evenly signed — when a batch of feeds
 * lands or a hiring season turns, the whole top of the list leans one way. The
 * marquee then shows a run of red followed by a run of green, which reads as
 * "everything is falling" for several seconds at a time even though the mix is
 * balanced. The comment at the sort had claimed this interleaving existed since
 * the ticker was written; it did not.
 *
 * SELECTION IS NOT TOUCHED, ONLY ORDER. This runs after the cut, so which
 * skills appear is still purely the biggest movers — alternating before the cut
 * would let a small riser displace a larger faller just to balance the signs,
 * which would be choosing what to report by how it looks.
 *
 * It leads with whichever side holds the single biggest mover, so the strongest
 * signal is still first, and when one side runs out the remainder tails on
 * rather than being dropped. A list that is all one sign comes back unchanged.
 */
export function alternateBySign<T>(items: T[], valueOf: (t: T) => number): T[] {
  const up = items.filter((t) => valueOf(t) > 0);
  const down = items.filter((t) => valueOf(t) <= 0);
  if (!up.length || !down.length) return items;
  // Whichever side the overall list already leads with keeps the first slot.
  const leadUp = items.length > 0 && valueOf(items[0]) > 0;
  const a = leadUp ? up : down;
  const b = leadUp ? down : up;
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/**
 * Median advertised salary for one bag of ads.
 *
 * `byCountry` is the whole point. Pooling every ad worldwide answers "what does
 * the median ADVERTISEMENT pay", which is a question about where the ads happen
 * to be, not about the skill: measured on production, Financial pooled to $8k
 * because 151 of its 296 priced ads were Philippine at ~A$7k, and 199 of them
 * carried no hub at all. Taking the median OF THE MARKET MEDIANS instead gives
 * every market one vote — an equal-weighted index rather than a volume-weighted
 * one — and the same category comes out at $113k from 2 markets.
 *
 * Within a single market the two are the same thing, so a scoped read just
 * pools.
 */
export function priceOf(
  byCountry: Map<string, number[]>,
  pooled: number[],
  worldwide: boolean,
): { pay: number | null; n: number; markets: number } {
  const n = pooled.length;
  if (!worldwide) return { pay: medianAnnual(pooled), n, markets: byCountry.size ? 1 : 0 };
  const perMarket: number[] = [];
  for (const v of byCountry.values()) {
    const m = medianAnnual(v);
    if (m !== null) perMarket.push(m);
  }
  if (!perMarket.length) return { pay: null, n, markets: 0 };
  perMarket.sort((a, b) => a - b);
  const mid = Math.floor(perMarket.length / 2);
  const pay =
    perMarket.length % 2 ? perMarket[mid] : Math.round((perMarket[mid - 1] + perMarket[mid]) / 2);
  return { pay, n, markets: perMarket.length };
}

/**
 * The pure half of getSkillMarket: archive rows in, a priced market out.
 *
 * Split out for the same reason foldSkillRows is — the day arithmetic and the
 * price construction are both easy to get subtly wrong and impossible to eyeball
 * on a rendered ticker. See scripts/check-skill-trends.ts.
 *
 * `window` is oldest → newest and already trimmed to days the scope's feeds
 * cover; `asOf` is its last day, the reference day every level is measured at.
 */

/**
 * The KV cache the answer is kept in, shared by the app and the scraper.
 *
 * KV is SHARED WITH PRODUCTION (a --name deploy inherits the bindings), so a
 * preview writes the same keys production reads. That is safe only because the
 * value is a pure function of the shared D1 archive and the caller's role, so
 * every deployment computes the same answer. BUMP THE VERSION whenever the
 * SHAPE or the METHOD of the result changes, or an older deployment will serve
 * the newer one's cached answer (and vice versa) until it expires.
 */
export const TRENDS_KV_PREFIX = "trends:v1:";

export function trendsKvKey(seesAll: boolean, region: string): string {
  return `${TRENDS_KV_PREFIX}${seesAll ? "admin" : "user"}|${region}`;
}

/** What is stored under a trends key. `src` says which writer produced it. */
export interface TrendsCacheEntry {
  at: number;
  src: "app" | "cron";
  value: LiveSkillTrends;
}

/**
 * How long a cached answer is served.
 *
 * The app's own writes last an HOUR, as before. The nightly writes last a DAY
 * and a bit, because the answer is a day-resolution one: every window compares
 * two whole days ending on the last COVERED day (never today), so once the
 * night's feeds have landed the result does not change until the next UTC
 * midnight moves "yesterday". Recomputing it hourly in between bought nothing
 * but a 5–10 s wait for whichever visitor drew the cold isolate. The extra
 * hours cover a nightly run that starts late; a run that fails outright falls
 * back to the app computing it, as it did before any of this existed.
 */
export const TRENDS_FRESH_MS: Record<TrendsCacheEntry["src"], number> = {
  app: 60 * 60 * 1000,
  cron: 26 * 60 * 60 * 1000,
};

export function trendsEntryFresh(
  e: Partial<TrendsCacheEntry> | null | undefined,
  now = Date.now(),
): boolean {
  if (!e?.value || !e.at) return false;
  return now - e.at < TRENDS_FRESH_MS[e.src === "cron" ? "cron" : "app"];
}

/** The one query behind the computation. */
export const LIVE_TRENDS_SQL = `SELECT skills, first_seen, last_seen, hub, company_id, salary, source FROM jobs
             WHERE skills IS NOT NULL AND last_seen >= ?1`;

export type TrendsRow = Partial<
  Record<
    "skills" | "first_seen" | "last_seen" | "hub" | "company_id" | "salary" | "source",
    SqlValue
  >
>;

/**
 * Compute the movers for every window.
 *
 * `region` is one of the map's domestic regions, or "" for the world; an
 * unknown region returns nothing rather than the world under its name.
 * `seesAll` is true only for an admin caller — see markets.ts.
 */
export async function buildLiveSkillTrends(
  query: (sql: string, params: (string | number)[]) => Promise<TrendsRow[]>,
  opts: { region: string; seesAll: boolean },
): Promise<LiveSkillTrends> {
  const empty: LiveSkillTrends = { "24h": [], "7d": [], "30d": [] };
  const region = opts.region.trim();
  const scopeHubs = region ? (REGION_HUBS[region] ?? []) : [];
  if (region && !scopeHubs.length) return empty;
  const hubSet = new Set(scopeHubs.map((h) => h.toLowerCase()));
  const seesAll = opts.seesAll;
  // Sparkline length. The archive stores first_seen/last_seen per listing, so
  // "how many live vacancies demanded skill X on day D" is recoverable for any
  // day the archive was actually running — no new storage needed, and the line
  // gets richer on its own as the archive accumulates. 30 days is the longest
  // any window needs; the shorter windows draw the tail of the same series.
  const SPARK_DAYS = 30;
  const SPARK_MIN_POINTS = 5; // below this the line says more about the
  // archive's age than about demand, so it is dropped entirely
  // How far back the coverage guard below may step. The same 3 analystFn
  // uses: far enough to clear a feed that has not cycled, near enough that a
  // permanently dead feed cannot park the ticker a week in the past.
  const MAX_STEP_BACK_DAYS = 3;
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  // The widest window pair (30 + 30) bounds the scan; the narrower windows are
  // computed from the same rows, so all three cost one query.
  const widest = Math.max(...TREND_WINDOWS.map((w) => w.days));
  const scanFrom = day(widest * 2);
  // ONE SERIES, AND BOTH HALVES OF EVERY WINDOW ARE READ FROM IT.
  //
  // This used to measure the two halves DIFFERENTLY, which is the thing
  // CLAUDE.md warns about in as many words: `now` counted listings whose
  // last_seen fell inside the recent window, while `prev` counted listings
  // LIVE AT ANY POINT in the prior window (first_seen <= end AND last_seen >=
  // start). The span reconstruction always sweeps up more rows than a
  // last_seen count, so prev exceeded now structurally — not because demand
  // fell. Measured on production 2026-09-18, every skill in the 24h window and
  // every skill in the 7d window came back negative, 16 of 16 in both, most of
  // them pinned to the -16% clamp; the 30d window flipped the other way, 16 of
  // 16 positive at +24%, because there the archive's own growth dominated.
  // Sixteen unrelated skills never move in lockstep: that is the method
  // showing through, not the market.
  //
  // So the day-by-day live count below is now the ONLY measure, and the delta
  // is two points on it. The sparkline is drawn from the same array, so the
  // line and the number finally describe the same thing.
  const seriesDays: string[] = [];
  for (let i = widest * 2; i >= 0; i--) seriesDays.push(day(i));
  const seriesStartMs = Date.parse(seriesDays[0] + "T00:00:00Z");
  const dayIdx = (d: string) =>
    Math.round((Date.parse(d + "T00:00:00Z") - seriesStartMs) / 86400000);
  const bounds = TREND_WINDOWS.map((w) => ({ key: w.key, days: w.days }));
  const rows = await query(LIVE_TRENDS_SQL, [scanFrom]);
  if (!rows.length) return empty;
  // skill -> per-day live-vacancy count, indexed against sparkDays.
  const daily: Record<string, number[]> = {};
  // The earliest day the archive holds anything at all. Days before it are
  // not "zero demand", they are "we weren't collecting" — drawing them would
  // render every skill as a hockey stick.
  let archiveStart = "9999-99-99";
  // New listings per day, used below to find the day collection actually
  // began rather than the day the first stray row landed.
  const newPerDay: Record<string, number> = {};
  // Per-feed row count and most recent write, for coverageDay below — the
  // other end of the same problem: not when collection STARTED, but which
  // day it has finished.
  const feedMax: Record<string, { mx: string; n: number }> = {};
  let latestSeen = "";
  // skill -> the annual AUD figures advertised for it RIGHT NOW, kept BOTH
  // pooled and split by market. `payFrom` is the same boundary the app uses
  // for "currently advertised", so the median describes ads a reader could
  // go and apply to today — not the 60-day scan window the deltas need.
  //
  // Split by market because this ticker is worldwide and a pooled median
  // over every market answers the wrong question — see priceOf. Measured on
  // production 2026-08-12, pooled put Banking & Lending at $8k, because 151
  // of its 296 priced ads were Philippine at about A$7k a year. The figure
  // was arithmetically correct and completely misleading.
  const payAds: Record<string, number[]> = {};
  const payByMarket: Record<string, Map<string, number[]>> = {};
  const payFrom = day(1);
  for (const r of rows) {
    // parseStoredSkills, not a bare JSON.parse: archived rows keep the
    // skill names they were written with, so a renamed skill needs its old
    // name mapped forward or that row's demand vanishes (see SKILL_ALIAS).
    const skills = parseStoredSkills(r.skills);
    if (!skills.length) continue;
    const fs = String(r.first_seen || "");
    const ls = String(r.last_seen || "");
    if (!fs || !ls) continue;
    if (!seesAll && !isReleasedRow(r.hub as string | null, r.company_id as string | null)) continue;
    // THE REGION FILTER, AND WHAT IT NECESSARILY DROPS. A region is a set of
    // hub cities, so a row with no hub cannot be in one — and 31,334 of the
    // rows in a 60-day scan have no hub at all (measured 2026-09-25, 17% of
    // them). They count worldwide, where "somewhere" is enough, and they
    // cannot count here. That is the same collected-vs-placeable line the
    // hotspot map draws, applied to the strip.
    if (hubSet.size && !hubSet.has(String(r.hub || "").toLowerCase())) continue;
    if (fs < archiveStart) archiveStart = fs;
    newPerDay[fs] = (newPerDay[fs] || 0) + 1;
    if (ls >= payFrom) {
      const aud = annualAud({
        salary: r.salary as string | null,
        hub: r.hub as string | null,
        source: r.source as string | null,
      });
      if (aud !== null) {
        const hub = String(r.hub || "").toLowerCase();
        // Hubless ads can be valued but not placed, so they price the
        // pooled bag and cannot cast a market vote.
        const country = CITY_COUNTRY[hub] ?? (hub === "australia" ? "au" : "");
        for (const s of skills) {
          (payAds[s] ||= []).push(aud);
          if (!country) continue;
          const m = (payByMarket[s] ||= new Map());
          const bag = m.get(country);
          if (bag) bag.push(aud);
          else m.set(country, [aud]);
        }
      }
    }
    // WHICH FEEDS HAVE REPORTED, AND HOW RECENTLY. Counted after the
    // visibility filter above, so coverage describes the rows that actually
    // reach the figures rather than the whole table.
    const srcName = String(r.source || "");
    const f = (feedMax[srcName] ||= { mx: "", n: 0 });
    f.n += 1;
    if (ls > f.mx) f.mx = ls;
    if (ls > latestSeen) latestSeen = ls;
    // A listing is live on day D when it was first seen on or before D and
    // last seen on or after it. Walked by index rather than by testing every
    // day against every row: the series is twice as long as it used to be,
    // and this makes it cheaper than the 30-day version it replaces.
    //
    // THE TRAILING EDGE RUNS ON PAST `ls` BY THE FEED'S OWN CADENCE, which is
    // the same rule every live count in the app now applies (SOURCE_LIVE_DAYS
    // in jobArchive.ts). Ending each ad at its last SIGHTING draws a weekly
    // feed as a sawtooth: every one of its ads enters the series on the day of
    // the run and leaves it the next morning, so the line sags for six days and
    // jumps every Monday — a pattern in the collection, drawn as a pattern in
    // the market. Nothing moves for a nightly feed, where the grace is zero.
    const lo = Math.max(0, dayIdx(fs));
    const hi = Math.min(seriesDays.length - 1, dayIdx(ls) + liveDaysFor(srcName) - 1);
    for (let i = lo; i <= hi; i++) {
      for (const sk of skills) {
        const arr = (daily[sk] ||= new Array(seriesDays.length).fill(0));
        arr[i] += 1;
      }
    }
  }
  // WHEN DID COLLECTION ACTUALLY START?
  //
  // Not the same question as "what is the oldest row", and getting them
  // confused is what broke this. The archive's first rows trickle in while
  // a feed is being set up — measured here: 4 rows on the first day, 4 on
  // the second, 1 on the third, then 1,994 on the fourth. Treating the
  // first of those as the start makes the three days before the real ramp
  // look like days of near-zero demand, and every skill then reads as
  // exploding growth against them.
  //
  // So the start is the first day carrying at least a tenth of the median
  // day's new listings. That cleanly separates a 1-row setup day from a
  // 2,000-row collecting day without needing a hand-picked date.
  const dayCounts = Object.values(newPerDay).sort((a, c) => a - c);
  const medianNew = dayCounts.length ? dayCounts[Math.floor(dayCounts.length / 2)] : 0;
  const collectingDays = Object.keys(newPerDay)
    .filter((d) => newPerDay[d] >= medianNew * 0.1)
    .sort();
  const coverageStart = collectingDays[0] ?? archiveStart;

  // WHICH DAY IS THE LAST ONE WORTH MEASURING?
  //
  // The other end of the coverage problem, and the one that made every short
  // window negative. TODAY IS ALWAYS PARTIAL — measured on production
  // 2026-09-18, today held 20,176 ads from 35 sources against yesterday's
  // 36,584 from 74, because most feeds had not run yet. Comparing that
  // half-collected day against fully collected ones reports the missing
  // feeds as falling demand, for every skill at once.
  //
  // Two guards, the same pair analystFn uses: step off today, which is never
  // finished; then step back to coverageDay, the most recent day by which
  // 95% of the rows' feeds have reported, because yesterday is often short
  // too. Both are anchored to the data rather than the clock, so a stalled
  // scraper degrades the figure instead of silently skewing it — and the
  // step back is floored so one dead feed cannot drag the ticker into the
  // distant past.
  const yesterday = day(1);
  let asOf = latestSeen && latestSeen < yesterday ? latestSeen : yesterday;
  const cov = coverageDay(Object.values(feedMax));
  if (cov && cov < asOf) {
    const floor = day(1 + MAX_STEP_BACK_DAYS);
    asOf = cov > floor ? cov : floor;
  }
  const iNow = dayIdx(asOf);

  // The sparkline ends on the same day the delta does, so a partial today
  // can no longer put a phantom cliff on the end of every line.
  const firstCovered = seriesDays.findIndex((d) => d >= archiveStart);
  const sparkFrom = Math.max(
    Math.max(0, iNow - (SPARK_DAYS - 1)),
    firstCovered < 0 ? seriesDays.length : firstCovered,
  );
  const sparkFor = (name: string): number[] | undefined => {
    const arr = daily[name];
    if (!arr) return undefined;
    const cut = arr.slice(sparkFrom, iNow + 1);
    if (cut.length < SPARK_MIN_POINTS) return undefined;
    // A dead-flat line is noise, not signal — leave it off.
    return cut.some((v) => v !== cut[0]) ? cut : undefined;
  };

  const out = { ...empty };
  for (const b of bounds) {
    // A CHANGE IS ONLY REPORTABLE WHEN BOTH HALVES WERE COLLECTED.
    //
    // Each window compares the last N days against the N before them. If
    // the archive was not running for that earlier half, `prev` is 0 for
    // every skill — not because demand was zero, but because nobody was
    // looking. The old code turned that into `pct = 100`, clamped to the
    // ticker's +24% band, so a 30-day window over a 12-day-old archive
    // reported every single skill as up 24%. That is an invented number
    // presented as measurement, and the 7-day window was distorted the
    // same way by a prior half that was only partly collected.
    //
    // A window whose prior half predates collection is left EMPTY. The
    // ticker says so rather than showing a figure nobody measured, and the
    // window starts reporting on its own once the archive is old enough.
    const iPrev = iNow - b.days;
    if (iPrev < 0 || seriesDays[iPrev] < coverageStart) {
      out[b.key] = [];
      continue;
    }
    type Row = { name: string; v: number; sig: number };
    const movers: Row[] = [];
    for (const s of Object.keys(daily)) {
      if (!(s in SKILL_CATEGORY)) continue; // only canonical skills on the ticker
      // BOTH SIDES OFF THE SAME SERIES: live vacancies demanding this skill
      // on the reference day, against the same count `days` earlier.
      const now = daily[s][iNow] || 0;
      const prev = daily[s][iPrev] || 0;
      // Require a little volume so single-listing noise doesn't dominate.
      if (now + prev < 3) continue;
      const delta = now - prev;
      if (delta === 0) continue;
      // prev === 0 here means genuinely new demand within a collected
      // window, not a gap in the archive — that case is excluded above.
      let pct = prev > 0 ? (delta / prev) * 100 : 100;
      pct = Math.max(-16, Math.min(24, pct)); // match the ticker's visual band
      movers.push({ name: s, v: Math.round(pct * 10) / 10, sig: Math.abs(delta) });
    }
    // Biggest absolute movers first — this decides WHICH skills are
    // reported, and nothing about how they look may influence it.
    movers.sort((a, b2) => b2.sig - a.sig || Math.abs(b2.v) - Math.abs(a.v));
    // Before the slice, not after, so suppressing a speciality frees its
    // slot for a different skill instead of shortening the ticker.
    const ranked = dropRedundantKin(movers, (m) => m.name).slice(0, 16);
    // Then, and only then, alternate the signs so the marquee does not run
    // a block of red followed by a block of green. Order only; the sixteen
    // are already chosen. See alternateBySign.
    const picked = alternateBySign(ranked, (m) => m.v);
    // THE PADDING FALLBACK IS GONE, and it has to be.
    //
    // When a window produced fewer than six movers this topped the ticker up
    // with the highest-demand skills at an INVENTED percentage —
    // `Math.min(18, 2 + Math.round(cnt / 3))`, a number derived from a
    // headcount and displayed as a change over time. That is precisely what
    // the seed list was deleted for (see the note in components/Ticker.tsx:
    // "Every percentage in it was invented"), and it survived in the one
    // place nobody looked because it only fires when the real data is thin.
    //
    // It also had to go for this fix to be checkable: padding fires exactly
    // when the measurement is weakest, so it would mask the very windows the
    // coverage guards above now decline to report.
    //
    // A window with too little to say renders the ticker's own empty state,
    // which says so in words.
    out[b.key] = picked.map((p) => ({
      // A speciality only reaches here when its parent did not, so the
      // label says which skill it narrows — "Midwifery" alone reads like a
      // peer of Nursing rather than a slice of it.
      name: withParent(p.name),
      tag: "Demand",
      v: p.v,
      spark: sparkFor(p.name),
      // Undefined when too few ads state a salary — the row then renders
      // without a figure rather than with a thin one. It is the same figure
      // in every window on purpose: the median is a LEVEL ("what these
      // roles pay now") while the percentage is a MOVEMENT over the
      // selected window, so rescaling it per window would be asserting a
      // trend nothing measured.
      //
      // Equal-weighted across markets, not pooled across ads: one vote per
      // market that clears the floor on its own. See priceOf.
      pay: priceOf(payByMarket[p.name] ?? new Map(), payAds[p.name] ?? [], true).pay ?? undefined,
    }));
  }
  return out;
}
