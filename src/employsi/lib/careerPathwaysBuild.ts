/**
 * Archive rows → career pathways (nodes + edges). The ONE implementation,
 * shared by scripts/gen-career-pathways.ts (the audit, and the local run over
 * the D1 HTTP API) and the scraper Worker's nightly KV write (over the D1
 * binding) — so the audit a person reads describes exactly what the Worker
 * publishes. Same reason placeTitle and skillsForText are single functions.
 *
 * Read the header of scripts/gen-career-pathways.ts for WHAT the output is
 * evidence of (ads, not careers), how a role is counted, and why pay is never
 * pooled across countries. This file is the mechanics.
 *
 * STREAMING, BECAUSE OF THE WORKER. 90 days is ~350k rows (measured
 * 2026-09-24). Held as objects that is well past a Worker's 128 MB, so rows are
 * fed one page at a time through `add` and only the merged ROLES are kept
 * (~35k). Nothing here may hold a reference to a row after `add` returns.
 */
import {
  FAMILIES,
  familyHint,
  placeTitle,
  type CareerPathways,
  type PathwayEdge,
  type PathwayMarket,
  type PathwayNode,
  type PayFigure,
  type Rung,
} from "./careerLadder";
import { LIVE_FEEDS_ONLY_SQL } from "./jobArchive";
import { employerFamilies } from "./ladderEmployers";
import { annualAud, medianAnnual } from "./salaryParse";
import { ALL_SKILLS, parseStoredSkills } from "../data/skillsTaxonomy";
import { CITY_COUNTRY } from "../data/mapboxWorldGeo";
import { coverageDay, coveredFrom, FEED_LOOKBACK_DAYS, MAX_STEP_BACK_DAYS } from "./feedCoverage";

/** A rung with fewer distinct roles than this is not published. Below it, the
 *  titles, skill shares and employer count describe a handful of ads. */
export const MIN_NODE_ROLES = 5;
/** A skill is listed only when this many roles ask for it… */
const MIN_SKILL_ROLES = 3;
/** …and it is at least this share of the node's skill-bearing roles. */
const MIN_SKILL_SHARE = 0.05;
/** A skill is "to gain" when the destination asks for it this much more often. */
const GAIN_THRESHOLD = 0.1;

/** A market's daily series is published only over at least this many covered
 *  days. Fewer, and the line is the archive's age rather than demand; 14 also
 *  gives each half of the trend a full weekly posting cycle (see `trend`). */
export const SERIES_MIN_DAYS = 14;
/** A duration median, like a pay median, needs this many closed ads. */
const MIN_DURATION_ROLES = 8;
/** Cities listed per market — the hotspot map's pins and bars. */
const MAX_HUBS = 10;

/** The default window, in days, ending at the archive's newest live row. */
export const PATHWAY_DAYS = 90;
/** Rows per D1 page. One response per page stays well inside the API limits. */
export const PATHWAY_PAGE = 5000;

/** KV key the scraper Worker writes and the app reads. */
export const CAREER_PATHWAYS_KV_KEY = "careerpaths";

export interface PathwayRow {
  rid: number;
  title: string;
  company: string | null;
  company_id: string | null;
  hub: string | null;
  source: string | null;
  salary: string | null;
  skills: string | null;
  first_seen: string | null;
  last_seen: string;
}

/** The newest live-feed day: the window ends here, not at "today". */
export const PATHWAY_END_SQL = `SELECT MAX(last_seen) AS end FROM jobs WHERE ${LIVE_FEEDS_ONLY_SQL}`;

/** One keyset page: ?1 = last rowid read, ?2 = window start. */
export const PATHWAY_PAGE_SQL = `SELECT rowid AS rid, title, company, company_id, hub, source, salary, skills, first_seen, last_seen
   FROM jobs
  WHERE rowid > ?1 AND last_seen >= ?2 AND ${LIVE_FEEDS_ONLY_SQL}
  ORDER BY rowid LIMIT ${PATHWAY_PAGE}`;

/** ISO day ⇄ whole days since the epoch — spans are kept as numbers because
 *  there is one per row per role, and the Worker's memory is the limit. */
const dayNum = (iso: string): number =>
  Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 864e5);
const dayIso = (n: number): string => new Date(n * 864e5).toISOString().slice(0, 10);

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Read the window page by page through `query` (the D1 binding or the HTTP
 * API — whichever the caller has) and build the pathways. `onPage` sees each
 * page's timing, for the caller to log.
 */
export async function buildPathwaysFromArchive(
  query: <T>(sql: string, params: (string | number)[]) => Promise<T[]>,
  opts: {
    days?: number;
    audit?: boolean;
    onPage?: (p: { page: number; rows: number; total: number; ms: number }) => void;
  } = {},
): Promise<{ pathways: CareerPathways; audit: PathwayAudit; rows: number }> {
  const days = opts.days ?? PATHWAY_DAYS;
  const [{ end } = { end: "" }] = await query<{ end: string }>(PATHWAY_END_SQL, []);
  if (!end) throw new Error("The archive returned no live rows.");
  const from = addDays(end, -(days - 1));
  const b = new PathwayBuilder(addDays(end, -1), opts.audit ?? false);
  let total = 0;
  for (let after = 0, page = 0; ; page++) {
    const t0 = Date.now();
    const rows = await query<PathwayRow>(PATHWAY_PAGE_SQL, [after, from]);
    if (!rows.length) break;
    for (const r of rows) b.add(r);
    total += rows.length;
    after = rows[rows.length - 1].rid;
    opts.onPage?.({ page, rows: rows.length, total, ms: Date.now() - t0 });
  }
  const { pathways, audit } = b.finish({ from, to: end });
  return { pathways, audit, rows: total };
}

interface Role {
  node: string; // family|track|rung
  canonical: string;
  employer: string;
  country: string | null;
  live: boolean;
  hub: string | null;
  /** Interned names, deduplicated on add — an array, not a Set: a Set per
   *  role cost more than the skills in it at ~100k roles. */
  skills: string[];
  pay: number | null;
  /** Earliest first_seen / latest last_seen across the role's rows, as day numbers. */
  first: number;
  last: number;
  /** Every row's [first_seen, last_seen], flat. Kept apart rather than
   *  flattened to first/last: a role one board dropped and another re-listed
   *  weeks later was not open in between — the same rule as the company
   *  card's vacancy chart (RoleGroup.spans in jobHistoryFn). */
  spans: number[];
}

/** One feed's footprint in one node × country: its earliest first_seen and
 *  latest last_seen (day numbers) and its RAW row count — the inputs to the
 *  feed-coverage rules, which weigh feeds by rows, not by merged roles. */
interface FeedFoot {
  start: number;
  mx: number;
  n: number;
}

/** What the --audit report prints. Collected only when asked for. */
export interface PathwayAudit {
  rows: number;
  placedRows: number;
  /** Rows whose words name a modelled family (placed or not). */
  hintedRows: number;
  roles: number;
  /** Per family: rows placed, rows its words name that got no rung. */
  placedBy: Map<string, number>;
  missedBy: Map<string, number>;
  /** Rows placed only because of who advertised them — family → rows. */
  viaEmployer: Map<string, number>;
  /** family → unplaced title → rows. Empty unless audit was requested. */
  unplaced: Map<string, Map<string, number>>;
  /** Rungs below MIN_NODE_ROLES, "family|track|rung (n)". */
  thin: string[];
  /** Per PARENT skill: rows carrying it, and how many were placed on any
   *  ladder. Audit only. The coverage question "does every parent skill have
   *  a pathway" asked of the rows rather than of the rules. */
  bySkill: Map<string, { rows: number; placed: number }>;
}

const PARENTS = new Set(ALL_SKILLS);

const norm = (s: string | null | undefined) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

const topN = <K>(m: Map<K, number>, n: number): [K, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

export class PathwayBuilder {
  private roles = new Map<string, Role>();
  /** "family|track|rung|country" → source → footprint. */
  private feeds = new Map<string, Map<string, FeedFoot>>();
  /**
   * One copy of every repeated string. Each row arrives with fresh copies of
   * its employer, city and skill names, and placeTitle builds a fresh
   * canonical title per call; kept per role, those copies were most of the
   * builder's memory — 112 MB peak over 359k rows (measured 2026-09-25)
   * against the Worker's 128 MB.
   */
  private strings = new Map<string, string>();
  private ids = new Map<string, number>();
  private id = (x: string): number => {
    let n = this.ids.get(x);
    if (n === undefined) this.ids.set(x, (n = this.ids.size));
    return n;
  };
  private intern = (x: string): string => {
    const hit = this.strings.get(x);
    if (hit !== undefined) return hit;
    this.strings.set(x, x);
    return x;
  };
  private a: PathwayAudit = {
    rows: 0,
    placedRows: 0,
    hintedRows: 0,
    roles: 0,
    placedBy: new Map(),
    missedBy: new Map(),
    viaEmployer: new Map(),
    unplaced: new Map(),
    thin: [],
    bySkill: new Map(),
  };

  /**
   * @param liveFrom rows seen on or after this day are "currently advertised"
   *                 (the app's definition: the window's last two days).
   * @param keepUnplaced collect unplaced titles for the audit — a map of every
   *                 distinct unplaced title, so off in the Worker.
   */
  constructor(
    private liveFrom: string,
    private keepUnplaced = false,
  ) {}

  add(r: PathwayRow): void {
    const a = this.a;
    a.rows++;
    const p = placeTitle(r.title, { employerFamilies: employerFamilies(r.company_id) });
    if (this.keepUnplaced) {
      for (const s of parseStoredSkills(r.skills)) {
        if (!PARENTS.has(s)) continue;
        const c = a.bySkill.get(s) ?? { rows: 0, placed: 0 };
        c.rows++;
        if (p) c.placed++;
        a.bySkill.set(s, c);
      }
    }
    if (!p) {
      const hint = familyHint(r.title);
      if (hint) {
        a.hintedRows++;
        bump(a.missedBy, hint);
        if (this.keepUnplaced) {
          const m = a.unplaced.get(hint) ?? new Map<string, number>();
          bump(m, r.title.trim());
          a.unplaced.set(hint, m);
        }
      }
      return;
    }
    a.placedRows++;
    a.hintedRows++;
    bump(a.placedBy, p.family);
    if (p.via === "employer") bump(a.viaEmployer, p.family);
    const employer = r.company_id || norm(r.company);
    // A row with no employer cannot be merged with anything honestly.
    // Keyed by the interned strings' ids, not the strings: one key per role,
    // and "melbourne-col|registered nurse|melbourne" is 40 bytes where
    // "812|3301|4" is 10.
    const key = employer
      ? `${this.id(employer)}|${this.id(p.canonical)}|${this.id(r.hub ?? "")}`
      : `anon|${r.rid}`;
    const live = r.last_seen >= this.liveFrom;
    const pay = annualAud({ salary: r.salary, hub: r.hub, source: r.source });
    const skills = parseStoredSkills(r.skills).map(this.intern);
    const node = this.intern(`${p.family}|${p.track}|${p.rung}`);
    const country = (r.hub && CITY_COUNTRY[r.hub]) || null;
    const last = dayNum(r.last_seen);
    // A row without first_seen is a row the archive wrote before it kept one;
    // its last sighting is the only day it is known to have been open.
    const first = r.first_seen ? Math.min(dayNum(r.first_seen), last) : last;

    // Feed footprints are measured on RAW rows, before the merge — they are a
    // fact about the feed, not about roles. See foldSkillRows' sourceStart.
    if (country) {
      const fk = `${node}|${country}`;
      let fm = this.feeds.get(fk);
      if (!fm) this.feeds.set(fk, (fm = new Map()));
      const src = r.source || "";
      const f = fm.get(src);
      if (!f) fm.set(src, { start: first, mx: last, n: 1 });
      else {
        f.n++;
        if (first < f.start) f.start = first;
        if (last > f.mx) f.mx = last;
      }
    }

    const prev = this.roles.get(key);
    if (prev) {
      prev.live ||= live;
      for (const s of skills) if (!prev.skills.includes(s)) prev.skills.push(s);
      prev.pay ??= pay;
      if (first < prev.first) prev.first = first;
      if (last > prev.last) prev.last = last;
      prev.spans.push(first, last);
    } else {
      this.roles.set(key, {
        node,
        canonical: this.intern(p.canonical),
        employer: this.intern(employer),
        country,
        hub: r.hub === null ? null : this.intern(r.hub),
        live,
        skills: [...new Set(skills)],
        pay,
        first,
        last,
        spans: [first, last],
      });
    }
  }

  /**
   * One rung in one country: the figures the career card draws. Every series
   * here is bounded at BOTH ends by the feed-coverage rules, because a series
   * over this archive that is not is the most productive bug in the codebase
   * (see CLAUDE.md, "A window over the archive is only as wide as the feeds
   * covering it"):
   *
   *   start — coveredFrom over this rung's own feeds in this country, so a
   *           board that began carrying these roles mid-window does not draw
   *           its arrival as hiring;
   *   end   — the day before the archive's newest, stepped back by
   *           coverageDay (at most MAX_STEP_BACK_DAYS) where the feeds
   *           carrying these roles have not reported it yet.
   *
   * Each day is counted the same way — a role is advertised on D when one of
   * its rows spans D — so the trend compares like with like.
   */
  private market(
    roles: Role[],
    feeds: Map<string, FeedFoot> | undefined,
    listed: [string, number][],
    window: { from: string; to: string },
  ): PathwayMarket {
    const fromN = dayNum(window.from);
    const endN = dayNum(window.to);

    const starts: Record<string, string> = {};
    const rowsBy: Record<string, number> = {};
    const alive: { mx: string; n: number }[] = [];
    for (const [src, f] of feeds ?? []) {
      starts[src] = dayIso(f.start);
      rowsBy[src] = f.n;
      if (f.mx >= endN - FEED_LOOKBACK_DAYS) alive.push({ mx: dayIso(f.mx), n: f.n });
    }
    const covered = coveredFrom(starts, rowsBy);
    const start = Math.max(fromN, covered ? dayNum(covered) : fromN);
    let to = endN - 1;
    const cov = coverageDay(alive);
    if (cov && dayNum(cov) < to) to = Math.max(dayNum(cov), to - MAX_STEP_BACK_DAYS);

    let series: PathwayMarket["series"] = null;
    let trend: PathwayMarket["trend"] = null;
    const len = to - start + 1;
    if (len >= SERIES_MIN_DAYS) {
      const diff = new Array<number>(len + 1).fill(0);
      for (const r of roles) {
        // Merge the role's own spans first, so two boards carrying it on the
        // same day count it once.
        const sp: [number, number][] = [];
        for (let i = 0; i < r.spans.length; i += 2) sp.push([r.spans[i], r.spans[i + 1]]);
        sp.sort((x, y) => x[0] - y[0]);
        let [a, b] = sp[0];
        const flush = () => {
          const lo = Math.max(a, start);
          const hi = Math.min(b, to);
          if (lo <= hi) {
            diff[lo - start]++;
            diff[hi - start + 1]--;
          }
        };
        for (const [x, y] of sp.slice(1)) {
          if (x <= b + 1) b = Math.max(b, y);
          else {
            flush();
            [a, b] = [x, y];
          }
        }
        flush();
      }
      const counts: number[] = [];
      for (let i = 0, run = 0; i < len; i++) counts.push((run += diff[i]));
      series = { from: dayIso(start), to: dayIso(to), counts };

      // Mean of the newer half against the older half — halfWindowChange's
      // construction, so one heavy posting day cannot swing it — and only
      // when the older half averages a publishable rung's worth of roles.
      const half = Math.floor(len / 2);
      const mean = (xs: number[]) => xs.reduce((t, v) => t + v, 0) / xs.length;
      const before = mean(counts.slice(0, half));
      const after = mean(counts.slice(len - half));
      if (before >= MIN_NODE_ROLES)
        trend = { pct: Math.round(((after - before) / before) * 100), days: len };
    }

    // How long an ad stayed up, over the roles that came down inside the
    // covered span. Opened before `start`, and the opening day may be a feed's
    // arrival rather than the ad's; still up, and the length is not known yet.
    // So this undercounts long ads — it is "days advertised", never "days to
    // fill": nothing in the archive says an ad came down because it was filled.
    const durations: number[] = [];
    for (const r of roles) {
      if (r.live || r.first < start || r.last > to) continue;
      durations.push(r.last - r.first + 1);
    }
    durations.sort((x, y) => x - y);
    const mid = durations.length >> 1;
    const median =
      durations.length < MIN_DURATION_ROLES
        ? null
        : durations.length % 2
          ? durations[mid]
          : Math.round((durations[mid - 1] + durations[mid]) / 2);

    const hubs = new Map<string, number>();
    const skillLive: Record<string, number> = {};
    const employers = new Set<string>();
    let live = 0;
    for (const r of roles) {
      if (r.employer) employers.add(r.employer);
      if (!r.live) continue;
      live++;
      if (r.hub) bump(hubs, r.hub);
      for (const [s] of listed) if (r.skills.includes(s)) skillLive[s] = (skillLive[s] ?? 0) + 1;
    }

    return {
      roles: roles.length,
      live,
      employers: employers.size,
      series,
      trend,
      daysAdvertised: { median, n: durations.length },
      hubs: topN(hubs, MAX_HUBS),
      skillLive,
    };
  }

  finish(window: { from: string; to: string }): {
    pathways: CareerPathways;
    audit: PathwayAudit;
  } {
    this.a.roles = this.roles.size;
    const byNode = new Map<string, Role[]>();
    for (const role of this.roles.values()) {
      const list = byNode.get(role.node) ?? [];
      list.push(role);
      byNode.set(role.node, list);
    }

    // Full skill-share map per node, used by the edges; the node publishes the top.
    const skillShares = new Map<string, Map<string, { share: number; n: number }>>();
    const employersOf = new Map<string, Set<string>>();
    const payOf = new Map<string, Record<string, PayFigure>>();

    const nodes: PathwayNode[] = [];
    for (const [key, list] of byNode) {
      const [family, track, rungS] = key.split("|");
      const rung = Number(rungS) as Rung;
      if (list.length < MIN_NODE_ROLES) {
        this.a.thin.push(`${key} (${list.length})`);
        continue;
      }

      const employers = new Set(list.map((r) => r.employer).filter(Boolean));
      employersOf.set(key, employers);

      const titles = new Map<string, number>();
      const byCountry: Record<string, number> = {};
      const skillCount = new Map<string, number>();
      const payByCountry = new Map<string, number[]>();
      let skillBase = 0;
      for (const r of list) {
        bump(titles, r.canonical);
        if (r.live && r.country) byCountry[r.country] = (byCountry[r.country] ?? 0) + 1;
        if (r.skills.length) skillBase++;
        for (const s of r.skills) bump(skillCount, s);
        if (r.pay != null && r.country) {
          const v = payByCountry.get(r.country) ?? [];
          v.push(r.pay);
          payByCountry.set(r.country, v);
        }
      }

      const shares = new Map<string, { share: number; n: number }>();
      for (const [s, n] of skillCount) if (skillBase) shares.set(s, { share: n / skillBase, n });
      skillShares.set(key, shares);

      const pay: Record<string, PayFigure> = {};
      for (const [c, v] of payByCountry) pay[c] = { median: medianAnnual(v), n: v.length };
      payOf.set(key, pay);

      const listed = [...shares.entries()]
        .filter(([, v]) => v.n >= MIN_SKILL_ROLES && v.share >= MIN_SKILL_SHARE)
        .sort((a, b) => b[1].share - a[1].share)
        .slice(0, 12)
        .map(([s, v]) => [s, Math.round(v.share * 100) / 100] as [string, number]);

      const byMarket = new Map<string, Role[]>();
      for (const r of list) {
        if (!r.country) continue;
        const m = byMarket.get(r.country) ?? [];
        m.push(r);
        byMarket.set(r.country, m);
      }
      const markets: Record<string, PathwayMarket> = {};
      for (const [c, roles] of byMarket) {
        if (roles.length < MIN_NODE_ROLES) continue;
        markets[c] = this.market(roles, this.feeds.get(`${key}|${c}`), listed, window);
      }

      nodes.push({
        family,
        track,
        rung,
        ads: list.length,
        live: list.filter((r) => r.live).length,
        employers: employers.size,
        byCountry,
        titles: topN(titles, 8),
        skillBase,
        skills: listed,
        pay,
        markets,
      });
    }
    const FAMILY_ORDER = FAMILIES.map((f) => f.id);
    nodes.sort(
      (a, b) =>
        FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) ||
        a.track.localeCompare(b.track) ||
        a.rung - b.rung,
    );

    const edge = (
      family: string,
      a: { track: string; rung: Rung },
      b: { track: string; rung: Rung },
      kind: PathwayEdge["kind"],
    ): PathwayEdge => {
      const ka = `${family}|${a.track}|${a.rung}`;
      const kb = `${family}|${b.track}|${b.rung}`;
      const ea = employersOf.get(ka) ?? new Set<string>();
      const eb = employersOf.get(kb) ?? new Set<string>();
      const sa = skillShares.get(ka) ?? new Map<string, { share: number; n: number }>();
      const sb = skillShares.get(kb) ?? new Map<string, { share: number; n: number }>();

      let lo = 0;
      let hi = 0;
      for (const s of new Set([...sa.keys(), ...sb.keys()])) {
        const x = sa.get(s)?.share ?? 0;
        const y = sb.get(s)?.share ?? 0;
        lo += Math.min(x, y);
        hi += Math.max(x, y);
      }

      const gain: [string, number][] = [...sb.entries()]
        .filter(
          ([s, v]) => v.n >= MIN_SKILL_ROLES && v.share - (sa.get(s)?.share ?? 0) >= GAIN_THRESHOLD,
        )
        .map(
          ([s, v]) =>
            [s, Math.round((v.share - (sa.get(s)?.share ?? 0)) * 100) / 100] as [string, number],
        )
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5);

      const payStep: Record<string, number> = {};
      const pa = payOf.get(ka) ?? {};
      const pb = payOf.get(kb) ?? {};
      for (const c of Object.keys(pa)) {
        const x = pa[c]?.median;
        const y = pb[c]?.median;
        if (x && y) payStep[c] = Math.round((y / x) * 100) / 100;
      }

      return {
        family,
        from: a,
        to: b,
        kind,
        sharedEmployers: [...ea].filter((e) => eb.has(e)).length,
        skillOverlap: hi ? Math.round((lo / hi) * 100) / 100 : 0,
        skillsToGain: gain,
        payStep,
      };
    };

    const edges: PathwayEdge[] = [];
    for (const f of FAMILIES) {
      const tracks = new Map<string, Rung[]>();
      for (const n of nodes.filter((x) => x.family === f.id)) {
        tracks.set(n.track, [...(tracks.get(n.track) ?? []), n.rung]);
      }
      for (const [track, rungs] of tracks) {
        rungs.sort((a, b) => a - b);
        // Adjacent rungs only. A middle rung too thin to publish (under
        // MIN_NODE_ROLES) used to leave its neighbours joined directly —
        // Banking advice 2→4, Facilities 1→3 on the first full build — which
        // is the same suppression-invented jump the convergeAt rule below
        // refuses. A gap in the ladder stays a gap.
        for (let i = 0; i + 1 < rungs.length; i++) {
          if (rungs[i + 1] !== rungs[i] + 1) continue;
          edges.push(edge(f.id, { track, rung: rungs[i] }, { track, rung: rungs[i + 1] }, "step"));
        }
      }
      // Specialist tracks rejoin the generalist ladder from the rung just below
      // convergeAt — ER Manager → Head of HR — and ONLY from there. "The track's
      // highest published rung" was the first rule, and on a stub where Talent
      // Acquisition's upper rungs were too thin to publish it drew Talent
      // Acquisition Partner → Head of HR: a three-band jump nobody makes,
      // invented by a suppression. A track without its own manager rung gets no
      // edge.
      if (f.convergeAt) {
        const from = (f.convergeAt - 1) as Rung;
        const gen = tracks.get("generalist") ?? [];
        for (const [track, rungs] of tracks) {
          if (track === "generalist" || !rungs.includes(from) || !gen.includes(f.convergeAt))
            continue;
          edges.push(
            edge(
              f.id,
              { track, rung: from },
              { track: "generalist", rung: f.convergeAt },
              "converge",
            ),
          );
        }
      }
    }

    return {
      pathways: {
        generated: new Date().toISOString().slice(0, 10),
        window,
        families: FAMILIES.map((f) => ({
          id: f.id,
          label: f.label,
          tracks: [
            { id: "generalist", label: "Generalist" },
            ...(f.tracks ?? []).map((t) => ({ id: t.id, label: t.label })),
          ],
        })),
        nodes,
        edges,
      },
      audit: this.a,
    };
  }
}
