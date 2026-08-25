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
 * IT HAS ALREADY EARNED ITS KEEP TWICE, both times on the movement band below.
 * The first NZ run rolled the crosswalk up to sub-major by taking the union of
 * each group's skills, which made Pharmacy inherit "62 Sales Assistants and
 * Salespersons" — it is 7% of that group — so its Wellington figure was mostly
 * the median of the country's retail staff and rose 245% in five years. The
 * second run combined two groups' medians per skill, which turns out to be
 * bistable: Social & Community Services crossed from one group to the other
 * between censuses and appeared to lose 28.5%. Neither was visible in the
 * figures themselves.
 *
 * WHAT IS NOT CHECKED HERE, SO IT IS NOT MISTAKEN FOR CHECKED. The rule that
 * matters most about this dataset — that a figure in it must never be
 * differenced against the app's live advertised median, because the two are
 * different instruments — is a rule about code that does not exist yet. It
 * cannot be asserted structurally without banning the two from appearing in one
 * component, which is exactly what showing them side by side requires. So it
 * lives in the generated file's header and in review, and this file does not
 * pretend to enforce it. The same goes for differencing AU against NZ.
 *
 * Run: bun run scripts/check-salary-baseline.ts
 */
import {
  SALARY_BASELINE,
  BASELINE_MARKETS,
  AREA_MARKET,
} from "../src/employsi/data/salaryBaseline";
import { ALL_SKILLS } from "../src/employsi/data/skillsTaxonomy";

/** Mirrors MIN_TOTAL in gen-salary-baseline.py. A figure resting on fewer
 *  people than this should have been written as null. */
const MIN_TOTAL = 1000;

/**
 * The widest move a real series is allowed BETWEEN CONSECUTIVE POINTS, per
 * market. These are not the same quantity and must not share a number: AU's
 * points are one year apart and NZ's are five.
 *
 * Measured on the current file:
 *   au  521 observations, -9.9% to +20.8%, p99 +13.2%. The band catches a
 *       COLUMN SLIP — Table 15 carries median taxable income, average salary or
 *       wage income and median salary or wage income side by side, and the ATO
 *       renumbers the footnote markers in those headers most years. Reading the
 *       average instead of the median would take Chief Executives from 93,894
 *       to 200,417.
 *   nz  203 observations, -0.5% to +48.6%, p99 +41.5%. Five-year steps across a
 *       period when the NZ minimum wage went from $16.50 to $22.70, so real
 *       movement is genuinely large; the top of the range is Cleaning &
 *       Facilities in Auckland at +48.6%. The band is set to catch the two
 *       failures described above, which produced +245% and -28.5%.
 */
const MAX_MOVE: Record<string, number> = { au: 0.35, nz: 0.75 };

const problems: string[] = [];
const skills = new Set(ALL_SKILLS);

for (const [market, spec] of Object.entries(BASELINE_MARKETS)) {
  if (!spec.source || !spec.sourceUrl || !spec.licence || !spec.basis || !spec.currency) {
    problems.push(
      `Market "${market}" is missing provenance — a published figure has to name\n` +
        `  where it came from, in what currency and on what basis.`,
    );
  }
  if (!spec.years.length || !spec.areas.length) {
    problems.push(`Market "${market}" declares no years or no areas.`);
  }
  for (const y of spec.areaYears) {
    if (!spec.years.includes(y)) {
      problems.push(`Market "${market}" lists areaYear ${y}, which is not one of its years.`);
    }
  }
  for (const group of spec.shared) {
    for (const s of group) {
      if (!skills.has(s)) {
        problems.push(
          `Market "${market}" reports "${s}" as a shared skill, but it is not in the taxonomy.`,
        );
      }
    }
  }
  if (MAX_MOVE[market] === undefined) {
    problems.push(
      `Market "${market}" has no entry in MAX_MOVE. A new market needs its own\n` +
        `  movement band measured from its own data — AU's points are a year\n` +
        `  apart and NZ's are five, so one number cannot serve both.`,
    );
  }
}

let published = 0;
const perMarket: Record<string, { skills: Set<string>; areaSeries: number }> = {};

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
    const market = AREA_MARKET[area];
    if (!market) {
      problems.push(`"${skill}" carries area "${area}", which is in no market.`);
      continue;
    }
    const spec = BASELINE_MARKETS[market];
    if (!spec.areas.includes(area)) {
      problems.push(`"${skill}" carries area "${area}", which market "${market}" does not list.`);
      continue;
    }
    if (series.length !== spec.years.length) {
      problems.push(
        `"${skill}" / ${area} has ${series.length} points for ${spec.years.length} ${market} years.\n` +
          `  Every series is positional against its market's years; a short one\n` +
          `  silently shifts every figure in it to the wrong year.`,
      );
      continue;
    }

    const stats = (perMarket[market] ??= { skills: new Set(), areaSeries: 0 });
    if (area !== spec.areas[0]) stats.areaSeries++;

    let prev: number | null = null;
    series.forEach((point, i) => {
      if (point === null) {
        prev = null;
        return;
      }
      published++;
      stats.skills.add(skill);
      const [median, n] = point;

      if (!Number.isFinite(median) || median <= 0) {
        problems.push(`"${skill}" / ${area} / ${spec.years[i]}: median is ${median}.`);
      }
      if (!Number.isFinite(n) || n < MIN_TOTAL) {
        problems.push(
          `"${skill}" / ${area} / ${spec.years[i]}: rests on ${n} people, under the\n` +
            `  ${MIN_TOTAL.toLocaleString()} floor. It should have been written as null rather than\n` +
            `  published thinly — the same way an under-sampled live price is.`,
        );
      }
      // A non-national area may only carry a figure in the years its office
      // actually published a geographic split. The ATO did so once; the NZ
      // census does so every time.
      if (area !== spec.areas[0] && !spec.areaYears.includes(spec.years[i])) {
        problems.push(
          `"${skill}" / ${area} has a figure for ${spec.years[i]}, but ${market} only published\n` +
            `  a geographic split for ${spec.areaYears.join(", ")}. A hub series must not carry\n` +
            `  the national figure as though it were local.`,
        );
      }
      if (prev !== null) {
        const move = (median - prev) / prev;
        if (Math.abs(move) > MAX_MOVE[market]) {
          problems.push(
            `"${skill}" / ${area}: ${spec.years[i - 1]} → ${spec.years[i]} moves ` +
              `${(move * 100).toFixed(1)}% (${prev.toLocaleString()} → ${median.toLocaleString()}),\n` +
              `  past the ${(MAX_MOVE[market] * 100).toFixed(0)}% band for ${market}. This is the shape of an\n` +
              `  attribution or column error, not a wage change — see the header.`,
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

const lines = Object.entries(perMarket).map(([m, s]) => {
  const spec = BASELINE_MARKETS[m];
  const shared = spec.shared.reduce((n, g) => n + g.length, 0);
  return (
    `  ${m}: ${s.skills.size} skills over ${spec.years.length} years ` +
    `(${spec.years[0]}–${spec.years[spec.years.length - 1]}), ${s.areaSeries} area series` +
    (shared ? `, ${shared} skills sharing a figure in ${spec.shared.length} groups` : "")
  );
});
console.log(`✓ ${published} figures across ${Object.keys(perMarket).length} markets.`);
console.log(lines.join("\n"));
console.log(
  `  Every figure rests on ${MIN_TOTAL.toLocaleString()}+ people, sits in a year its market\n` +
    `  published, and moves within its market's band.`,
);
