/**
 * The D1 job archive → career pathways (src/employsi/data/careerPathways.ts).
 *
 * Every advertised title in the window is placed on a ladder by
 * src/employsi/lib/careerLadder.ts (family × track × rung). Each occupied rung
 * becomes a NODE — demand, employers, real titles, skills, pay — and each step
 * up a ladder an EDGE, carrying what the ads can say about that step.
 *
 * WHAT AN EDGE IS EVIDENCE OF. Read careerLadder.ts's header first. An edge
 * says the next rung exists at real employers (`sharedEmployers`), what it asks
 * for that this one does not (`skillsToGain`), and what it pays relative to
 * this one (`payStep`). It says NOTHING about how many people make the move;
 * the archive has no people in it. The rung order is the rubric's assertion.
 *
 * HOW A ROLE IS COUNTED. The archive's job_key includes the source, so one
 * vacancy on SEEK and on Indeed is two rows (see scripts/source-overlap.py for
 * the measurement). Demand is therefore counted in ROLES: employer + canonical
 * title + hub, with the location's granularity dropped to the hub. Like
 * source-overlap's key this can merge two genuine vacancies with one title at
 * one employer in one city, so `ads` is a floor on vacancies, not a ceiling.
 * Rows with no employer cannot be merged and each counts once.
 *
 * PAY IS NEVER POOLED ACROSS COUNTRIES. annualAud converts to one currency,
 * which makes a Singapore and a Sydney salary comparable as numbers — not as
 * markets. A pooled median is mostly a statement about the country mix. Each
 * country gets its own median, and each is suppressed below MIN_ADS, the same
 * floor the skill card uses.
 *
 * SKILL SHARES ARE OVER ROLES THAT CARRY SKILLS. Several feeds store none; a
 * share over all roles would read "8% ask for Employee Relations" when the
 * truth is "8% of the roles, half of which we cannot see into". `skillBase` is
 * the denominator and is published beside the shares.
 *
 * SKILLS COME FROM TITLES, SO A SKILL GAP IS MOSTLY A TITLE GAP. The archive
 * stores no ad descriptions: `skills` is skillsForText over the title (plus the
 * occupation or category a few gov boards supply, and MyCareersFuture's own
 * skill tags). Within one family that makes `skillsToGain` close to a restating
 * of the rung's title words: the HR tracks and the HR child skills (Talent
 * Acquisition, Employee Relations, L&D…) are read off the same words, so a
 * track edge "gains" its own track's name by construction. It is published because it is what the rows hold, but a real skills gap needs
 * description text, which is a scraper change, not a change here.
 *
 * THE EMPLOYER HINT (src/employsi/lib/ladderEmployers.ts) places store roles
 * whose title names no function — a Coles "Team Member" — using the row's
 * company_id. The report prints how many rows each family gained that way, so
 * a node that is mostly hint-placed is visible as such.
 *
 * THE WINDOW is the last --days days of the archive, ending at the newest
 * last_seen among the live feeds rather than at today — the span actually read,
 * never the one requested (CLAUDE.md). Closed corpora (Wayback) are excluded:
 * a 2011 advertisement is not demand.
 *
 * Env:  CLOUDFLARE_API_TOKEN (D1 read). CLOUDFLARE_ACCOUNT_ID and
 *       JOBS_ARCHIVE_DB_ID default to the production archive.
 * Run:  bun run scripts/gen-career-pathways.ts            # write the data file
 *       bun run scripts/gen-career-pathways.ts --audit    # report only, write nothing
 *       bun run scripts/gen-career-pathways.ts --days 30
 *
 * --audit is the tuning loop for careerLadder.ts: per family, the commonest
 * titles that matched the family's words but were not placed, and the rungs
 * too thin to publish. Read it before trusting a new family.
 */
import { writeFileSync } from "node:fs";
import {
  FAMILIES,
  RUNG_LABEL,
  familyHint,
  placeTitle,
  type CareerPathways,
  type PathwayEdge,
  type PathwayNode,
  type PayFigure,
  type Rung,
} from "../src/employsi/lib/careerLadder";
import { LIVE_FEEDS_ONLY_SQL } from "../src/employsi/lib/jobArchive";
import { employerFamilies } from "../src/employsi/lib/ladderEmployers";
import { annualAud, medianAnnual } from "../src/employsi/lib/salaryParse";
import { parseStoredSkills } from "../src/employsi/data/skillsTaxonomy";
import { CITY_COUNTRY } from "../src/employsi/data/mapboxWorldGeo";

const OUT = "src/employsi/data/careerPathways.ts";

/** A rung with fewer distinct roles than this is not published. Below it, the
 *  titles, skill shares and employer count describe a handful of ads. */
const MIN_NODE_ROLES = 5;
/** A skill is listed only when this many roles ask for it… */
const MIN_SKILL_ROLES = 3;
/** …and it is at least this share of the node's skill-bearing roles. */
const MIN_SKILL_SHARE = 0.05;
/** A skill is "to gain" when the destination asks for it this much more often. */
const GAIN_THRESHOLD = 0.1;

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const AUDIT = args.includes("--audit");
const DAYS = Number(opt("--days") ?? 90);
if (!Number.isFinite(DAYS) || DAYS < 1) throw new Error(`--days must be a positive number`);

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || "080a66721e2d85950d9d7dc939e08b76";
const DB = process.env.JOBS_ARCHIVE_DB_ID || "1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!TOKEN) {
  console.error("✗ CLOUDFLARE_API_TOKEN is not set — this reads the production D1 archive.");
  process.exit(2);
}

async function d1<T>(sql: string, params: (string | number)[] = []): Promise<T[]> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    },
  );
  const json = (await res.json()) as {
    success?: boolean;
    errors?: unknown[];
    result?: { results?: T[] }[];
  };
  if (!json.success) throw new Error(`D1 query failed: ${JSON.stringify(json.errors)}`);
  return json.result?.[0]?.results ?? [];
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---- read ----------------------------------------------------------------

interface Row {
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

const [{ end } = { end: "" }] = await d1<{ end: string }>(
  `SELECT MAX(last_seen) AS end FROM jobs WHERE ${LIVE_FEEDS_ONLY_SQL}`,
);
if (!end) throw new Error("The archive returned no live rows.");
const from = addDays(end, -(DAYS - 1));
const liveFrom = addDays(end, -1); // "currently advertised", as the app defines it

const rows: Row[] = [];
// Keyset pagination on rowid: one response per page stays well inside the
// HTTP API's limits however large the window grows.
for (let after = 0; ;) {
  const page = await d1<Row>(
    `SELECT rowid AS rid, title, company, company_id, hub, source, salary, skills, last_seen
       FROM jobs
      WHERE rowid > ?1 AND last_seen >= ?2 AND ${LIVE_FEEDS_ONLY_SQL}
      ORDER BY rowid LIMIT 5000`,
    [after, from],
  );
  if (!page.length) break;
  rows.push(...page);
  after = page[page.length - 1].rid;
  process.stderr.write(`\r  read ${rows.length.toLocaleString()} rows`);
}
process.stderr.write("\n");

// ---- merge rows into roles -------------------------------------------------

const norm = (s: string | null | undefined) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface Role {
  node: string; // family|track|rung
  canonical: string;
  employer: string;
  country: string | null;
  live: boolean;
  skills: Set<string>;
  pay: number | null;
}

const roles = new Map<string, Role>();
const unplaced = new Map<string, Map<string, number>>(); // family → title → rows
let placedRows = 0;
/** Rows placed only because of who advertised them — family → rows. */
const viaEmployer = new Map<string, number>();
let hintedRows = 0;
/** Per family: rows placed, and rows naming it that got no rung — the audit's
 *  placement share. A row counts toward the family that PLACED it, else the
 *  one its words name, so no row is counted twice. */
const placedBy = new Map<string, number>();
const missedBy = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

for (const r of rows) {
  const p = placeTitle(r.title, { employerFamilies: employerFamilies(r.company_id) });
  if (!p) {
    const hint = familyHint(r.title);
    if (hint) {
      hintedRows++;
      bump(missedBy, hint);
      const m = unplaced.get(hint) ?? new Map<string, number>();
      const t = r.title.trim();
      m.set(t, (m.get(t) ?? 0) + 1);
      unplaced.set(hint, m);
    }
    continue;
  }
  placedRows++;
  hintedRows++;
  bump(placedBy, p.family);
  if (p.via === "employer") viaEmployer.set(p.family, (viaEmployer.get(p.family) ?? 0) + 1);
  const employer = r.company_id || norm(r.company);
  const key = employer ? `${employer}|${p.canonical}|${r.hub ?? ""}` : `anon|${r.rid}`; // cannot be merged with anything honestly
  const node = `${p.family}|${p.track}|${p.rung}`;
  const pay = annualAud({ salary: r.salary, hub: r.hub, source: r.source });
  const skills = parseStoredSkills(r.skills);
  const prev = roles.get(key);
  if (prev) {
    prev.live ||= r.last_seen >= liveFrom;
    for (const s of skills) prev.skills.add(s);
    prev.pay ??= pay;
  } else {
    roles.set(key, {
      node,
      canonical: p.canonical,
      employer,
      country: (r.hub && CITY_COUNTRY[r.hub]) || null,
      live: r.last_seen >= liveFrom,
      skills: new Set(skills),
      pay,
    });
  }
}

// ---- nodes -----------------------------------------------------------------

const byNode = new Map<string, Role[]>();
for (const role of roles.values()) {
  const list = byNode.get(role.node) ?? [];
  list.push(role);
  byNode.set(role.node, list);
}

const topN = <K>(m: Map<K, number>, n: number): [K, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/** Full skill-share map for a node, used by the edges; the node publishes the top. */
const skillShares = new Map<string, Map<string, { share: number; n: number }>>();
const employersOf = new Map<string, Set<string>>();
const payOf = new Map<string, Record<string, PayFigure>>();

const nodes: PathwayNode[] = [];
const thin: string[] = [];
for (const [key, list] of byNode) {
  const [family, track, rungS] = key.split("|");
  const rung = Number(rungS) as Rung;
  if (list.length < MIN_NODE_ROLES) {
    thin.push(`${key} (${list.length})`);
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
    titles.set(r.canonical, (titles.get(r.canonical) ?? 0) + 1);
    if (r.live && r.country) byCountry[r.country] = (byCountry[r.country] ?? 0) + 1;
    if (r.skills.size) skillBase++;
    for (const s of r.skills) skillCount.set(s, (skillCount.get(s) ?? 0) + 1);
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

// ---- edges -----------------------------------------------------------------

function edge(
  family: string,
  a: { track: string; rung: Rung },
  b: { track: string; rung: Rung },
  kind: PathwayEdge["kind"],
): PathwayEdge {
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
}

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
  // Acquisition Partner → Head of HR: a three-band jump nobody makes, invented
  // by a suppression. A track without its own manager rung gets no edge.
  if (f.convergeAt) {
    const from = (f.convergeAt - 1) as Rung;
    const gen = tracks.get("generalist") ?? [];
    for (const [track, rungs] of tracks) {
      if (track === "generalist" || !rungs.includes(from) || !gen.includes(f.convergeAt)) continue;
      edges.push(
        edge(f.id, { track, rung: from }, { track: "generalist", rung: f.convergeAt }, "converge"),
      );
    }
  }
}

// ---- report ----------------------------------------------------------------

console.log(
  `\nWindow ${from} → ${end} (${DAYS} days), ${rows.length.toLocaleString()} live-feed rows.`,
);
console.log(
  `Placed ${placedRows.toLocaleString()} rows (${((placedRows / rows.length) * 100).toFixed(1)}% of all) → ` +
    `${roles.size.toLocaleString()} distinct roles. Of rows naming a modelled family, ` +
    `${((placedRows / Math.max(hintedRows, 1)) * 100).toFixed(1)}% were placed.`,
);
for (const f of FAMILIES) {
  const ns = nodes.filter((n) => n.family === f.id);
  const hinted = viaEmployer.get(f.id);
  const got = placedBy.get(f.id) ?? 0;
  const missed = missedBy.get(f.id) ?? 0;
  console.log(
    `\n${f.label}  — ${got.toLocaleString()} rows placed, ${missed.toLocaleString()} unplaced ` +
      `(${((got / Math.max(got + missed, 1)) * 100).toFixed(1)}% placed)` +
      (hinted
        ? `  (${hinted.toLocaleString()} rows placed by the employer hint, not the title)`
        : ""),
  );
  for (const n of ns) {
    const au = n.pay.au?.median
      ? ` · AU median $${Math.round(n.pay.au.median / 1000)}k (n=${n.pay.au.n})`
      : "";
    console.log(
      `  ${n.track.padEnd(20)} ${String(n.rung)} ${RUNG_LABEL[n.rung].padEnd(17)} ` +
        `${String(n.ads).padStart(6)} roles ${String(n.live).padStart(6)} live ${String(n.employers).padStart(5)} employers${au}` +
        `   e.g. ${n.titles
          .slice(0, 3)
          .map((t) => t[0])
          .join(" / ")}`,
    );
  }
  if (AUDIT) {
    // Pay should rise up a track. A fall is either a real market quirk or a
    // rung rule putting cheaper roles above dearer ones — worth a look, not
    // proof. Per country, only between published medians.
    for (const track of new Set(ns.map((n) => n.track))) {
      const up = ns.filter((n) => n.track === track).sort((a, b) => a.rung - b.rung);
      for (const cc of new Set(up.flatMap((n) => Object.keys(n.pay)))) {
        let prev: PathwayNode | null = null;
        for (const n of up) {
          const m = n.pay[cc]?.median;
          if (m == null) continue;
          const pm = prev?.pay[cc]?.median;
          if (prev && pm != null && m < pm)
            console.log(
              `  ! pay falls on ${track}: ${cc.toUpperCase()} rung ${prev.rung} $${Math.round(pm / 1000)}k → ` +
                `rung ${n.rung} $${Math.round(m / 1000)}k`,
            );
          prev = n;
        }
      }
    }
    const miss = topN(unplaced.get(f.id) ?? new Map<string, number>(), 25);
    if (miss.length) {
      console.log(`  — unplaced titles naming this family (commonest first):`);
      for (const [t, n] of miss) console.log(`      ${String(n).padStart(5)}  ${t}`);
    }
  }
}
if (AUDIT && thin.length)
  console.log(`\nRungs below ${MIN_NODE_ROLES} roles, not published:\n  ${thin.join("\n  ")}`);

if (AUDIT) {
  console.log("\n--audit: nothing written.");
  process.exit(0);
}

// ---- write -----------------------------------------------------------------

const data: CareerPathways = {
  generated: new Date().toISOString().slice(0, 10),
  window: { from, to: end },
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
};

const body = `// GENERATED — do not edit by hand. Rewritten by scripts/gen-career-pathways.ts
// from the D1 job archive, ${from} → ${end} (live feeds only).
//
// Nodes are rungs of a career ladder with the demand, titles, skills and pay
// the ads show. Edges are steps up a ladder: the rung ORDER is asserted by
// src/employsi/lib/careerLadder.ts, and nothing here measures how many people
// make a move — the archive holds job ads, not careers.
import type { CareerPathways } from "../lib/careerLadder";

export const CAREER_PATHWAYS: CareerPathways = {
  generated: ${JSON.stringify(data.generated)},
  window: ${JSON.stringify(data.window)},
  families: [
${data.families.map((f) => `    ${JSON.stringify(f)},`).join("\n")}
  ],
  nodes: [
${data.nodes.map((n) => `    ${JSON.stringify(n)},`).join("\n")}
  ],
  edges: [
${data.edges.map((e) => `    ${JSON.stringify(e)},`).join("\n")}
  ],
};
`;
writeFileSync(OUT, body);
console.log(`\n✓ wrote ${OUT}: ${nodes.length} rungs, ${edges.length} steps.`);
