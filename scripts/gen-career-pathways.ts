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
 *
 * THE BUILD ITSELF is src/employsi/lib/careerPathwaysBuild.ts, shared with the
 * scraper Worker's nightly KV write, so this audit describes exactly what the
 * Worker publishes. This script is the D1-over-HTTP reader, the report and the
 * static file.
 */
import { writeFileSync } from "node:fs";
import {
  FAMILIES,
  NOT_A_LADDER,
  PATHWAYS_PLANNED,
  RUNG_LABEL,
  type PathwayNode,
} from "../src/employsi/lib/careerLadder";
import {
  MIN_NODE_ROLES,
  PATHWAY_DAYS,
  buildPathwaysFromArchive,
} from "../src/employsi/lib/careerPathwaysBuild";

const OUT = "src/employsi/data/careerPathways.ts";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const AUDIT = args.includes("--audit");
const DAYS = Number(opt("--days") ?? PATHWAY_DAYS);
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

const { pathways: data, audit: a } = await buildPathwaysFromArchive(d1, {
  days: DAYS,
  audit: AUDIT,
  onPage: ({ total }) => process.stderr.write(`\r  read ${total.toLocaleString()} rows`),
});
process.stderr.write("\n");
const { nodes, edges, window } = data;

// ---- report ----------------------------------------------------------------

const topN = <K>(m: Map<K, number>, n: number): [K, number][] =>
  [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, n);

console.log(
  `\nWindow ${window.from} → ${window.to} (${DAYS} days), ${a.rows.toLocaleString()} live-feed rows.`,
);
console.log(
  `Placed ${a.placedRows.toLocaleString()} rows (${((a.placedRows / a.rows) * 100).toFixed(1)}% of all) → ` +
    `${a.roles.toLocaleString()} distinct roles. Of rows naming a modelled family, ` +
    `${((a.placedRows / Math.max(a.hintedRows, 1)) * 100).toFixed(1)}% were placed.`,
);
for (const f of FAMILIES) {
  const ns = nodes.filter((n) => n.family === f.id);
  const hinted = a.viaEmployer.get(f.id);
  const got = a.placedBy.get(f.id) ?? 0;
  const missed = a.missedBy.get(f.id) ?? 0;
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
      const up = ns.filter((n) => n.track === track).sort((x, y) => x.rung - y.rung);
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
    const miss = topN(a.unplaced.get(f.id) ?? new Map<string, number>(), 25);
    if (miss.length) {
      console.log(`  — unplaced titles naming this family (commonest first):`);
      for (const [t, n] of miss) console.log(`      ${String(n).padStart(5)}  ${t}`);
    }
  }
}
if (AUDIT && a.thin.length)
  console.log(`\nRungs below ${MIN_NODE_ROLES} roles, not published:\n  ${a.thin.join("\n  ")}`);

if (AUDIT) {
  // Coverage by PARENT SKILL: which family claims it, and what share of the
  // rows carrying it landed on a ladder. Skill tags come partly from a board's
  // own category, so a low share is not always a rule gap — read the titles.
  const owner = new Map<string, string>();
  for (const f of FAMILIES)
    for (const sk of f.skills ?? [])
      owner.set(sk, (owner.has(sk) ? owner.get(sk) + "+" : "") + f.id);
  console.log("\nParent skills — rows carrying the skill, share placed on any ladder:");
  for (const [sk, c] of [...a.bySkill].sort((x, y) => y[1].rows - x[1].rows)) {
    const who =
      owner.get(sk) ??
      (sk in NOT_A_LADDER
        ? "(not a ladder)"
        : PATHWAYS_PLANNED.includes(sk)
          ? "(planned)"
          : "(UNDECIDED)");
    console.log(
      `  ${String(c.rows).padStart(6)}  ${String(Math.round((c.placed / c.rows) * 100)).padStart(3)}%  ${sk.padEnd(34)} ${who}`,
    );
  }
  console.log("\n--audit: nothing written.");
  process.exit(0);
}

// ---- write -----------------------------------------------------------------

const body = `// GENERATED — do not edit by hand. Rewritten by scripts/gen-career-pathways.ts
// from the D1 job archive, ${window.from} → ${window.to} (live feeds only).
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
${nodes.map((n) => `    ${JSON.stringify(n)},`).join("\n")}
  ],
  edges: [
${edges.map((e) => `    ${JSON.stringify(e)},`).join("\n")}
  ],
};
`;
writeFileSync(OUT, body);
console.log(`\n✓ wrote ${OUT}: ${nodes.length} rungs, ${edges.length} steps.`);
