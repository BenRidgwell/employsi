/**
 * Career-ladder placement fixtures — src/employsi/lib/careerLadder.ts.
 *
 * WHY THIS EXISTS. placeTitle is a stack of first-match-wins regexes, so its
 * ORDER is its logic, and a rule added for one title can silently re-place
 * thousands of others. Nothing downstream looks wrong when that happens: the
 * pathway still has six rungs, each still shows a plausible count, a median
 * salary and a list of skills — about the wrong roles. The only place such a
 * regression is visible is here.
 *
 * Two kinds of fixture:
 *   - the LADDER the user-facing example names (HR Officer → HRBP → HR Manager
 *     → HR Director → Chief People Officer), which must stay in rising order;
 *   - TRAPS: titles that contain a family's words or a seniority word and
 *     belong somewhere else. Each one is a bug these rules had, or would have
 *     had, on the first draft.
 *
 * These are typical titles, not a sample measured from the archive. When the
 * audit (`bun run scripts/gen-career-pathways.ts --audit`) turns up a real
 * title placed wrongly, add it here before changing a rule.
 *
 * Run: bun run scripts/check-career-ladder.ts
 */
import { placeTitle, type Rung } from "../src/employsi/lib/careerLadder";

type Want = [family: string, track: string, rung: Rung] | null;

const FIXTURES: [string, Want][] = [
  // The HR generalist ladder, bottom to top.
  ["HR Assistant", ["hr", "generalist", 1]],
  ["HR Administrator", ["hr", "generalist", 1]],
  ["HR Coordinator", ["hr", "generalist", 1]],
  ["HR Officer", ["hr", "generalist", 2]],
  ["Human Resources Advisor", ["hr", "generalist", 2]],
  ["People & Culture Adviser", ["hr", "generalist", 2]],
  ["P&C Advisor", ["hr", "generalist", 2]],
  ["HR Generalist", ["hr", "generalist", 2]],
  ["HR Executive", ["hr", "generalist", 2]], // SG / HK / MY usage
  ["Senior HR Advisor", ["hr", "generalist", 3]],
  ["HR Business Partner", ["hr", "generalist", 3]],
  ["HRBP - Operations", ["hr", "generalist", 3]],
  ["People Partner", ["hr", "generalist", 3]],
  ["Senior HR Coordinator", ["hr", "generalist", 2]],
  ["HR Manager", ["hr", "generalist", 4]],
  ["Manager - Human Resources", ["hr", "generalist", 4]],
  ["Senior Manager, People & Culture", ["hr", "generalist", 4]],
  ["Head of HR", ["hr", "generalist", 5]],
  ["HR Director", ["hr", "generalist", 5]],
  ["Head of People", ["hr", "generalist", 5]],
  ["General Manager People and Culture", ["hr", "generalist", 5]],
  ["Chief People Officer", ["hr", "generalist", 6]],
  ["CHRO", ["hr", "generalist", 6]],
  ["Executive General Manager, People & Culture", ["hr", "generalist", 6]],

  // HR specialist tracks.
  ["Employee Relations Advisor", ["hr", "employee-relations", 2]],
  ["Senior Industrial Relations Adviser", ["hr", "employee-relations", 3]],
  ["Workplace Relations Manager", ["hr", "employee-relations", 4]],
  ["Talent Acquisition Coordinator", ["hr", "talent-acquisition", 1]],
  ["Talent Acquisition Partner", ["hr", "talent-acquisition", 2]],
  ["Internal Recruiter", ["hr", "talent-acquisition", 2]],
  ["Talent Acquisition Lead", ["hr", "talent-acquisition", 3]],
  ["Learning and Development Coordinator", ["hr", "learning", 1]],
  ["Learning & Development Manager", ["hr", "learning", 4]],
  ["Remuneration Analyst", ["hr", "reward", 2]],
  ["HRIS Analyst", ["hr", "hr-systems", 2]],

  // HR traps.
  ["Executive Assistant to the HR Director", null], // an EA, on no ladder here
  ["PA to Chief People Officer", null],
  ["Payroll Officer", null], // payroll is not (yet) a family
  ["HR & Payroll Officer", null],
  ["Recruitment Consultant", null], // agency sales ladder
  ["Barista $32/hr", null], // "hr" in pay text is not human resources
  ["Casual Cleaner - 24 hr roster", null],
  ["People Leader - Customer Service", null], // a line manager, not HR

  // Finance.
  ["Accounts Payable Officer", ["finance", "generalist", 1]],
  ["Assistant Accountant", ["finance", "generalist", 1]],
  ["Graduate Accountant", ["finance", "generalist", 1]],
  ["Management Accountant", ["finance", "generalist", 2]],
  ["Senior Accountant", ["finance", "generalist", 3]],
  ["Finance Business Partner", ["finance", "fpa", 3]],
  ["Financial Analyst", ["finance", "fpa", 2]],
  ["Finance Manager", ["finance", "generalist", 4]],
  ["Financial Controller", ["finance", "generalist", 4]],
  ["Finance Director", ["finance", "generalist", 5]],
  ["Chief Financial Officer", ["finance", "generalist", 6]],
  ["CFO", ["finance", "generalist", 6]],
  ["Tax Manager", ["finance", "tax", 4]],
  ["Project Accountant", ["finance", "generalist", 2]], // leaves project, lands here
  // Finance traps.
  ["Financial Planner", null],
  ["Mortgage Broker - Finance", null],
  ["Traffic Controller", null],
  ["Credit Controller", null],

  // Nursing — grade is in the noun.
  ["Assistant in Nursing", ["nursing", "generalist", 1]],
  ["Enrolled Nurse", ["nursing", "generalist", 1]],
  ["Registered Nurse", ["nursing", "generalist", 2]],
  ["Graduate Registered Nurse", ["nursing", "generalist", 2]],
  ["Registered Nurse - Emergency (Senior)", ["nursing", "generalist", 2]],
  ["Clinical Nurse", ["nursing", "generalist", 3]],
  ["Clinical Nurse Specialist - ICU", ["nursing", "generalist", 3]],
  ["Clinical Nurse Consultant", ["nursing", "generalist", 4]],
  ["Nurse Practitioner", ["nursing", "generalist", 4]],
  ["Nurse Unit Manager", ["nursing", "generalist", 4]],
  ["Assistant Director of Nursing", ["nursing", "generalist", 4]],
  ["Director of Nursing", ["nursing", "generalist", 5]],
  ["Executive Director of Nursing", ["nursing", "generalist", 6]],
  ["Registered Midwife", ["nursing", "midwifery", 2]],
  // Nursing traps.
  ["Cook - Nursing Home", null],
  ["Veterinary Nurse", null],

  // Project management — a PM runs a project, not a team.
  ["Project Coordinator", ["project", "generalist", 1]],
  ["Project Officer", ["project", "generalist", 2]],
  ["Assistant Project Manager", ["project", "generalist", 2]],
  ["Project Manager", ["project", "generalist", 3]],
  ["Senior Project Manager", ["project", "generalist", 4]],
  ["Program Manager", ["project", "generalist", 4]],
  ["Portfolio Manager - PMO", ["project", "generalist", 5]],
  ["Software Project Manager", ["project", "generalist", 3]],
  // Project traps.
  ["Project Engineer", null],
  ["Disability Support Worker - NDIS Program", null],
  ["Portfolio Manager - Investment", null],

  // Software engineering.
  ["Graduate Software Engineer", ["software", "generalist", 1]],
  ["Junior Developer", ["software", "generalist", 1]],
  ["Software Engineer", ["software", "generalist", 2]],
  ["Full Stack Developer", ["software", "generalist", 2]],
  ["Senior Software Engineer", ["software", "generalist", 3]],
  ["Tech Lead", null], // no family word — would need a "tech" family match
  ["Lead Software Engineer", ["software", "generalist", 3]],
  ["Staff Software Engineer", ["software", "generalist", 4]],
  ["Engineering Manager", ["software", "generalist", 4]],
  ["Head of Engineering", ["software", "generalist", 5]],
  ["CTO", ["software", "generalist", 6]],
  // Software traps.
  ["Software Sales Executive", null],
  ["Front End Loader Operator", null],
  ["Business Development Manager", null],

  // HSE.
  ["WHS Coordinator", ["hse", "generalist", 1]],
  ["Safety Advisor", ["hse", "generalist", 2]],
  ["Senior HSE Advisor", ["hse", "generalist", 3]],
  ["Senior Safety Officer", ["hse", "generalist", 3]],
  ["HSE Manager", ["hse", "generalist", 4]],
  ["Safety Superintendent", ["hse", "generalist", 4]],
  ["Head of Health & Safety", ["hse", "generalist", 5]],
  // HSE traps.
  ["Food Safety Officer", null],
  ["Health and Safety Representative", null],
];

let failures = 0;
for (const [title, want] of FIXTURES) {
  const got = placeTitle(title);
  const gotT = got ? [got.family, got.track, got.rung] : null;
  if (JSON.stringify(gotT) !== JSON.stringify(want)) {
    failures++;
    console.error(
      `✗ ${JSON.stringify(title)}\n    want ${JSON.stringify(want)}\n    got  ${JSON.stringify(gotT)}`,
    );
  }
}

// The canonical title strips location/contract tails but keeps the function.
const CANONICAL: [string, string][] = [
  ["HR Advisor - Perth", "hr advisor"],
  ["HR Business Partner (12 month contract)", "hr business partner"],
  ["Manager - Human Resources", "manager human resources"],
];
for (const [title, want] of CANONICAL) {
  const got = placeTitle(title)?.canonical;
  if (got !== want) {
    failures++;
    console.error(
      `✗ canonical ${JSON.stringify(title)}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
    );
  }
}

if (failures) {
  console.error(`\n${failures} career-ladder fixture(s) failed.`);
  process.exit(1);
}
console.log(`✓ ${FIXTURES.length + CANONICAL.length} career-ladder fixtures place correctly.`);
