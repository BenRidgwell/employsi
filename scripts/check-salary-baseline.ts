/**
 * Invariants for src/employsi/data/salaryBaseline.ts.
 *
 * THE CLASS OF BUG THIS GUARDS, which is the same one check-skill-trends.ts and
 * check-analyst-scope.ts guard: an aggregate that still renders a plausible
 * number after the reasoning behind it breaks. Nothing here would look wrong on
 * a card. A skill priced off one tiny occupation, a series whose 2019 figure
 * came from the wrong column, a baseline stranded under a skill name that no
 * longer exists — all of them draw a clean line and a tidy dollar figure.
 *
 * WHAT IS NOT CHECKED HERE, SO IT IS NOT MISTAKEN FOR CHECKED. The rule that
 * matters most about this dataset — that a figure in it must never be
 * differenced against the app's live advertised median, because the two are
 * different instruments — is a rule about code that does not exist yet. It
 * cannot be asserted structurally without banning the two from appearing in one
 * component, which is exactly what showing them side by side requires. So it
 * lives in the generated file's header and in review, and this file does not
 * pretend to enforce it.
 *
 * Run: bun run scripts/check-salary-baseline.ts
 */
import {
  SALARY_BASELINE,
  BASELINE_YEARS,
  BASELINE_AREAS,
  BASELINE_SOURCE,
  BASELINE_SOURCE_URL,
  BASELINE_LICENCE,
  BASELINE_BASIS,
} from "../src/employsi/data/salaryBaseline";
import { ALL_SKILLS } from "../src/employsi/data/skillsTaxonomy";

/** Mirrors MIN_TOTAL in gen-salary-baseline.py. A figure resting on fewer
 *  people than this should have been written as null. */
const MIN_TOTAL = 1000;

/**
 * The widest year-on-year move a real series is allowed.
 *
 * Measured across all 521 year-on-year observations in the current file: the
 * range is -9.9% (Data Analytics, 2017-18 to 2018-19) to +20.8% (Personal
 * Services & Beauty, 2021-22 to 2022-23), with a 1st percentile of -6.1% and a
 * 99th of +13.2%. So 35% is well clear of anything the data does.
 *
 * It is set to catch the realistic failure, which is not a wage shock but a
 * COLUMN SLIP: Table 15 carries median taxable income, average salary or wage
 * income and median salary or wage income side by side, and the ATO renumbers
 * the footnote markers in those headers most years. Reading the average instead
 * of the median would take Chief Executives from 93,894 to 200,417 — a jump no
 * plausibility band should let through, and one nothing else would notice.
 */
const MAX_YOY = 0.35;

const problems: string[] = [];
const skills = new Set(ALL_SKILLS);
const areas = new Set(BASELINE_AREAS);
const stateYearIdx = BASELINE_YEARS.length - 1;

if (!BASELINE_SOURCE || !BASELINE_SOURCE_URL || !BASELINE_LICENCE || !BASELINE_BASIS) {
  problems.push(
    "A published figure has to name where it came from, and one of BASELINE_SOURCE /\n" +
      "  BASELINE_SOURCE_URL / BASELINE_LICENCE / BASELINE_BASIS is empty.",
  );
}

let published = 0;
let hubSeries = 0;

for (const [skill, byArea] of Object.entries(SALARY_BASELINE)) {
  // A taxonomy rename leaves the baseline behind under the old name, where
  // nothing reads it — silent, and indistinguishable from "this skill has no
  // history" on the card.
  if (!skills.has(skill)) {
    problems.push(
      `"${skill}" is not in the taxonomy any more.\n` +
        `  Either it was renamed (add it to SKILL_ALIAS and regenerate) or removed\n` +
        `  (regenerate, so the baseline stops carrying it).`,
    );
  }

  for (const [area, series] of Object.entries(byArea)) {
    if (!areas.has(area)) {
      problems.push(`"${skill}" carries area "${area}", which is not in BASELINE_AREAS.`);
      continue;
    }
    if (series.length !== BASELINE_YEARS.length) {
      problems.push(
        `"${skill}" / ${area} has ${series.length} points for ${BASELINE_YEARS.length} years.\n` +
          `  Every series is positional against BASELINE_YEARS; a short one silently\n` +
          `  shifts every figure in it to the wrong year.`,
      );
      continue;
    }

    if (area !== "au") hubSeries++;

    let prev: number | null = null;
    series.forEach((point, i) => {
      if (point === null) {
        prev = null;
        return;
      }
      published++;
      const [median, n] = point;

      if (!Number.isFinite(median) || median <= 0) {
        problems.push(`"${skill}" / ${area} / ${BASELINE_YEARS[i]}: median is ${median}.`);
      }
      if (!Number.isFinite(n) || n < MIN_TOTAL) {
        problems.push(
          `"${skill}" / ${area} / ${BASELINE_YEARS[i]}: rests on ${n} people, under the\n` +
            `  ${MIN_TOTAL.toLocaleString()} floor. It should have been written as null rather than\n` +
            `  published thinly — the same way an under-sampled live price is.`,
        );
      }
      // The ATO published a state breakdown in one year of this range only, so
      // a hub figure in any other slot means something invented one.
      if (area !== "au" && i !== stateYearIdx) {
        problems.push(
          `"${skill}" / ${area} has a figure for ${BASELINE_YEARS[i]}, but the ATO only\n` +
            `  published a state breakdown for ${BASELINE_YEARS[stateYearIdx]}. A hub series must not\n` +
            `  carry the national figure as though it were local.`,
        );
      }
      if (prev !== null) {
        const move = (median - prev) / prev;
        if (Math.abs(move) > MAX_YOY) {
          problems.push(
            `"${skill}" / ${area}: ${BASELINE_YEARS[i - 1]} → ${BASELINE_YEARS[i]} moves ` +
              `${(move * 100).toFixed(1)}% (${prev.toLocaleString()} → ${median.toLocaleString()}).\n` +
              `  Nothing in the measured data moves more than 21%. This is the shape of a\n` +
              `  column slip — average read as median, or taxable income as wage income.`,
          );
        }
      }
      prev = median;
    });
  }
}

if (problems.length) {
  console.error(
    `✗ ${problems.length} problem${problems.length === 1 ? "" : "s"} in salaryBaseline.ts:\n`,
  );
  for (const p of problems) console.error(`  • ${p}\n`);
  process.exit(1);
}

console.log(
  `✓ ${Object.keys(SALARY_BASELINE).length} skills, ${published} figures across ` +
    `${BASELINE_YEARS.length} years (${BASELINE_YEARS[0]}–${BASELINE_YEARS[stateYearIdx]}).\n` +
    `  ${hubSeries} hub series, all confined to ${BASELINE_YEARS[stateYearIdx]}; every figure rests on ` +
    `${MIN_TOTAL.toLocaleString()}+ people\n  and no series moves more than ${(MAX_YOY * 100).toFixed(0)}% in a year.`,
);
