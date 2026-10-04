/**
 * The career card's O*NET mapping — src/employsi/data/onetRoles.ts, written
 * by scripts/gen-onet-roles.py from its reviewed TABLE.
 *
 * WHY THIS EXISTS. A wrong occupation renders perfectly: "chief people
 * officer" mapped to Probation Officers shows six fluent, plausible-looking
 * tasks, and nothing on the card could tell a reader they belong to someone
 * else's job. That is what the title matcher produced before the table was
 * reviewed, so the mapping is asserted rather than trusted:
 *
 * - every rung is DECIDED: mapped, or reviewed and left without one. A rung
 *   added to careerPathways.ts fails here until someone reads its titles —
 *   it must never pick up an occupation by inheritance or by guess;
 * - every occupation a rung names carries tasks;
 * - the matcher's measured mistakes stay fixed;
 * - the card keeps the CC BY credit, which is a licence condition.
 *
 * Run: bun run scripts/check-onet-roles.ts
 */
import { readFileSync } from "node:fs";
import { CAREER_PATHWAYS } from "../src/employsi/data/careerPathways";
import {
  ONET_NONE,
  ONET_OCCUPATIONS,
  ONET_RELATED,
  ONET_ROLES,
} from "../src/employsi/data/onetRoles";
import { MOVE_MIN_SHARED, careerMoves } from "../src/employsi/lib/careerCard";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) {
    failed++;
    console.error(`✗ ${name}`, detail === undefined ? "" : detail);
  }
}

const rungs = new Set(CAREER_PATHWAYS.nodes.map((n) => `${n.family}|${n.track}|${n.rung}`));
const none = new Set(ONET_NONE);

const undecided = [...rungs].filter((id) => !(id in ONET_ROLES) && !none.has(id));
check(
  "every rung is mapped or deliberately left unmapped — rerun gen-onet-roles.py --review",
  undecided.length === 0,
  undecided,
);
const gone = [...Object.keys(ONET_ROLES), ...ONET_NONE].filter((id) => !rungs.has(id));
check("no entry for a rung that no longer exists", gone.length === 0, gone);
check(
  "no rung is both mapped and unmapped",
  ONET_NONE.every((id) => !(id in ONET_ROLES)),
);

for (const [id, soc] of Object.entries(ONET_ROLES)) {
  const o = ONET_OCCUPATIONS[soc];
  check(`${id}: ${soc} is in the occupation table`, !!o);
  if (!o) continue;
  check(`${id}: ${soc} carries tasks`, o.tasks.length > 0);
  check(
    `${id}: ${soc} tasks are ranked, most important first`,
    o.tasks.every(([, s], k) => k === 0 || s == null || (o.tasks[k - 1][1] ?? 0) >= s),
  );
}
const used = new Set(Object.values(ONET_ROLES));
const orphans = Object.keys(ONET_OCCUPATIONS).filter((soc) => !used.has(soc));
check("no occupation shipped that no rung uses", orphans.length === 0, orphans);

// The title matcher's measured mistakes (2026-09-29). Each was a fluent,
// wrong answer; each must stay overridden.
const NOT: [string, string, string][] = [
  ["hr|generalist|6", "21-1092.00", "chief people officer -> Probation Officers"],
  ["sales|generalist|3", "11-9199.10", "business development manager -> Wind Energy Development"],
  ["sales|generalist|6", "13-2081.00", "chief revenue officer -> Tax Examiners and Revenue Agents"],
  ["data|generalist|2", "19-3022.00", "data analyst -> Survey Researchers"],
  ["finance|fpa|2", "15-2041.00", "financial analyst -> Statisticians"],
  ["hse|generalist|4", "11-3013.01", "safety manager -> Security Managers"],
  ["banking|relationship|3", "11-2032.00", "relationship manager -> Public Relations Managers"],
  ["allied|pathology|2", "19-1042.00", "medical scientist -> research Medical Scientists"],
];
for (const [id, soc, why] of NOT) check(`${id} is not ${why}`, ONET_ROLES[id] !== soc);

// And a few anchors a reviewer vouched for, so a table edit that moves one
// is a decision rather than an accident.
const IS: [string, string][] = [
  ["hr|generalist|4", "11-3121.00"],
  ["payroll|generalist|2", "43-3051.00"],
  ["software|generalist|2", "15-1252.00"],
  ["nursing|generalist|2", "29-1141.00"],
  ["finance|generalist|2", "13-2011.00"],
];
for (const [id, soc] of IS) check(`${id} is ${soc}`, ONET_ROLES[id] === soc, ONET_ROLES[id]);

// ── Other directions (careerCard.careerMoves) ────────────────────────────────
// A move is only ever O*NET's link between two mapped rungs, to another
// ladder, published in the market, and not a drop of more than one rung.
let movesSeen = 0;
for (const n of CAREER_PATHWAYS.nodes) {
  if (!n.markets.au) continue;
  const id = `${n.family}|${n.track}|${n.rung}`;
  const moves = careerMoves(CAREER_PATHWAYS, n, "au");
  if (!(id in ONET_ROLES)) {
    check(`${id}: no O*NET occupation, so no moves`, moves.length === 0, moves);
    continue;
  }
  movesSeen += moves.length;
  for (const m of moves) {
    const [f, t, r] = m.id.split("|");
    const dest = CAREER_PATHWAYS.nodes.find(
      (x) => x.family === f && x.track === t && x.rung === Number(r),
    );
    check(`${id} -> ${m.id}: destination exists in the market`, !!dest?.markets.au);
    check(`${id} -> ${m.id}: on another ladder`, !(f === n.family && t === n.track));
    check(`${id} -> ${m.id}: at most one rung down`, Number(r) >= n.rung - 1);
    check(
      `${id} -> ${m.id}: O*NET relates the two occupations`,
      (ONET_RELATED[ONET_ROLES[id]] ?? []).includes(ONET_ROLES[m.id]),
    );
    check(`${id} -> ${m.id}: overlap is a share`, m.overlap >= 0 && m.overlap <= 1);
    check(
      `${id} -> ${m.id}: our ads show something in common (a skill, or ${MOVE_MIN_SHARED}+ employers)`,
      m.overlap > 0 || m.sharedEmployers >= MOVE_MIN_SHARED,
    );
  }
  check(
    `${id}: moves ordered by skill overlap`,
    moves.every((m, k) => k === 0 || moves[k - 1].overlap >= m.overlap),
  );
}
// The example the feature was asked for.
const headPayroll = CAREER_PATHWAYS.nodes.find(
  (x) => x.family === "payroll" && x.track === "generalist" && x.rung === 5,
);
check(
  "head of payroll can lead to chief people officer",
  !!headPayroll &&
    careerMoves(CAREER_PATHWAYS, headPayroll, "au").some((m) => m.id === "hr|generalist|6"),
);

// The move this rule was written for: O*NET relates HR Managers to Social and
// Community Service Managers, and our ads share no skill between them.
const cpo = CAREER_PATHWAYS.nodes.find(
  (x) => x.family === "hr" && x.track === "generalist" && x.rung === 6,
);
check(
  "chief people officer does not lead to director of social work",
  !!cpo &&
    !careerMoves(CAREER_PATHWAYS, cpo, "au").some((m) => m.id.startsWith("care|social-work")),
);

const pane = readFileSync(
  new URL("../src/employsi/components/panels/CareerPathwaysPane.tsx", import.meta.url),
  "utf8",
);
/**
 * THE CARD NAMES NO THIRD-PARTY SOURCE, and this used to assert the opposite.
 *
 * It read `/CC BY 4\.0/.test(pane) && /O\*NET/.test(pane)` — "the card credits
 * O*NET under CC BY 4.0". The credit block was removed from the card on
 * 2026-09-30 and this check went on passing for three days, because both
 * patterns still matched the COMMENTS left behind explaining the removal. A
 * check that reads a comment is not reading the product.
 *
 * So the source is stripped of comments first, and the assertion is inverted to
 * match what the owner asked for: nothing the card renders names O*NET. The
 * attribution obligation is not met here any more and is not pretended to be —
 * it is to be carried by a methodology page on the website.
 */
const paneCode = pane.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("the career card renders no third-party source name", !/O\*NET|CC BY/.test(paneCode));
/**
 * The HONEST half of the old assertion, and the half that was never about
 * attribution. A cross-ladder move is a related occupation, not something the
 * archive watched anyone do — the archive holds ads, not careers. Dropping the
 * source's name from that sentence must not drop the disclaimer with it.
 */
check(
  "other directions still say they are not tracked moves",
  /not a tracked career move/.test(paneCode),
);

if (failed) {
  console.error(`\n${failed} O*NET mapping check(s) failed.`);
  process.exit(1);
}
const share = Math.round((Object.keys(ONET_ROLES).length / rungs.size) * 100);
console.log(
  `✓ O*NET: ${Object.keys(ONET_ROLES).length} of ${rungs.size} rungs mapped (${share}%) to ${used.size} occupations; ${none.size} reviewed and left unmapped; ${movesSeen} other-direction links in AU.`,
);
