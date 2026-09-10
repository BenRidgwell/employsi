#!/usr/bin/env bun
/**
 * Skills-taxonomy integrity check — the automated guard that stops duplicate
 * skills from ever shipping again (see src/employsi/data/skillsTaxonomy.ts).
 *
 * Run by .github/workflows/skills-check.yml on every push/PR touching the
 * taxonomy, and locally with `bun run scripts/check-skills.ts`. Exits non-zero
 * (failing the build) if:
 *   1. ALL_SKILLS / SKILL_CATEGORY contain a duplicate canonical name, or
 *   2. two source defs share a name but disagree on category (a lossy merge).
 */
import {
  ALL_SKILLS,
  ALL_SKILLS_AND_CHILDREN,
  SKILLS,
  SKILL_ALIAS,
  SKILL_CATEGORY,
  SKILL_CHILDREN,
  SKILL_NAME_CONFLICTS,
  SKILL_PARENT,
  skillsForText,
} from "../src/employsi/data/skillsTaxonomy";

let failed = false;

/**
 * How many distinct archived titles a speciality needs before we report on it.
 *
 * 40 is where the mined candidates stopped being a speciality and started being
 * a handful of ads: measured 2026-09-10, Community Nursing had 14 titles and
 * Diversity & Inclusion 7, both real jobs and neither a thing the Australian
 * market names often enough to chart. The children that shipped sit between 40
 * and 449.
 */
const CHILD_TITLE_FLOOR = 40;

// 1. No duplicate canonical skill names in the exported list.
const counts = new Map<string, number>();
for (const s of ALL_SKILLS) counts.set(s, (counts.get(s) ?? 0) + 1);
const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);
if (dups.length) {
  failed = true;
  console.error(`✗ Duplicate skill names in ALL_SKILLS: ${dups.join(", ")}`);
} else {
  console.log(`✓ ${ALL_SKILLS.length} skills, all unique.`);
}

// SKILL_CATEGORY is keyed by name and must cover EVERY canonical name —
// specialities included, because parseStoredSkills uses it as the membership
// test for an archived name and would drop a child's demand without it. So it
// is checked against ALL_SKILLS_AND_CHILDREN, not against ALL_SKILLS, which is
// deliberately the broad skills only.
const catKeys = new Set(Object.keys(SKILL_CATEGORY));
const missingCat = ALL_SKILLS_AND_CHILDREN.filter((s) => !catKeys.has(s));
if (missingCat.length || catKeys.size !== new Set(ALL_SKILLS_AND_CHILDREN).size) {
  failed = true;
  console.error(
    `✗ SKILL_CATEGORY does not cover every canonical name` +
      (missingCat.length ? `: missing ${missingCat.join(", ")}` : " (extra keys present)."),
  );
}

// 2. No same-named defs with conflicting categories (silently dropped on merge).
if (SKILL_NAME_CONFLICTS.length) {
  failed = true;
  console.error(
    `✗ Duplicate skill names with mismatched categories: ${SKILL_NAME_CONFLICTS.join(", ")}`,
  );
} else {
  console.log("✓ No category conflicts among merged defs.");
}

// 3. No seniority grade read as an education job.
//
// "Principal" names a school principal only in a school. Everywhere else it is
// a SENIORITY GRADE — "Principal Cost Management", "Principal Geotechnical
// Engineer", "Principal Policy Officer" — and reading it literally does two
// kinds of damage: it invents education demand where there is none (Education
// Leadership surfaced as an emerging skill AT BHP, which is how this was
// found), and it hides the skill the title actually describes, because the
// informative word is the one AFTER "Principal".
//
// The gate that prevents this used to depend on the caller passing the
// employer's industry, and exactly one caller did, so in practice it never
// ran. This check is here because that class of failure — a control that is
// silently opted out of — does not announce itself.
//
// Each case asserts both halves: no education skill, AND the skill implied by
// the rest of the title is still found. A fix that suppressed "Principal"
// titles entirely would satisfy the first half and fail the second.
const PRINCIPAL_CASES: { title: string; wants: string; forbids?: boolean }[] = [
  { title: "Principal Cost Management", wants: "Project Management" },
  { title: "Principal Geotechnical Engineer", wants: "Geotechnical" },
  { title: "Principal Mining Engineer", wants: "Mining Engineering" },
  { title: "Principal Data Scientist", wants: "Data Science & Machine Learning" },
  { title: "Principal Project Manager", wants: "Project Management" },
  { title: "Principal Policy Officer", wants: "Policy & Programs" },
  // The genuine article still has to work, or the gate has overcorrected.
  { title: "School Principal", wants: "Education Leadership", forbids: false },
  { title: "Assistant Principal", wants: "Education Leadership", forbids: false },
  { title: "Deputy Principal", wants: "Education Leadership", forbids: false },
  { title: "Principal - Secondary College", wants: "Education Leadership", forbids: false },
];
const EDUCATION_SKILLS = new Set(
  Object.entries(SKILL_CATEGORY)
    .filter(([, cat]) => cat === "Education")
    .map(([name]) => name),
);
const principalProblems: string[] = [];
for (const c of PRINCIPAL_CASES) {
  const got = skillsForText(c.title);
  if (c.forbids !== false && got.some((s) => EDUCATION_SKILLS.has(s))) {
    principalProblems.push(`${JSON.stringify(c.title)} → education skill ${JSON.stringify(got)}`);
  }
  if (!got.includes(c.wants)) {
    principalProblems.push(
      `${JSON.stringify(c.title)} lost ${JSON.stringify(c.wants)} — got ${JSON.stringify(got)}`,
    );
  }
}
if (principalProblems.length) {
  failed = true;
  console.error("✗ 'Principal' is being read as a school principal outside education:");
  for (const p of principalProblems) console.error(`    ${p}`);
  console.error("  See GATED_TERMS in src/employsi/data/skillsTaxonomy.ts.");
} else {
  console.log(`✓ ${PRINCIPAL_CASES.length} 'Principal' titles map by what follows the word.`);
}

// 4. No skill name stranded in the archive.
//
// The D1 archive freezes each listing's skills as JSON when the row is written,
// so renaming a canonical skill leaves every older row carrying the old string.
// Readers drop names they don't recognise, which means the demand is lost
// SILENTLY — nothing appears wrong, the skill is just quieter than it should be.
// One rename had already done this before anyone noticed: 245 rows held
// "Data Science & ML" after the skill became "Data Science & Machine Learning".
//
// So the archive is checked against the taxonomy. A stranded name is fixed by
// adding it to SKILL_ALIAS (which maps it forward on read) and backfilling the
// rows; this check then passes because the alias covers it.
//
// Skipped without D1 credentials, so the taxonomy checks above still run in a
// plain checkout — but the workflow supplies them, so CI does run it.
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB = process.env.JOBS_ARCHIVE_DB_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (ACCOUNT && DB && TOKEN) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT skills FROM jobs WHERE skills IS NOT NULL" }),
      },
    );
    const json = (await res.json()) as {
      success?: boolean;
      result?: { results?: { skills?: string }[] }[];
    };
    if (!json.success) throw new Error("D1 query failed");
    const seen = new Map<string, number>();
    for (const row of json.result?.[0]?.results ?? []) {
      let arr: unknown;
      try {
        arr = JSON.parse(row.skills ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      for (const v of arr) {
        const name = String(v);
        if (name in SKILL_CATEGORY || name in SKILL_ALIAS) continue;
        seen.set(name, (seen.get(name) ?? 0) + 1);
      }
    }
    if (seen.size) {
      failed = true;
      console.error("✗ Archived skill names not in the taxonomy and not aliased:");
      for (const [name, n] of [...seen].sort((a, b) => b[1] - a[1])) {
        console.error(`    ${String(n).padStart(6)}  ${JSON.stringify(name)}`);
      }
      console.error(
        "  Fix: add each to SKILL_ALIAS pointing at its current name, then backfill the rows.",
      );
    } else {
      console.log("✓ Every archived skill name resolves to a current skill.");
    }
  } catch (e) {
    // A checking failure is not a taxonomy failure — say so and move on rather
    // than turning a network blip into a red build.
    console.log(`· Archive check skipped: ${(e as Error).message}`);
  }
} else {
  console.log("· Archive check skipped (no D1 credentials in the environment).");
}

// 5. No archived "Principal ..." row carrying a stale education skill.
//
// A SEPARATE block from check 4 on purpose. Both need D1, but check 4 reads
// every skills cell in the table and that response is large enough to drop the
// connection; when it does, anything sharing its try{} is skipped in silence.
// A control that stops running whenever an unrelated query is having a bad day
// is exactly the failure mode this check exists to catch, so it gets its own.
if (ACCOUNT && DB && TOKEN) {
  try {
    // The row-level half of check 3. The corpus above proves the TAXONOMY is
    // right today; this proves the ARCHIVE is, which is a different question —
    // rows are written with the skills frozen in at scrape time, so a title
    // mapped wrongly last month still carries the wrong skill after the
    // taxonomy is fixed, and a feed that stops passing titles correctly starts
    // writing new bad rows tomorrow. Either way a company's card shows
    // education demand it does not have.
    // Its own query: pulling title and company for EVERY row makes the
    // response large enough that D1 drops the connection, and this pass only
    // cares about a few hundred of them.
    const pRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sql:
            "SELECT title, company, skills FROM jobs " +
            // '%Principal%', not 'Principal%'. The word is not always first —
            // BHP advertises "HSS Principal Integration", which an anchored
            // filter walks straight past.
            "WHERE skills IS NOT NULL AND title LIKE '%Principal%'",
        }),
      },
    );
    const pJson = (await pRes.json()) as {
      success?: boolean;
      result?: { results?: { title?: string; company?: string; skills?: string }[] }[];
    };
    if (!pJson.success) throw new Error("D1 principal query failed");
    const stale: { title: string; company: string; skills: string[] }[] = [];
    for (const row of pJson.result?.[0]?.results ?? []) {
      const title = row.title ?? "";
      if (!/\bprincipal\b/i.test(title)) continue;
      let arr: unknown;
      try {
        arr = JSON.parse(row.skills ?? "[]");
      } catch {
        continue;
      }
      if (!Array.isArray(arr)) continue;
      const stored = arr.map(String).filter((s) => EDUCATION_SKILLS.has(s));
      if (!stored.length) continue;
      // Only a disagreement with the CURRENT matcher is a fault. A genuine
      // "Principal - Secondary College" row keeps its education skill and is
      // not flagged.
      const now = skillsForText(title);
      if (stored.some((s) => !now.includes(s))) {
        stale.push({ title, company: row.company ?? "", skills: stored });
      }
    }
    if (stale.length) {
      failed = true;
      console.error(
        `✗ ${stale.length} archived "Principal ..." rows carry an education skill the ` +
          "current taxonomy does not give them:",
      );
      for (const s of stale.slice(0, 20)) {
        console.error(`    ${s.company} — ${s.title} ${JSON.stringify(s.skills)}`);
      }
      if (stale.length > 20) console.error(`    … and ${stale.length - 20} more`);
      console.error("  Fix: re-map those rows' skills (scripts/remap-skills.py).");
    } else {
      console.log("✓ No archived 'Principal' row carries a stale education skill.");
    }
  } catch (e) {
    console.log(`· Principal archive check skipped: ${(e as Error).message}`);
  }
} else {
  console.log("· Principal archive check skipped (no D1 credentials in the environment).");
}

// ── 5. Parent / child specialities ──────────────────────────────────────────
//
// The structural half runs offline. The evidence half needs the archive and is
// further down, with the other D1-backed checks.
{
  const kids = Object.keys(SKILL_PARENT);
  const problems: string[] = [];
  for (const child of kids) {
    const parent = SKILL_PARENT[child];
    // A parent that does not exist would make the child unreachable: the
    // matcher gates on `out.has(def.parent)`, which can never be true.
    if (!(parent in SKILL_CATEGORY)) problems.push(`${child}: parent "${parent}" is not a skill`);
    // One level. A grandchild would need the middle skill to have matched, and
    // nothing in skillsForText walks a chain.
    else if (parent in SKILL_PARENT)
      problems.push(`${child}: parent "${parent}" is itself a child`);
    // Same category, so a speciality legends and colours with the skill it
    // narrows rather than appearing in an unrelated part of the chart.
    else if (SKILL_CATEGORY[child] !== SKILL_CATEGORY[parent])
      problems.push(
        `${child}: cat "${SKILL_CATEGORY[child]}" != parent's "${SKILL_CATEGORY[parent]}"`,
      );
  }
  // A child sharing a term with an UNRELATED broad skill is two names for one
  // concept — the state SKILL_ALIAS exists to clean up after. (Sharing terms
  // with its own parent is normal and expected.)
  for (const child of kids) {
    const def = SKILLS.find((s) => s.skill === child)!;
    for (const other of SKILLS) {
      if (other.parent || other.skill === SKILL_PARENT[child]) continue;
      const shared = def.terms.filter((t) => other.terms.includes(t));
      // "aged care" is deliberately on both Aged Care Nursing and the broad
      // Aged & Disability Care: a nurse specialising in aged care really is
      // doing both, and the two are read by different audiences. Anything else
      // is duplication.
      const allowed = child === "Aged Care Nursing" && other.skill === "Aged & Disability Care";
      if (shared.length && !allowed)
        problems.push(
          `${child} shares term(s) with broad skill ${other.skill}: ${shared.join(", ")}`,
        );
    }
  }
  if (problems.length) {
    failed = true;
    console.error(`✗ Parent/child problems:\n   ${problems.join("\n   ")}`);
  } else {
    const summary = Object.entries(SKILL_CHILDREN)
      .map(([p, c]) => `${p} (${c.length})`)
      .join(", ");
    console.log(
      `✓ ${kids.length} specialities under ${Object.keys(SKILL_CHILDREN).length} parents: ${summary}.`,
    );
  }
  // The matcher's central rule, asserted rather than assumed: a child cannot
  // fire unless the title independently claims its parent. Without this,
  // "Aged Care Worker" — a real job, and not a nursing one — becomes Aged Care
  // Nursing, and every loosely-worded child term leaks the same way.
  const GATE: [string, string, boolean][] = [
    ["Aged Care Worker", "Aged Care Nursing", false],
    ["Registered Nurse - Aged Care", "Aged Care Nursing", true],
    ["Talent Acquisition Partner", "Talent Acquisition", true],
    ["Acquisition Analyst", "Talent Acquisition", false],
    ["Renal Dietitian", "Renal Nursing", false],
    ["Registered Nurse - Renal Dialysis", "Renal Nursing", true],
    ["Workday Finance Consultant", "HR Systems", false],
    ["HR Systems Analyst", "HR Systems", true],
    // The gate is what lets these child terms stay short. Each false case is a
    // real title the term would claim on its own.
    ["Primary Health Care Nurse", "Primary Teaching", false],
    ["Primary School Cleaner", "Primary Teaching", false],
    ["Teacher - Primary", "Primary Teaching", true],
    ["Teacher - Secondary Generalist", "Secondary Teaching", true],
    ["Occupational Health and Safety Advisor", "Occupational Therapy", false],
    ["Occupational Therapist - Paediatrics", "Occupational Therapy", true],
    ["Clinical Audit Coordinator", "Audit", false],
    ["Night Auditor", "Audit", false],
    ["Internal Audit Manager", "Audit", true],
    ["Taxi Driver", "Taxation", false],
    ["Tax Accountant", "Taxation", true],
    // "hr driver" is Heavy Rigid under one parent and Human Resources under
    // another. Both readings are correct and both must survive.
    ["HR Driver - Sydney", "Truck Driving", true],
    ["HR Business Partner", "Truck Driving", false],
  ];
  const gateFails = GATE.filter(([t, s, want]) => skillsForText(t).includes(s) !== want);
  if (gateFails.length) {
    failed = true;
    for (const [t, s, want] of gateFails)
      console.error(`✗ "${t}" should ${want ? "" : "NOT "}map to ${s}; got [${skillsForText(t)}]`);
  } else {
    console.log(`✓ ${GATE.length} titles honour the parent gate.`);
  }
  // Every child name must be readable back out of the archive, or a row
  // written with it silently loses that demand (see parseStoredSkills).
  const unreadable = kids.filter((k) => !ALL_SKILLS_AND_CHILDREN.includes(k));
  if (unreadable.length) {
    failed = true;
    console.error(`✗ Children missing from ALL_SKILLS_AND_CHILDREN: ${unreadable.join(", ")}`);
  }

  // ── the evidence floor ────────────────────────────────────────────────────
  //
  // A speciality has to be one employers actually advertise. Each child here
  // was minted off a measured count of distinct titles in the archive, and this
  // re-measures it: a child that decays below the floor is one the product is
  // reporting on with too little behind it, and it should fail the build rather
  // than keep rendering a plausible small number. Same discipline as the
  // coverage checks in check-skill-trends.ts.
  //
  // Distinct TITLES, not rows, for the reason the whole archive now counts that
  // way: one vacancy on four job boards is four rows and one role.
  //
  // Titles are matched with skillsForText, so what is measured is what the
  // matcher would actually produce — not a re-implementation of it that could
  // drift.
  if (ACCOUNT && DB && TOKEN) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            // A YEAR, not all of it. The floor asks "do employers still
            // advertise this speciality", and over the whole archive — which
            // reaches back to 2003 — a speciality that died years ago would
            // keep clearing it on history alone. A year is also what keeps the
            // scan affordable: it is ~144k distinct titles rather than ~150k,
            // each of which goes through the real matcher.
            sql:
              "SELECT DISTINCT lower(trim(title)) t FROM jobs " +
              "WHERE title IS NOT NULL AND last_seen >= date('now','-365 day')",
          }),
        },
      );
      const json = (await res.json()) as {
        success?: boolean;
        result?: { results?: { t?: string }[] }[];
      };
      if (!json.success) throw new Error("D1 title query failed");
      const titles = (json.result?.[0]?.results ?? []).map((r) => r.t ?? "");
      const n: Record<string, number> = Object.fromEntries(kids.map((k) => [k, 0]));
      // Only titles that contain at least one child TERM can possibly count
      // toward a child, so the rest never reach the matcher. Exact, not an
      // approximation — a child with no term present cannot match — and it is
      // the difference between a couple of seconds and a couple of minutes,
      // because the full taxonomy is 116 defs and 900-odd terms per title.
      const childTerms = kids.flatMap((k) => SKILLS.find((d) => d.skill === k)?.terms ?? []);
      for (const t of titles) {
        if (!childTerms.some((term) => t.includes(term))) continue;
        for (const s of skillsForText(t)) if (s in n) n[s] += 1;
      }
      const thin = kids.filter((k) => n[k] < CHILD_TITLE_FLOOR);
      if (thin.length) {
        failed = true;
        console.error(
          `✗ Specialities below the ${CHILD_TITLE_FLOOR}-title evidence floor: ` +
            thin.map((k) => `${k} (${n[k]})`).join(", "),
        );
        console.error(
          "   Either the archive has moved on and the speciality should be retired,\n" +
            "   or its terms have stopped matching how employers word the title.",
        );
      } else {
        const lowest = kids.reduce((a, b) => (n[a] <= n[b] ? a : b));
        console.log(
          `✓ All ${kids.length} specialities clear the ${CHILD_TITLE_FLOOR}-title floor ` +
            `(thinnest: ${lowest} at ${n[lowest]}, over ${titles.length} titles from the last year).`,
        );
      }
    } catch (e) {
      // Same rule as the checks above: a checking failure is not a taxonomy
      // failure. Say so rather than turning a network blip into a red build.
      console.log(`· Speciality evidence check skipped: ${(e as Error).message}`);
    }
  } else {
    console.log("· Speciality evidence check skipped (no D1 credentials in the environment).");
  }
}

if (failed) {
  console.error(
    "\nFix: add new match terms to the EXISTING def for that skill, " +
      "do not add a second def with the same name (and keep its category consistent).",
  );
  process.exit(1);
}
console.log("\nSkills taxonomy OK.");
