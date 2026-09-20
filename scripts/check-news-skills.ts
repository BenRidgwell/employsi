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
import { COMPANIES } from "../src/employsi/data/companies";

// The fixture stores the feed's slug; the tagger wants the roster name, because
// it strips the company's own name from the haystack before reading it. Doing
// the lookup here rather than storing the name keeps the fixture honest about
// what the pipeline actually has in hand at tag time.
const NAME_BY_SLUG = new Map<string, string>();
for (const c of COMPANIES as { name: string }[]) {
  NAME_BY_SLUG.set(
    c.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
    c.name,
  );
}
const tagsFor = (f: { co: string; title: string }) =>
  newsSkillTags(f.title, NAME_BY_SLUG.get(f.co));

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
  const got = tagsFor(f);
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
const taggedArticles = NEWS_SKILL_FIXTURES.filter((f) => tagsFor(f).length).length;

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

// ── one assertion per suppression rule ──────────────────────────────────────
//
// The aggregate above can stay green while a rule is quietly deleted, because
// one tag in twenty barely moves a percentage. These name the headline each
// rule was written for, so removing the rule fails LOUDLY and says which one.
console.log("\nsuppression rules, each on the headline that motivated it:");
function noTag(fragment: string, banned: string) {
  const f = NEWS_SKILL_FIXTURES.find((x) => x.title.includes(fragment));
  if (!f) {
    check(`fixture still contains "${fragment.slice(0, 40)}"`, false, "headline gone from corpus");
    return;
  }
  const got = tagsFor(f);
  check(
    `${banned.padEnd(31)} suppressed on "${fragment.slice(0, 38)}"`,
    !got.includes(banned),
    `got [${got.join(", ")}]`,
  );
}
noTag("data centre pipeline", "Pipeline Engineering");
noTag("Developer seeks to raise height", "Software Engineering");
noTag("Commercial Real Estate Product Suite", "Commercial & Legal");
noTag("Key to Aussie Logistics Returns", "Procurement & Supply");
noTag("Sales Climb Amid AI Optimism", "Data Science & Machine Learning");
noTag("Major Exhibition", "Journalism & Media");
noTag("CEFC finance accelerates", "Finance & Accounting");
noTag("A Risky Investment", "Risk & Compliance");
noTag("risk on for investors", "Risk & Compliance");
noTag("Metrics Credit stake", "Banking & Lending");
noTag("Logistics Giant US Investors", "Procurement & Supply");
noTag("outperforms the Real Estate sector", "Real Estate & Property");
noTag("new contracts boom", "Procurement & Supply");

// And the other direction: the suppressor must not swallow the work stories.
// A market-copy rule that matched everything would score 100% precision on an
// empty prediction set, which is the failure this pair of checks exists to
// separate from actually being right.
console.log("\nthe suppressor must not swallow real coverage:");
function keepsTag(fragment: string, wanted: string) {
  const f = NEWS_SKILL_FIXTURES.find((x) => x.title.includes(fragment));
  if (!f) {
    check(`fixture still contains "${fragment.slice(0, 40)}"`, false, "headline gone from corpus");
    return;
  }
  const got = tagsFor(f);
  check(
    `${wanted.padEnd(31)} kept on "${fragment.slice(0, 38)}"`,
    got.includes(wanted),
    `got [${got.join(", ")}]`,
  );
}
keepsTag("drill hundreds of new wells", "Drilling & Wells");
keepsTag("kicks off third underground mine", "Underground Mining");
keepsTag("Shell SAP blueprint", "IT & Systems");
keepsTag("taps AI to overhaul", "Data Science & Machine Learning");
keepsTag("Nexus program is transforming teacher education", "Teaching & Education");

// ── the ratchet ─────────────────────────────────────────────────────────────
//
// MEASURED ON 2026-09-20, same corpus, both ends:
//
//   plain title matcher      precision  41.7%   recall 24.4%   coverage 12.5%
//   + suppression layer      precision 100.0%   recall 24.4%   coverage  7.0%
//
// Recall did not move, which is the result worth having: the layer removed 14
// false positives and cost NOT ONE required tag. Coverage fell because the
// articles it stopped tagging were share-price copy that should never have
// carried a tag.
//
// THE FLOOR IS 85%, NOT THE 100% MEASURED. One hundred percent on the only
// corpus in hand is a statement about the corpus as much as the code — every
// rule here was written against these headlines, so the fixture cannot be
// evidence that the rules generalise. Leaving headroom means a new batch of
// real headlines can cost a few points without a red build, which is what
// should happen; a drop past 85% means the layer stopped working.
//
// WORTH RECORDING THAT THE BASELINE WAS WORSE THAN IT LOOKED BY EYE. Skimming
// the 32 matched headlines suggested roughly two thirds were fine; scoring them
// per tag against written-down labels said 41.7%. Reading a match list invites
// you to accept a tag because you can construct a reading for it.
const MIN_PRECISION = 0.85;
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
