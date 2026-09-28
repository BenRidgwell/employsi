/**
 * Every country's vacancy series is aligned to the IVI month axis.
 *
 * THE BUG THIS EXISTS FOR, measured 2026-09-27. Nine national series — AU
 * (JSA/IVI), Canada, Singapore, New Zealand, UK, EU, US, Hong Kong and the
 * Philippines — are merged by skillHeat on the assumption that they share one
 * month axis, IVI_MONTHS, index for index. Nothing checked it. IVI_MONTHS was
 * extended to 2026-07 on 2026-09-21 and six of the other eight files were not
 * regenerated, so their arrays were 243 long against a 245-month axis.
 *
 * It was invisible because the consumer read `series[city][i] ?? 0`: a month
 * past the end of a short array came back as ZERO DEMAND rather than as no
 * measurement, so Toronto, Singapore, Auckland, London, Hong Kong and Manila
 * quietly went dark for the two most recent months on the time slider. Nothing
 * on screen said the files were stale; it looked like the market.
 *
 * The `?? 0` is gone, so a missing month now omits the city. That makes the
 * failure honest but not visible, which is what this script is for.
 *
 * NOT WIRED INTO CI YET, deliberately. It fails today for the five countries
 * whose releases are not in the repo and cannot be regenerated here — each
 * generator takes a local source file. Add it to skills-check.yml once those
 * five have been refreshed; until then it is the thing you run to see how far
 * behind they are.
 *
 *   bun run scripts/check-vacancy-series.ts
 */
import { IVI_MONTHS, IVI_SERIES, IVI_SKILL_BY_CITY } from "../src/employsi/data/iviSkillDemand";
import { CA_SERIES, CA_SKILL_BY_CITY } from "../src/employsi/data/caVacancyDemand";
import { SG_SERIES, SG_SKILL_BY_CITY } from "../src/employsi/data/sgVacancyDemand";
import { NZ_SERIES, NZ_SKILL_BY_CITY } from "../src/employsi/data/nzVacancyDemand";
import { UK_SERIES, UK_SKILL_BY_CITY } from "../src/employsi/data/ukVacancyDemand";
import { EU_SERIES, EU_SKILL_BY_CITY } from "../src/employsi/data/euVacancyDemand";
import { US_SERIES, US_SKILL_BY_CITY } from "../src/employsi/data/usVacancyDemand";
import { HK_SERIES, HK_SKILL_BY_CITY } from "../src/employsi/data/hkVacancyDemand";
import { PH_SERIES, PH_SKILL_BY_CITY } from "../src/employsi/data/phVacancyDemand";

type Series = Record<string, Record<string, number[]>>;
type Latest = Record<string, Record<string, number>>;

const COUNTRIES: { name: string; generator: string; series: Series; latest: Latest }[] = [
  {
    name: "AU (JSA/IVI)",
    generator: "gen-ivi-skill-demand.py",
    series: IVI_SERIES,
    latest: IVI_SKILL_BY_CITY,
  },
  {
    name: "Canada",
    generator: "gen-ca-vacancy-demand.py",
    series: CA_SERIES,
    latest: CA_SKILL_BY_CITY,
  },
  {
    name: "Singapore",
    generator: "gen-sg-vacancy-demand.py",
    series: SG_SERIES,
    latest: SG_SKILL_BY_CITY,
  },
  {
    name: "New Zealand",
    generator: "gen-nz-vacancy-demand.py",
    series: NZ_SERIES,
    latest: NZ_SKILL_BY_CITY,
  },
  {
    name: "UK",
    generator: "gen-uk-vacancy-demand.py",
    series: UK_SERIES,
    latest: UK_SKILL_BY_CITY,
  },
  {
    name: "EU",
    generator: "gen-eu-vacancy-demand.py",
    series: EU_SERIES,
    latest: EU_SKILL_BY_CITY,
  },
  {
    name: "US",
    generator: "gen-us-vacancy-demand.py",
    series: US_SERIES,
    latest: US_SKILL_BY_CITY,
  },
  {
    name: "Hong Kong",
    generator: "gen-hk-vacancy-demand.py",
    series: HK_SERIES,
    latest: HK_SKILL_BY_CITY,
  },
  {
    name: "Philippines",
    generator: "gen-ph-vacancy-demand.py",
    series: PH_SERIES,
    latest: PH_SKILL_BY_CITY,
  },
];

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail && !ok ? ` — ${detail}` : ""}`);
};

const AXIS = IVI_MONTHS.length;
console.log(`the axis is ${AXIS} months, ${IVI_MONTHS[0]}..${IVI_MONTHS[AXIS - 1]}\n`);

console.log("every country's series spans the whole axis:");
for (const c of COUNTRIES) {
  const lens = new Map<number, number>();
  const cities = new Set<string>();
  for (const byCity of Object.values(c.series)) {
    for (const [city, arr] of Object.entries(byCity)) {
      cities.add(city);
      lens.set(arr.length, (lens.get(arr.length) ?? 0) + 1);
    }
  }
  if (!lens.size) {
    check(`${c.name}: has any series at all`, false, "no skills");
    continue;
  }
  const wrong = [...lens.keys()].filter((l) => l !== AXIS);
  const short = wrong.filter((l) => l < AXIS);
  // A SHORT series is a stale file; a LONG one is worse, because every index
  // past the axis is a month the app cannot name and the extra values would be
  // read as if they belonged to earlier months by anything that zips the two.
  check(
    `${c.name}: ${cities.size} ${cities.size === 1 ? "city" : "cities"}, all ${AXIS} months`,
    wrong.length === 0,
    wrong.length
      ? `lengths ${[...lens.keys()].sort((a, b) => a - b).join("/")} — ` +
          (short.length
            ? `${AXIS - Math.min(...short)} month(s) behind, re-run scripts/${c.generator}`
            : `longer than the axis, re-run scripts/${c.generator}`)
      : "",
  );
}

// ── no fabricated flat zeros ────────────────────────────────────────────────
// A skill present in a country's file with zero for EVERY month is not a
// measurement, it is a row that should not be there: the map draws it as "this
// city has never hired for this", which is a claim, not an absence. New Zealand
// carried 24 of them until 2026-09-27 — skills with no weight in the AU mix the
// NZ total is split by, floored to 1 and rounded to 0. They are left out now.
console.log("\nno skill is present-but-always-zero:");
for (const c of COUNTRIES) {
  const dead: string[] = [];
  for (const [skill, byCity] of Object.entries(c.series)) {
    for (const [city, arr] of Object.entries(byCity)) {
      if (arr.length && arr.every((v) => v === 0)) dead.push(`${skill}/${city}`);
    }
  }
  check(
    `${c.name}: every series has a non-zero month`,
    dead.length === 0,
    `${dead.length} flat-zero: ${dead.slice(0, 4).join(", ")}${dead.length > 4 ? " …" : ""}`,
  );
}

// ── the latest map agrees with the series ───────────────────────────────────
// NZ_SKILL_BY_CITY and friends are what the CURRENT heat map reads; the series
// is what the time slider reads. They are written by the same generator from
// the same numbers, so a disagreement means one of them was edited by hand or
// the generator was half-changed — and the two surfaces would then show
// different demand for the same city on the same day.
console.log("\nthe current-month map matches the end of the series:");
for (const c of COUNTRIES) {
  const bad: string[] = [];
  for (const [skill, byCity] of Object.entries(c.latest)) {
    for (const [city, v] of Object.entries(byCity)) {
      const arr = c.series[skill]?.[city];
      if (!arr) {
        bad.push(`${skill}/${city} has no series`);
        continue;
      }
      // The anchor is the last month the release and the axis share, which is
      // the last month of the series for an up-to-date file.
      const last = arr[arr.length - 1];
      if (last !== v) bad.push(`${skill}/${city} ${v} vs ${last}`);
    }
  }
  check(
    `${c.name}: latest values are the series' last month`,
    bad.length === 0,
    `${bad.length} differ: ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? " …" : ""}`,
  );
}

// ── New Zealand's occupation-by-region tilt ─────────────────────────────────
// Auckland and Wellington are driven by the NATIONAL monthly occupation series,
// so without a tilt every skill in the same ANZSCO group would sit at one fixed
// Wellington:Auckland ratio for all time — the two cities would be the same
// picture at two sizes. The quarterly by-region workbook is what breaks that,
// and dropping it would not fail anything else here: the arrays stay the right
// length, nothing goes flat, and the current map still matches the series.
//
// Measured against the workbook: Wellington's clerical advertising runs at
// 0.218 of Auckland's in 2014 and 0.261 by 2024, while management falls from
// 0.286 to 0.251. So the ratio has to MOVE, and it has to move differently for
// different occupation groups.
console.log("\nNew Zealand's two cities are not one picture at two sizes:");
{
  const ratios = (skill: string): number[] => {
    const a = NZ_SERIES[skill]?.auckland;
    const w = NZ_SERIES[skill]?.wellington;
    if (!a || !w) return [];
    const out: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] > 0 && w[i] > 0) out.push(w[i] / a[i]);
    return out;
  };
  const spread = (r: number[]) => (r.length ? Math.max(...r) / Math.min(...r) : 1);
  // Two skills in DIFFERENT ANZSCO groups, so the check also fails if the tilt
  // is applied but with one group's numbers used for every group.
  const admin = ratios("Administration & Office Support");
  const mgmt = ratios("General Management");
  check(
    "the Wellington:Auckland ratio moves over time",
    spread(admin) > 1.2,
    `admin ratio spans only ${spread(admin).toFixed(2)}x`,
  );
  // Rounding to whole ads makes small series jitter, so the two groups are
  // compared on their trend rather than month to month: the mean ratio over the
  // first and last five years apart.
  const mean = (r: number[]) => r.reduce((t, v) => t + v, 0) / (r.length || 1);
  const early = (r: number[]) => mean(r.slice(0, 60));
  const late = (r: number[]) => mean(r.slice(-60));
  const adminMove = late(admin) / early(admin);
  const mgmtMove = late(mgmt) / early(mgmt);
  check(
    "and moves differently for different occupation groups",
    Math.abs(adminMove - mgmtMove) > 0.05,
    `clerical ${adminMove.toFixed(3)} vs management ${mgmtMove.toFixed(3)}`,
  );
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall vacancy-series checks passed");
process.exit(failed ? 1 : 0);
