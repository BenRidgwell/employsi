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
import { COMPANIES } from "../src/employsi/data/companies";
import {
  CURATED_RETAILERS,
  RETAIL_EMPLOYERS,
  employerFamilies,
} from "../src/employsi/lib/ladderEmployers";

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
  ["Software Sales Executive", ["sales", "generalist", 2]], // leaves software, lands here
  ["Front End Loader Operator", null],
  ["Business Development Manager", ["sales", "generalist", 3]],

  // Retail — the store ladder.
  ["Retail Assistant", ["retail", "generalist", 1]],
  ["Sales Assistant - Casual", ["retail", "generalist", 1]],
  ["Store Team Member", ["retail", "generalist", 1]],
  ["Checkout Operator", ["retail", "generalist", 1]],
  ["Night Fill Team Member", ["retail", "generalist", 1]],
  ["Retail Sales Consultant", ["retail", "generalist", 1]],
  ["Key Holder", ["retail", "generalist", 2]],
  ["Senior Sales Assistant", ["retail", "generalist", 2]],
  ["Store Supervisor", ["retail", "generalist", 2]],
  ["Assistant Store Manager", ["retail", "generalist", 3]],
  ["Retail Assistant Manager", ["retail", "generalist", 3]], // not "retail assistant"
  ["2IC - Retail", ["retail", "generalist", 3]],
  ["Department Manager - Supermarket", ["retail", "generalist", 3]],
  ["Trainee Store Manager", ["retail", "generalist", 3]],
  ["Store Manager", ["retail", "generalist", 4]],
  ["Retail Store Manager", ["retail", "generalist", 4]],
  ["Area Manager - Retail", ["retail", "generalist", 5]],
  ["State Retail Manager", ["retail", "generalist", 5]],
  ["Head of Retail", ["retail", "generalist", 5]],
  ["Visual Merchandiser", ["retail", "visual-merchandising", 2]],
  ["Senior Visual Merchandiser", ["retail", "visual-merchandising", 3]],
  ["Visual Merchandising Manager", ["retail", "visual-merchandising", 4]],
  // Retail traps.
  ["Storeperson", null], // warehousing
  ["Stores Officer - Mine Site", null],
  ["Retail Pharmacist", null],
  ["Shopfitter", null],
  ["Butcher - Supermarket", null],
  ["Retail Buyer", null], // head-office buying: not yet a ladder
  ["Store Development Manager", null], // property, not the store ladder
  ["Retail Banking Manager", null],
  ["Retail HR Business Partner", ["hr", "generalist", 3]], // HR is tried first

  // Sales — new business and account management.
  ["Sales Development Representative", ["sales", "generalist", 1]],
  ["BDR", ["sales", "generalist", 1]],
  ["Sales Coordinator", ["sales", "generalist", 1]],
  ["Graduate Sales Executive", ["sales", "generalist", 1]],
  ["Graduate Account Manager", ["sales", "account-management", 1]],
  ["Account Executive", ["sales", "generalist", 2]],
  ["Sales Representative", ["sales", "generalist", 2]],
  ["Territory Manager", ["sales", "generalist", 2]], // a rep, not a manager
  ["Business Development Executive", ["sales", "generalist", 2]],
  ["Account Manager", ["sales", "account-management", 2]], // IC, not a manager
  ["BDM - Construction", ["sales", "generalist", 3]],
  ["Senior Account Executive", ["sales", "generalist", 3]],
  ["Key Account Manager", ["sales", "account-management", 3]],
  ["National Account Manager", ["sales", "account-management", 3]],
  ["Senior Account Manager", ["sales", "account-management", 3]],
  ["Sales Team Leader", ["sales", "generalist", 3]],
  ["Assistant Sales Manager", ["sales", "generalist", 3]],
  ["Sales Manager", ["sales", "generalist", 4]],
  ["Area Sales Manager", ["sales", "generalist", 4]],
  ["Account Director", ["sales", "account-management", 4]],
  ["National Sales Manager", ["sales", "generalist", 5]],
  ["Head of Sales", ["sales", "generalist", 5]],
  ["Sales Director", ["sales", "generalist", 5]],
  ["Chief Revenue Officer", ["sales", "generalist", 6]],
  ["Safety Equipment Sales Representative", ["sales", "generalist", 2]], // before HSE
  // Sales traps.
  ["Presales Consultant", null],
  ["Sales Engineer", null],
  ["Sales Operations Analyst", null],
  ["Point of Sale Technician", null],
  ["Accounts Receivable Officer - Sales Ledger", ["finance", "generalist", 1]],

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

// THE EMPLOYER HINT. Same titles, placed with and without the advertiser.
// The hint may only ADD a family to a title whose words name none: a title that
// names its own function places identically whoever posts it.
const COLES = "melbourne-col";
const QANTAS = COMPANIES.find((c) => c.name === "Qantas Airways")?.id ?? "";
const WESFARMERS = "wes";
const EMPLOYER: [title: string, companyId: string, want: Want][] = [
  ["Team Member", COLES, ["retail", "generalist", 1]],
  ["Customer Service Manager", COLES, ["retail", "generalist", 3]],
  ["Customer Service Supervisor", COLES, ["retail", "generalist", 2]],
  ["Department Manager - Fresh", COLES, ["retail", "generalist", 3]],
  ["Assistant Manager", "melbourne-jbh", ["retail", "generalist", 3]],
  ["Sales Consultant", "sydney-hvn", ["retail", "generalist", 1]], // not B2B sales
  ["Console Operator", "priv-united-petroleum", ["retail", "generalist", 1]],
  ["Team Member", WESFARMERS, ["retail", "generalist", 1]],
  // The same titles with no hint, or from a non-retailer, are as before.
  ["Team Member", "", null],
  ["Sales Consultant", "", ["sales", "generalist", 2]],
  ["Customer Service Manager", QANTAS, null], // "Consumer & Retail", not a shop
  // The hint vouches for the ladder, not for everything the employer posts.
  ["Category Manager", COLES, null],
  ["Finance Manager", COLES, ["finance", "generalist", 4]],
  ["HR Business Partner", COLES, ["hr", "generalist", 3]],
  ["Duty Manager", "sydney-edv", null], // Endeavour's pubs
  ["Team Leader - Distribution Centre", COLES, null],
  ["Production Team Member", WESFARMERS, null], // WesCEF, not Bunnings
  ["Sales Consultant", "priv-suttons-motors", ["sales", "generalist", 2]], // car sales
];
for (const [title, id, want] of EMPLOYER) {
  const got = placeTitle(title, { employerFamilies: employerFamilies(id) });
  const gotT = got ? [got.family, got.track, got.rung] : null;
  if (JSON.stringify(gotT) !== JSON.stringify(want)) {
    failures++;
    console.error(
      `✗ ${JSON.stringify(title)} at ${id || "(no employer)"}\n    want ${JSON.stringify(want)}\n    got  ${JSON.stringify(gotT)}`,
    );
  }
}
if (!QANTAS) {
  failures++;
  console.error("✗ Qantas Airways is no longer in the roster — pick another non-store fixture.");
}

// A curated id that stops resolving drops a retailer without a sound.
const ids = new Set(COMPANIES.map((c) => c.id));
for (const [id, name] of Object.entries(CURATED_RETAILERS)) {
  if (!ids.has(id)) {
    failures++;
    console.error(`✗ curated retailer ${id} (${name}) is not a roster company id`);
  }
}
// And the mixed sector must never be let in wholesale: it holds airlines,
// brewers and tobacco. If this fires, someone widened RETAIL_SECTOR.
for (const c of COMPANIES) {
  if (
    c.sector === "Consumer & Retail" &&
    RETAIL_EMPLOYERS.has(c.id) &&
    !(c.id in CURATED_RETAILERS)
  ) {
    failures++;
    console.error(
      `✗ ${c.name} entered the retail set through the mixed "Consumer & Retail" sector`,
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
console.log(
  `✓ ${FIXTURES.length + EMPLOYER.length + CANONICAL.length} career-ladder fixtures place correctly; ` +
    `${RETAIL_EMPLOYERS.size} retail employers resolve.`,
);
