#!/usr/bin/env bun
/**
 * Propose a career rung for every Hays Salary Guide role, for review.
 *
 * Run: bun run scripts/review-hays-roles.ts > scripts/hays-role-review.tsv
 *
 * THIS PROPOSES. IT DOES NOT DECIDE. The reviewed file is the mapping, exactly
 * as gen-onet-roles.py's TABLE is — and that precedent is why this exists at
 * all rather than a matcher wired straight into a generator: a third of what
 * ITS title matcher found was wrong, and "chief people officer" matching
 * Probation Officers is the kind of wrong that looks completely fine on a card.
 * A Hays band on the wrong rung is worse again, because unlike a task list it
 * is a number, and a number gets believed.
 *
 * IT USES THE APP'S OWN placeTitle RATHER THAN A SECOND MATCHER. Ad titles are
 * placed on rungs by careerLadder.placeTitle; running the guide's role names
 * through anything else would let the two drift, so a Hays "Financial
 * Controller" could land on a different rung from the ads called that. One
 * placer, one answer.
 *
 * THE FOUR CONFIDENCE BUCKETS, strongest first:
 *
 *   exact    the cleaned role name is a title the rung ALREADY carries in the
 *            archive (careerPathways' own `titles`). The strongest evidence
 *            there is: real ads with that exact title placed on that rung.
 *   placed   placeTitle put it somewhere, but no archived ad carries the name.
 *            Plausible and unconfirmed — the bucket most worth a human eye.
 *   hinted   unplaced, but familyHint names a family. The ladder is known and
 *            the rung is not; usually a seniority word the guide words oddly.
 *   none     neither. Nothing is proposed, and nothing should be invented.
 *
 * AND THE ONE THAT ACTUALLY FINDS ERRORS: `section_odd`. Every Hays role sits
 * under a section heading ("ACCOUNTANCY AND FINANCE", "CONSTRUCTION"), and the
 * roles under one section almost all place into the same family. A role that
 * disagrees with its own section's majority is flagged — derived from the data
 * rather than from a hand-written section-to-family map, so it needs no
 * maintenance and cannot go stale. That column is where to start reading.
 */
import { HAYS_ROLES, HAYS_PAY, HAYS_EDITIONS } from "../src/employsi/data/haysSalary";
import { CAREER_PATHWAYS } from "../src/employsi/data/careerPathways";
import {
  placeTitle,
  familyHint,
  cleanTitle,
  RUNG_LABEL,
  type Rung,
} from "../src/employsi/lib/careerLadder";

/** Titles the archive has already placed, title -> the nodes carrying it. */
const archived = new Map<string, Set<string>>();
for (const n of CAREER_PATHWAYS.nodes) {
  const node = `${n.family}|${n.track}|${n.rung}`;
  for (const [t] of n.titles ?? []) {
    const k = cleanTitle(t);
    if (!k) continue;
    (archived.get(k) ?? archived.set(k, new Set()).get(k)!).add(node);
  }
}

/** Figures and a sample band per role index, so a reviewer sees the weight of
 *  the decision and can sanity-check the number against the rung. */
const weight = new Map<number, { n: number; lo: number; hi: number; eds: Set<string> }>();
for (const [ri, ed, , , , , lo, hi] of HAYS_PAY) {
  const w = weight.get(ri) ?? { n: 0, lo: Infinity, hi: 0, eds: new Set<string>() };
  w.n += 1;
  w.lo = Math.min(w.lo, lo);
  w.hi = Math.max(w.hi, hi);
  w.eds.add(ed);
  weight.set(ri, w);
}

type Row = {
  idx: number;
  role: string;
  section: string;
  node: string;
  rung: string;
  canonical: string;
  via: string;
  conf: "exact" | "placed" | "hinted" | "none";
  qualifier: string;
  n: number;
  band: string;
  eds: string;
};

const rows: Row[] = [];
for (let i = 0; i < HAYS_ROLES.length; i++) {
  const { role, qualifier, section } = HAYS_ROLES[i];
  const w = weight.get(i);
  if (!w) continue; // a role with no figures is nothing to map
  const p = placeTitle(role);
  const clean = cleanTitle(role);
  const node = p ? `${p.family}|${p.track}|${p.rung}` : "";
  const hitNodes = archived.get(clean);
  const conf: Row["conf"] = p
    ? hitNodes?.has(node)
      ? "exact"
      : "placed"
    : familyHint(role)
      ? "hinted"
      : "none";
  rows.push({
    idx: i,
    role,
    qualifier,
    // Only the leading heading: the full breadcrumb carries the page title and
    // is too long to scan down a column.
    section: (section.split("|")[0] ?? "").trim().slice(0, 40),
    node: p ? node : familyHint(role) ? `${familyHint(role)}|?|?` : "",
    rung: p ? RUNG_LABEL[p.rung as Rung] : "",
    canonical: p?.canonical ?? "",
    via: p?.via ?? "",
    conf,
    n: w.n,
    band: `${w.lo}-${w.hi}k`,
    eds: [...w.eds].sort().join("+"),
  });
}

// ── the section-majority disagreement flag ───────────────────────────────────
// Which family most of a section's placed roles land in. Computed over the
// roles themselves rather than weighted by figures: a section's identity is
// what it is ABOUT, and one role published for twelve cities should not outvote
// eleven roles published for one.
const bySection = new Map<string, Map<string, number>>();
for (const r of rows) {
  if (!r.node || r.conf === "hinted") continue;
  const fam = r.node.split("|")[0];
  const m = bySection.get(r.section) ?? bySection.set(r.section, new Map()).get(r.section)!;
  m.set(fam, (m.get(fam) ?? 0) + 1);
}
const majority = new Map<string, string>();
for (const [sec, m] of bySection) {
  const [top] = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (top && top[1] >= 3) majority.set(sec, top[0]);
}

const ORDER = { exact: 0, placed: 1, hinted: 2, none: 3 } as const;
rows.sort((a, b) => ORDER[a.conf] - ORDER[b.conf] || b.n - a.n || a.role.localeCompare(b.role));

const out: string[] = [];
out.push(
  `# Hays role -> career rung, PROPOSED. Editions: ${HAYS_EDITIONS.join(", ")}.`,
  `# Fill DECISION with the node to use (family|track|rung), "ok" to accept the`,
  `# proposal, or "no" to map nothing. Blank is treated as undecided, and an`,
  `# undecided role contributes no salary anywhere — the same way a rung the`,
  `# O*NET table has not decided is simply left off the card.`,
  `# Read section_odd=Y first: those disagree with their own section's family.`,
  "",
  [
    "DECISION",
    "confidence",
    "section_odd",
    "hays_role",
    "hays_band",
    "hays_section",
    "proposed_node",
    "rung",
    "canonical",
    "via",
    "figures",
    "band",
    "editions",
  ].join("\t"),
);
let odd = 0;
const tally: Record<string, number> = { exact: 0, placed: 0, hinted: 0, none: 0 };
for (const r of rows) {
  tally[r.conf] += 1;
  const maj = majority.get(r.section);
  const fam = r.node.split("|")[0];
  const isOdd = !!maj && !!fam && fam !== maj && r.conf !== "none";
  if (isOdd) odd += 1;
  out.push(
    [
      "",
      r.conf,
      isOdd ? "Y" : "",
      r.role,
      r.qualifier,
      r.section,
      r.node,
      r.rung,
      r.canonical,
      r.via,
      String(r.n),
      r.band,
      r.eds,
    ].join("\t"),
  );
}
console.log(out.join("\n"));
console.error(
  `${rows.length} roles with figures · exact ${tally.exact} · placed ${tally.placed} · ` +
    `hinted ${tally.hinted} · unplaced ${tally.none} · section-odd ${odd}`,
);
