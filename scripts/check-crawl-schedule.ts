/**
 * Does the admin console's crawl schedule still match the Worker's?
 *
 * WHAT THIS GUARDS. `src/employsi/lib/crawlSchedule.ts` restates a summary of
 * `workers/jobs-cron/wrangler.jsonc` so the console can say when a family next
 * runs. Two copies of a schedule drift, and this one drifts SILENTLY: a cron
 * changed in the Worker and not in the console produces a card that confidently
 * names a time nothing will fire at. That is worse than no card, because the
 * card exists to answer "is this feed dead, or has it simply not run yet" — the
 * one question a wrong time answers backwards.
 *
 * So every expression the console claims must still exist in the Worker. The
 * reverse is deliberately NOT asserted: the Worker carries 88 crons and the
 * console lists the four families worth a human knowing about, so extra crons
 * in the Worker are the normal state, not a fault.
 *
 * Run: bun run scripts/check-crawl-schedule.ts
 */
import {
  CRAWL_FAMILIES,
  nextRun,
  nextForFamily,
  untilLabel,
} from "../src/employsi/lib/crawlSchedule";

const cfg = await Bun.file("workers/jobs-cron/wrangler.jsonc").text();
// The config is JSONC with heavy comments; strip line comments before parsing.
const crons: string[] = JSON.parse(cfg.replace(/^\s*\/\/.*$/gm, "")).triggers.crons;
const have = new Set(crons);

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
  }
}

console.log(`\nWorker declares ${crons.length} cron expressions.`);
console.log("\nevery expression the console claims still exists in the Worker:");
for (const f of CRAWL_FAMILIES) {
  const missing = f.crons.filter((c) => !have.has(c));
  check(
    `${f.title.padEnd(20)} ${f.crons.length} tick(s)`,
    missing.length === 0,
    missing.length ? `not in wrangler.jsonc: ${missing.join(", ")}` : undefined,
  );
}

// The parser is deliberately narrow — it must REFUSE what it cannot read
// rather than guess, because a plausible wrong time is the failure here.
console.log("\nnextRun understands the shapes used, and refuses the rest:");
const at = new Date(Date.UTC(2026, 8, 21, 7, 30));
const m = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "null");
check(
  "'0 */6 * * *' -> 12:00",
  m(nextRun("0 */6 * * *", at)) === "2026-09-21 12:00",
  m(nextRun("0 */6 * * *", at)),
);
check(
  "'20 4 * * *' -> next day 04:20",
  m(nextRun("20 4 * * *", at)) === "2026-09-22 04:20",
  m(nextRun("20 4 * * *", at)),
);
check(
  "'45 7 * * *' -> same day 07:45",
  m(nextRun("45 7 * * *", at)) === "2026-09-21 07:45",
  m(nextRun("45 7 * * *", at)),
);
check("day-of-week form refused", nextRun("0 9 * * 1-5", at) === null);
check("day-of-month form refused", nextRun("0 9 1 * *", at) === null);
check("minute list refused", nextRun("0,30 * * * *", at) === null);
check("malformed refused", nextRun("nonsense", at) === null);

// A run happening this very minute is the NEXT one, not "due now" — otherwise
// the card reads "in 0m" for a whole minute on every sixth hour.
check(
  "a firing at the current minute rolls forward",
  m(nextRun("30 7 * * *", at)) === "2026-09-22 07:30",
);

console.log("\nevery family resolves to a real next run:");
for (const f of CRAWL_FAMILIES) {
  const n = nextForFamily(f, at);
  check(`${f.title.padEnd(20)} ${n ? m(n) + "  " + untilLabel(n, at) : "NONE"}`, n !== null);
}

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nCrawl schedule OK.");
