/**
 * Invariants for the analyst's scope filter (scopeClause in
 * src/employsi/lib/analystFn.ts).
 *
 * The analyst answers only about the market NOW, and it dates its own evidence
 * off MIN(first_seen) for the scope. The archive also holds closed corpora —
 * `wayback`, 8,436 ads recovered from career sites that shut down between 2003
 * and 2018 — and letting those into a scope does not make an answer older, it
 * makes it wrong: it reported "collected 2003-12-29 to 2026-08-12" on any scope
 * holding BHP, and "2 roles live in the latest pull (2018-01-04)" for Santiago.
 *
 * The fix is one predicate on every branch of scopeClause, which is exactly the
 * kind of thing a new scope kind forgets. Hence this file: it is not testing
 * SQL semantics, it is asserting that no branch can return a clause without it.
 *
 * Run: bun run scripts/check-analyst-scope.ts
 */
import { scopeClause, coverageDay } from "../src/employsi/lib/analystFn";
import { HISTORICAL_SOURCES, LIVE_FEEDS_ONLY_SQL } from "../src/employsi/lib/jobArchive";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Every shape a caller can produce. If a scope kind is added, add it here —
// the count check below is what makes forgetting to do so noisy.
const CASES: Array<{ name: string; args: Parameters<typeof scopeClause> }> = [
  { name: "company", args: [{ kind: "company", label: "BHP", id: "bhp" }, []] },
  { name: "city", args: [{ kind: "city", label: "Perth" }, ["perth"]] },
  { name: "country", args: [{ kind: "country", label: "Australia" }, ["perth", "sydney"]] },
  { name: "region", args: [{ kind: "region", label: "APAC" }, ["perth", "singapore"]] },
  { name: "world", args: [{ kind: "world", label: "Worldwide" }, []] },
  {
    name: "city + sector",
    args: [{ kind: "city", label: "Perth" }, ["perth"], ["bhp", "rio"]],
  },
  {
    name: "world + sector",
    args: [{ kind: "world", label: "Worldwide" }, [], ["bhp"]],
  },
  {
    // A sector that matched no employers becomes "0=1". It must STILL carry the
    // predicate: the clause is concatenated onto by callers, and a branch that
    // is exempt today is a branch someone copies tomorrow.
    name: "sector matching nothing",
    args: [{ kind: "city", label: "Perth" }, ["perth"], []],
  },
  {
    // Ids are inlined, so anything not a roster slug must be dropped before it
    // reaches the statement.
    name: "hostile sector ids",
    args: [
      { kind: "world", label: "Worldwide" },
      [],
      ["bhp", "'); DROP TABLE jobs;--", "UPPER", "has space"],
    ],
  },
];

for (const c of CASES) {
  const { where } = scopeClause(...c.args);
  check(`${c.name}: excludes the closed corpora`, where.includes(LIVE_FEEDS_ONLY_SQL), where);
}

// The predicate itself has to name every closed corpus, or adding one to the
// set would quietly leave it in the analyst's answers.
for (const s of HISTORICAL_SOURCES) {
  check(`predicate names "${s}"`, LIVE_FEEDS_ONLY_SQL.includes(`'${s}'`), LIVE_FEEDS_ONLY_SQL);
}

// NULL-safe: a bare `source NOT IN (...)` evaluates to NULL for a NULL source
// and drops the row without trace. An unattributed row is far likelier to be a
// live feed with a parser fault than a closed corpus.
check(
  "predicate is null-safe",
  /COALESCE\(\s*source\s*,\s*''\s*\)/.test(LIVE_FEEDS_ONLY_SQL),
  LIVE_FEEDS_ONLY_SQL,
);

// Nothing user-supplied can reach the inlined id list.
const hostile = scopeClause(
  { kind: "world", label: "Worldwide" },
  [],
  ["bhp", "'); DROP TABLE jobs;--", "UPPER", "has space"],
).where;
check("hostile ids: keeps the valid slug", hostile.includes("'bhp'"), hostile);
check("hostile ids: drops everything else", !/DROP|UPPER|has space/.test(hostile), hostile);

// A company scope binds its id rather than inlining it.
const company = scopeClause({ kind: "company", label: "BHP", id: "bhp" }, []);
check("company scope binds its id", company.binds.length === 1 && company.binds[0] === "bhp");
check("company scope ignores hubs", !company.where.includes("hub"), company.where);

// Hubs are lowercased and bound, one placeholder each.
const city = scopeClause({ kind: "city", label: "Perth" }, ["Perth", "SYDNEY"]);
check("hubs are lowercased and bound", JSON.stringify(city.binds) === '["perth","sydney"]');
check("one placeholder per hub", (city.where.match(/\?/g) || []).length === 2, city.where);

// Guards the CASES list above: if a scope kind is added to AnalystScope without
// a case here, the coverage this file claims is not the coverage it has.
const KINDS: string[] = ["company", "city", "country", "region", "world"];
const covered = new Set<string>(CASES.map((c) => c.args[0].kind));
const missing = KINDS.filter((k) => !covered.has(k));
check("every scope kind has a case", missing.length === 0, `missing: ${missing.join(", ")}`);

// ── The reference day ───────────────────────────────────────────────────────
// LIVE_ON_DAY can only see an ad as live on day D if a feed pulled it on or
// after D, so the newest day or two is always short by whatever has not cycled
// yet. coverageDay is what stops the analyst reporting that shortfall as the
// market falling over — it once had BHP down 75% on a flat fortnight.

// BHP's real shape off production 2026-08-12, exactly as the query returns it:
// counts bounded to FEED_LOOKBACK_DAYS, so the dormant vendor feed contributes
// only its rows still inside that window. Requiring every feed would pin the
// answer to 07-29; the weighted rule takes 08-10, the last day BHP's
// live-on-day curve was stable (452, against a short 235 on the 11th).
const BHP = [
  { mx: "2026-08-12", n: 172 }, // portal-sf
  { mx: "2026-08-11", n: 69 }, // simplyhired
  { mx: "2026-08-11", n: 73 }, // seek
  { mx: "2026-08-11", n: 61 }, // jora
  { mx: "2026-08-11", n: 21 }, // jobstreet-ph
  { mx: "2026-08-11", n: 6 }, // jobstreet
  { mx: "2026-08-11", n: 69 }, // indeed
  { mx: "2026-08-11", n: 346 }, // adzuna
  { mx: "2026-08-10", n: 65 }, // linkedin — the one that pulls the day back
  { mx: "2026-07-29", n: 41 }, // theirstack — dormant, outvoted
];
check(
  "production shape: a dormant feed does not veto",
  coverageDay(BHP) === "2026-08-10",
  coverageDay(BHP),
);
// It clears the target by 882 against 876.85 needed — a 0.6pp margin. Asserted
// so that a future change to COVERAGE_TARGET or FEED_LOOKBACK_DAYS which pushes
// this case over the line is visible rather than silent.
check(
  "production shape: the margin is genuinely thin",
  (() => {
    const tot = BHP.reduce((t, f) => t + f.n, 0);
    const evidenced = BHP.filter((f) => f.mx >= "2026-08-10").reduce((t, f) => t + f.n, 0);
    return tot === 923 && evidenced === 882 && evidenced / tot < 0.96;
  })(),
);

check(
  "all feeds current: takes that day",
  coverageDay([{ mx: "2026-08-11", n: 10 }]) === "2026-08-11",
);
check("no feeds: returns empty, caller falls back", coverageDay([]) === "");
check("all-zero counts do not divide by zero", coverageDay([{ mx: "2026-08-11", n: 0 }]) === "");

// A feed big enough to matter DOES hold the day back — that is the whole point.
check(
  "a feed over the threshold holds the day back",
  coverageDay([
    { mx: "2026-08-11", n: 50 },
    { mx: "2026-08-08", n: 50 },
  ]) === "2026-08-08",
);
check(
  "a feed under the threshold does not",
  coverageDay([
    { mx: "2026-08-11", n: 990 },
    { mx: "2026-08-08", n: 10 },
  ]) === "2026-08-11",
);
// Exactly at the target counts as met: 95 of 100 is coverage of 95%.
check(
  "the threshold is inclusive",
  coverageDay([
    { mx: "2026-08-11", n: 95 },
    { mx: "2026-08-08", n: 5 },
  ]) === "2026-08-11",
);
// Order in, order out: the walk sorts newest-pull first regardless of the row
// order the GROUP BY happens to return.
check(
  "input order does not matter",
  coverageDay([
    { mx: "2026-08-01", n: 10 },
    { mx: "2026-08-11", n: 80 },
    { mx: "2026-08-09", n: 10 },
  ]) ===
    coverageDay([
      { mx: "2026-08-11", n: 80 },
      { mx: "2026-08-09", n: 10 },
      { mx: "2026-08-01", n: 10 },
    ]),
);
// Never returns a day no feed reported.
const DAYS = new Set(BHP.map((f) => f.mx));
check("returns a day some feed actually reported", DAYS.has(coverageDay(BHP)));

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
if (failures) process.exit(1);
