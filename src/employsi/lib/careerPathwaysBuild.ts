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
  type PathwayNode,
  type PayFigure,
  type Rung,
} from "./careerLadder";
import { LIVE_FEEDS_ONLY_SQL } from "./jobArchive";
import { employerFamilies } from "./ladderEmployers";
import { annualAud, medianAnnual } from "./salaryParse";
import { parseStoredSkills } from "../data/skillsTaxonomy";
import { CITY_COUNTRY } from "../data/mapboxWorldGeo";

/** A rung with fewer distinct roles than this is not published. Below it, the
 *  titles, skill shares and employer count describe a handful of ads. */
export const MIN_NODE_ROLES = 5;
/** A skill is listed only when this many roles ask for it… */
const MIN_SKILL_ROLES = 3;
/** …and it is at least this share of the node's skill-bearing roles. */
const MIN_SKILL_SHARE = 0.05;
/** A skill is "to gain" when the destination asks for it this much more often. */
const GAIN_THRESHOLD = 0.1;

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
  last_seen: string;
}

/** The newest live-feed day: the window ends here, not at "today". */
export const PATHWAY_END_SQL = `SELECT MAX(last_seen) AS end FROM jobs WHERE ${LIVE_FEEDS_ONLY_SQL}`;

/** One keyset page: ?1 = last rowid read, ?2 = window start. */
export const PATHWAY_PAGE_SQL = `SELECT rowid AS rid, title, company, company_id, hub, source, salary, skills, last_seen
   FROM jobs
  WHERE rowid > ?1 AND last_seen >= ?2 AND ${LIVE_FEEDS_ONLY_SQL}
  ORDER BY rowid LIMIT ${PATHWAY_PAGE}`;

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
  skills: Set<string>;
  pay: number | null;
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
}

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
    const key = employer ? `${employer}|${p.canonical}|${r.hub ?? ""}` : `anon|${r.rid}`;
    const live = r.last_seen >= this.liveFrom;
    const pay = annualAud({ salary: r.salary, hub: r.hub, source: r.source });
    const skills = parseStoredSkills(r.skills);
    const prev = this.roles.get(key);
    if (prev) {
      prev.live ||= live;
      for (const s of skills) prev.skills.add(s);
      prev.pay ??= pay;
    } else {
      this.roles.set(key, {
        node: `${p.family}|${p.track}|${p.rung}`,
        canonical: p.canonical,
        employer,
        country: (r.hub && CITY_COUNTRY[r.hub]) || null,
        live,
        skills: new Set(skills),
        pay,
      });
    }
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
        if (r.skills.size) skillBase++;
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
        skills: [...shares.entries()]
          .filter(([, v]) => v.n >= MIN_SKILL_ROLES && v.share >= MIN_SKILL_SHARE)
          .sort((a, b) => b[1].share - a[1].share)
          .slice(0, 12)
          .map(([s, v]) => [s, Math.round(v.share * 100) / 100] as [string, number]),
        pay,
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
        for (let i = 0; i + 1 < rungs.length; i++) {
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
