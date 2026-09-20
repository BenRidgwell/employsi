/**
 * Does the news tagger put the right skills on real articles?
 *
 * WHAT THIS GUARDS, and it is the same class as the other check scripts here: a
 * wrong tag is invisible. A chip reading "Risk & Compliance" under a headline
 * about a share price looks exactly like a chip reading "Underground Mining"
 * under a story about a new mine. Nothing errors, nothing looks broken, and the
 * card quietly asserts something about the company that is not true.
 *
 * So precision is the number that matters, not coverage. A missing tag costs a
 * reader nothing — most articles genuinely have no skill in them — while a
 * wrong one is a claim about what a company does, made by us, on a card that
 * otherwise only shows measured things.
 *
 * SCORING, per (article, tag) pair rather than per article:
 *   correct         a predicted tag in the fixture's `expect`
 *   tolerated       a predicted tag in `ok` — a defensible reading, so it
 *                   counts neither for nor against
 *   false positive  anything else predicted
 *   missed          an `expect` tag that did not fire
 *
 * precision = correct / (correct + false positives)
 * recall    = correct / (correct + missed)
 *
 * THE THRESHOLDS ARE A RATCHET, NOT A TARGET. They are set just under the
 * current measurement so the suite fails when a change makes tagging worse, and
 * they are meant to be RAISED as the suppression layer lands — not lowered to
 * make a run go green. Lowering one is the move this file exists to prevent.
 *
 * Run: bun run scripts/check-news-skills.ts
 */
import { NEWS_SKILL_FIXTURES } from "./newsSkillFixtures";
import { newsSkillTags } from "../src/employsi/lib/newsSkills";
import { SKILL_CATEGORY, SKILL_PARENT } from "../src/employsi/data/skillsTaxonomy";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
  }
}

// ── the fixture itself has to be sound before it can judge anything ──────────
console.log("\nfixture integrity:");
{
  const bad: string[] = [];
  for (const f of NEWS_SKILL_FIXTURES) {
    for (const s of [...f.expect, ...f.ok]) {
      if (!(s in SKILL_CATEGORY)) bad.push(`${s} (not a skill) — "${f.title.slice(0, 50)}"`);
      else if (SKILL_PARENT[s])
        bad.push(`${s} (a speciality, not broad) — "${f.title.slice(0, 50)}"`);
    }
  }
  check(
    "every labelled tag is a real BROAD skill",
    bad.length === 0,
    bad.slice(0, 4).join("\n       "),
  );
  const overlap = NEWS_SKILL_FIXTURES.filter((f) => f.expect.some((s) => f.ok.includes(s)));
  check(
    "no tag is both required and merely tolerated",
    overlap.length === 0,
    overlap
      .slice(0, 3)
      .map((f) => f.title.slice(0, 50))
      .join("\n       "),
  );
  const dupes = new Set<string>();
  const seen = new Set<string>();
  for (const f of NEWS_SKILL_FIXTURES) {
    const k = f.co + "|" + f.title;
    if (seen.has(k)) dupes.add(f.title.slice(0, 50));
    seen.add(k);
  }
  // Duplicates are reported, not failed: the live feed really does serve the
  // same headline twice (two BOQ branch-closure rows), and a fixture that
  // pretended otherwise would not be the corpus the tagger meets.
  if (dupes.size)
    console.log(`  --  ${dupes.size} duplicate headline(s) kept, as the feed serves them`);
}

// ── score the tagger ────────────────────────────────────────────────────────
let correct = 0;
let tolerated = 0;
let missed = 0;
const falsePositives: { title: string; tag: string; note?: string }[] = [];
const misses: { title: string; tag: string }[] = [];

for (const f of NEWS_SKILL_FIXTURES) {
  const got = newsSkillTags(f.title);
  for (const g of got) {
    if (f.expect.includes(g)) correct++;
    else if (f.ok.includes(g)) tolerated++;
    else falsePositives.push({ title: f.title, tag: g, note: f.note });
  }
  for (const e of f.expect) {
    if (got.includes(e)) continue;
    missed++;
    misses.push({ title: f.title, tag: e });
  }
}

const predicted = correct + tolerated + falsePositives.length;
const precision = predicted ? correct / (correct + falsePositives.length) : 1;
const recall = correct + missed ? correct / (correct + missed) : 1;
const taggedArticles = NEWS_SKILL_FIXTURES.filter((f) => newsSkillTags(f.title).length).length;

console.log(`\nscored over ${NEWS_SKILL_FIXTURES.length} real headlines:`);
console.log(
  `  articles tagged   ${taggedArticles}  (${((100 * taggedArticles) / NEWS_SKILL_FIXTURES.length).toFixed(1)}% coverage)`,
);
console.log(`  tags predicted    ${predicted}`);
console.log(`    correct         ${correct}`);
console.log(`    tolerated       ${tolerated}`);
console.log(`    FALSE POSITIVE  ${falsePositives.length}`);
console.log(`  required missed   ${missed}`);
console.log(`  precision         ${(100 * precision).toFixed(1)}%`);
console.log(`  recall            ${(100 * recall).toFixed(1)}%`);

if (falsePositives.length) {
  console.log(`\nfalse positives (the ones to drive down):`);
  for (const fp of falsePositives.slice(0, 20)) {
    console.log(`  ${fp.tag.padEnd(30)} | ${fp.title.slice(0, 74)}`);
    if (fp.note) console.log(`  ${"".padEnd(30)} | ^ ${fp.note}`);
  }
  if (falsePositives.length > 20) console.log(`  ... and ${falsePositives.length - 20} more`);
}
if (misses.length) {
  console.log(`\nrequired tags that did not fire (recall gap):`);
  for (const m of misses.slice(0, 12))
    console.log(`  ${m.tag.padEnd(30)} | ${m.title.slice(0, 74)}`);
  if (misses.length > 12) console.log(`  ... and ${misses.length - 12} more`);
}

// ── the ratchet ─────────────────────────────────────────────────────────────
//
// Set from the BASELINE measured on 2026-09-20 with the plain title matcher:
// precision 41.7%, recall 24.4%, coverage 12.5%. Both floors sit a few points
// under that, so the suite catches a regression without failing on noise.
//
// WORTH RECORDING THAT THE BASELINE IS WORSE THAN IT LOOKS BY EYE. Skimming the
// 32 matched headlines suggested roughly two thirds were fine; scoring them per
// tag against written-down labels says 41.7%. The difference is that reading a
// match list invites you to accept a tag because you can construct a reading
// for it, which is the whole reason the labels exist.
//
// The plan's ship bar for the suppression layer is precision >= 85%. Raise
// MIN_PRECISION to match when that lands; do not lower it to pass a run.
const MIN_PRECISION = 0.38;
const MIN_RECALL = 0.21;

console.log("\nthresholds:");
check(
  `precision >= ${(100 * MIN_PRECISION).toFixed(0)}%`,
  precision >= MIN_PRECISION,
  `measured ${(100 * precision).toFixed(1)}%`,
);
check(
  `recall >= ${(100 * MIN_RECALL).toFixed(0)}%`,
  recall >= MIN_RECALL,
  `measured ${(100 * recall).toFixed(1)}%`,
);
// Coverage is NOT asserted. It was agreed to be low, and pinning it would turn
// a deliberate silence — a story with no skill in it — into a failure.

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nNews skill tagging OK.");
