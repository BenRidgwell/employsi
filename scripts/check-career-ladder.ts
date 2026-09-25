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
import {
  FAMILIES,
  NOT_A_LADDER,
  PATHWAYS_PLANNED,
  placeTitle,
  type Rung,
} from "../src/employsi/lib/careerLadder";
import { ALL_SKILLS } from "../src/employsi/data/skillsTaxonomy";
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
  // An EA is on the ADMIN ladder — never the ladder of the executive supported.
  // (These were null until the admin family existed, 2026-09-25.)
  ["Executive Assistant to the HR Director", ["admin", "executive-assistant", 2]],
  ["PA to Chief People Officer", ["admin", "executive-assistant", 2]],
  // Payroll is its own family since 2026-09-25, not HR's.
  ["Payroll Officer", ["payroll", "generalist", 2]],
  ["HR & Payroll Officer", ["payroll", "generalist", 2]],
  ["Recruitment Consultant", null], // agency sales ladder
  ["Barista $32/hr", ["hospitality", "generalist", 1]], // "hr" in pay text is not HR
  ["Casual Cleaner - 24 hr roster", ["facilities", "generalist", 1]], // not HR
  ["People Leader - Customer Service", null], // a line manager, not HR
  // HR, from the 2026-09-24 audit. Ad boilerplate in the title named a track.
  ["HR Assistant (Entry Level, Training Provided)", ["hr", "generalist", 1]], // not L&D
  ["HR Specialist - Training Provided, Up to 4k", ["hr", "generalist", 2]],
  ["Project Manager - Pharma West - Attractive Remuneration", ["project", "generalist", 3]],
  [
    "Construction Manager - Pharma West - Attractive Remuneration",
    ["construction", "generalist", 4],
  ], // was HR reward 4
  // Workplace-relations LAWYERS practise employment law; they are not on the ER ladder.
  // …they are on the LEGAL ladder, since 2026-09-25 — never HR's.
  ["Senior Associate - Workplace Relations, Employment & Safety", ["legal", "generalist", 3]],
  ["Workplace Relations Lawyer", ["legal", "generalist", 2]],
  ["Solicitor, Employment & Industrial Relations", ["legal", "generalist", 2]],
  ["Senior Legal Counsel - Employee Relations", ["legal", "in-house", 3]],
  ["Internship - Chief of Staff to the Chief HR Officer", null], // was rung 6
  ["Head, Employee Relations", ["hr", "employee-relations", 5]],
  // Heavy rigid licence: the driving ladder since 2026-09-25, never HR.
  ["HR Driver", ["logistics", "driving", 2]],
  ["HR Truck Drivers - Casual", ["logistics", "driving", 2]],
  // A project or product manager whose PRODUCT is HR is on the project ladder.
  ["Senior Project Manager - HRIS", ["project", "generalist", 4]],
  ["Principal Product Manager - Talent Acquisition Applications", ["product", "product", 4]],
  // Bank titles: VP is a grade, the noun is the job.
  ["HR Business Partner - Vice President", ["hr", "generalist", 3]],
  ["Vice President, Human Resources", ["hr", "generalist", 5]],
  // A title spanning several rungs is on none of them.
  ["Manager / Senior Manager Employee Relations", null],

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
  // Advice and lending are the BANKING ladder since 2026-09-25, not finance's.
  ["Financial Planner", ["banking", "advice", 2]],
  ["Mortgage Broker - Finance", ["banking", "lending", 2]],
  ["Traffic Controller", ["trades", "generalist", 1]], // road works, not finance
  ["Credit Controller", null],
  // Finance, from the 2026-09-24 audit. "CFO Advisory" is a Big-4 practice, not a CFO.
  ["Analyst - CFO Advisory - Perth", ["finance", "generalist", 2]], // was rung 6
  ["Finance Advisory Manager - CFO Advisory", ["finance", "generalist", 4]],
  ["Senior Consultant - EY Finance - CFO Advisory", ["finance", "generalist", 3]],
  ["Manager, Finance Business Partner - CFO Technology & Innovation", ["finance", "fpa", 4]],
  ["Accounts Payable Manager", ["finance", "generalist", 4]], // was rung 1
  ["Accounts Payable Supervisor", ["finance", "generalist", 3]],
  ["Senior Manager - Trust Treasury and Accounts Payable", ["finance", "treasury", 4]],
  ["Accounts Receivable Specialist - Commercial Real Estate", ["finance", "generalist", 1]],
  ["Assistant Vice President, Stress Testing - Global Treasury", ["finance", "treasury", 4]],
  // Advice, bank sales and financial-crime compliance use the word; not accounting.
  ["Personal Financial Consultant", null],
  ["Bancassurance Financial Executive", null],
  ["Financial Aid Specialist", null],
  ["Senior Financial Crime Compliance Specialist", ["risk", "compliance", 3]],
  [
    "Director of Employee and Community Engagement - Banking and Financial Services",
    ["community", "generalist", 5],
  ],
  // Multi-rung expressions of interest.
  ["Senior Manager or Director - Treasury and Risk", null],
  ["EOI - Private Tax Specialists (Senior Associate, Manager, Senior Manager, Director)", null],
  ["Tax Manager to Director $100k", null],

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
  ["Cook - Nursing Home", ["hospitality", "kitchen", 2]], // a cook, not a nurse
  ["Veterinary Nurse", ["science", "veterinary", 1]], // animals: not the nursing ladder
  // Nursing, from the 2026-09-24 audit.
  ["Registered Nurses - Anaesthetics", ["nursing", "generalist", 2]], // plural
  ["Licensed Practical Nurse", ["nursing", "generalist", 1]], // the US enrolled nurse
  ["Registered Practical Nurse", ["nursing", "generalist", 1]], // Canada's
  ["Nurse Clinical Specialist", ["nursing", "generalist", 3]],
  ["Senior Staff Nurse", ["nursing", "generalist", 3]],
  ["Associate Nursing Unit Manager", ["nursing", "generalist", 4]],
  ["Assistant Nursing Director", ["nursing", "generalist", 4]],
  ["Associate Director of Nursing", ["nursing", "generalist", 4]],
  ["Executive Support Officer - Director of Nursing", ["admin", "executive-assistant", 2]], // not nursing
  ["Registered Nurse or Enrolled Nurse", null], // two rungs
  // Academia: the education family's academic track since 2026-09-25.
  ["Associate Professor - Nursing", ["education", "academic", 4]],
  ["Lecturer in Nursing", ["education", "academic", 2]],

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
  ["Project Engineer", ["engineering", "generalist", 2]], // engineering, not project management
  ["Disability Support Worker - NDIS Program", null],
  ["Portfolio Manager - Investment", null],
  // Project, from the 2026-09-24 audit. Project controls is a ladder of its own.
  ["Project Scheduler", ["project", "controls", 2]],
  ["Project Controller", ["project", "controls", 2]],
  ["Senior Project Planner", ["project", "controls", 3]],
  ["Project Controls Lead", ["project", "controls", 3]],
  ["Principal Project Planner", ["project", "controls", 4]],
  ["Project Controls Manager", ["project", "controls", 4]], // was rung 2
  ["Senior Manager Project Controls", ["project", "controls", 4]],
  ["Junior Project Manager", ["project", "generalist", 2]],
  ["Associate Project Manager", ["project", "generalist", 2]],
  ["Principal Project Officer", ["project", "generalist", 3]],
  ["Assistant Project Manager / Project Manager", null],
  ["Expression of Interest - Project Manager / Senior Project Manager", null],
  ["Internal Medicine Residency Program Director", null],
  ["2026 Vacation Program - Operations Melbourne", null], // a student scheme
  ["2027 BlueScope Cadetship Program", null],
  ["Project Management Officer", ["project", "generalist", 2]],
  ["PMO Lead", ["project", "generalist", 3]],
  ["Senior Manager, Project Management", ["project", "generalist", 4]],

  // Software engineering.
  ["Graduate Software Engineer", ["software", "generalist", 1]],
  ["Junior Developer", ["software", "generalist", 1]],
  ["Software Engineer", ["software", "generalist", 2]],
  ["Full Stack Developer", ["software", "generalist", 2]],
  ["Senior Software Engineer", ["software", "generalist", 3]],
  ["Tech Lead", null], // no family word — would need a "tech" family match
  ["Lead Software Engineer", ["software", "generalist", 3]],
  ["Staff Software Engineer", ["software", "generalist", 4]],
  // A bare "Engineering Manager" is software at REA and building maintenance at
  // Marriott — only the employer can say which (see the EMPLOYER fixtures).
  ["Engineering Manager", null],
  ["Head of Engineering", null],
  ["Software Engineering Manager", ["software", "generalist", 4]],
  ["Head of Software Engineering", ["software", "generalist", 5]],
  ["CTO", ["software", "generalist", 6]],
  // Software traps.
  ["Software Sales Executive", ["sales", "generalist", 2]], // leaves software, lands here
  ["Front End Loader Operator", ["operations", "mining", 2]], // plant, not software
  ["Business Development Manager", ["sales", "generalist", 3]],
  // Software, from the 2026-09-24 audit.
  ["Staff Platform Engineer", ["software", "generalist", 4]],
  ["Costco Perth Airport Front End Cashier Assistant", ["retail", "generalist", 1]],
  ["Software Asset Management Coordinator", null],
  ["Executive Business Partner, Office of the CEO and CTO", ["admin", "executive-assistant", 2]], // an EA
  ["Field CTO", null],
  ["Deputy Chief Technology Officer", ["software", "generalist", 5]],

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
  ["Storeperson", ["logistics", "generalist", 1]], // warehousing, not retail
  ["Stores Officer - Mine Site", null],
  ["Retail Pharmacist", ["allied", "pharmacy", 2]], // a pharmacist, not a store rung
  ["Shopfitter", ["trades", "generalist", 2]], // a trade, not a store rung
  ["Butcher - Supermarket", ["hospitality", "food-trades", 2]], // a trade, not a store rung
  ["Retail Buyer", ["procurement", "buying", 2]], // head-office buying, not a store rung
  ["Store Development Manager", null], // property, not the store ladder
  ["Retail Banking Manager", ["banking", "generalist", 3]], // a bank, not a shop
  ["Retail HR Business Partner", ["hr", "generalist", 3]], // HR is tried first
  // Retail, from the 2026-09-24 audit.
  ["Nightfill Manager", ["retail", "generalist", 3]], // was rung 1
  ["Assistant Nightfill Manager", ["retail", "generalist", 3]],
  ["Retail Salesperson", ["retail", "generalist", 1]],
  ["Retail Sales Associates", ["retail", "generalist", 1]],
  ["Retail Department Leader", ["retail", "generalist", 3]],
  // "Retail" as the INDUSTRY of a head-office role is not the store ladder.
  ["Performance Media Specialist - Retail Media", null],
  ["Retail Marketing Manager", ["marketing", "generalist", 4]],
  ["Retail Implementation Specialist", null],
  ["Regional Manager - Retail Lease Admin", null],
  ["Stores and Supply Officer", null],
  ["Retail Design Manager", null], // store fit-out design: ambiguous, and not a store rung
  ["Store Account Manager", null],
  // Supermarket department managers — in store, beside "Department Manager".
  ["Store Support Manager - Coles Supermarkets - Dubbo Southlakes", ["retail", "generalist", 3]],
  ["Fresh Produce Manager - Coles Supermarket Coburg North", ["retail", "generalist", 3]],
  ["Health and Safety Business Partner - Safer Retail", ["hse", "generalist", 3]],

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
  // Sales, from the 2026-09-24 audit.
  ["Assistant Director of Sales", ["sales", "generalist", 4]], // was rung 5
  ["Associate Director of Sales", ["sales", "generalist", 4]],
  ["Key Account Support", ["sales", "account-management", 1]], // was rung 3
  ["Key Account Coordinator", ["sales", "account-management", 1]],
  ["Senior Named Account Executive", ["sales", "generalist", 3]],
  ["Senior Client Account Manager", ["sales", "account-management", 3]],
  ["Senior Ready Mix Sales Representative", ["sales", "generalist", 3]],
  ["Sales Lead Generator", ["sales", "generalist", 1]], // not a sales lead
  ["SVP Energy & Materials Sales Manager", ["sales", "generalist", 4]], // bank grade
  ["Senior Vice President, Sales", ["sales", "generalist", 6]],
  ["SALES SUPERVISOR", ["sales", "generalist", 3]],
  ["Sales & Marketing Executive", ["sales", "generalist", 2]],
  ["Manager, Business Development", ["sales", "generalist", 3]],
  ["Business Development Specialist", ["sales", "generalist", 2]],
  ["Business Development Coordinator", ["sales", "generalist", 1]],
  ["Lead - Business Development", ["sales", "generalist", 3]],
  ["Manager Sales and Distribution", ["sales", "generalist", 4]],
  ["AVP Sales and Distribution", ["sales", "generalist", 4]],
  ["Director, Business Development", ["sales", "generalist", 5]],
  ["Sales Officer", ["sales", "generalist", 2]],
  ["Account Management Team Leader", ["sales", "account-management", 3]],
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

  // ---- Wave 1 of the parent-skill coverage (2026-09-25) --------------------
  // Real titles from the 90-day archive, read before the rules were written.

  // Payroll: administrator → officer → senior → team lead → manager → head.
  ["Payroll Administrator", ["payroll", "generalist", 1]],
  ["Payroll Coordinator", ["payroll", "generalist", 1]],
  ["Payroll Specialist", ["payroll", "generalist", 2]],
  ["Payroll Analyst", ["payroll", "generalist", 2]],
  ["Senior Payroll Officer - Brisbane", ["payroll", "generalist", 3]],
  ["Senior Payroll Analyst", ["payroll", "generalist", 3]],
  ["Payroll Team Leader", ["payroll", "generalist", 3]],
  ["Payroll Manager", ["payroll", "generalist", 4]],
  ["National Payroll Manager", ["payroll", "generalist", 5]],
  ["Head of Payroll", ["payroll", "generalist", 5]],
  // Payroll traps: the word, another ladder.
  ["Payroll Accountant", ["finance", "generalist", 2]],
  ["Payroll Tax Administrator", ["finance", "tax", 1]],
  ["Payroll Project Manager", ["project", "generalist", 3]],
  ["Senior Business Analyst - SAP Payroll - Sydney", ["product", "generalist", 3]],

  // HR gaps the audit found.
  ["Workforce Planner", ["hr", "workforce", 2]],
  ["Workforce Planning Officer", ["hr", "workforce", 2]],
  ["Senior Manager Workforce Planning", ["hr", "workforce", 4]],
  ["Recruitment Administrator", ["hr", "talent-acquisition", 1]],
  ["Recruitment Assistant", ["hr", "talent-acquisition", 1]],
  ["Talent Advisor", ["hr", "talent-acquisition", 2]],
  ["Training and Development Manager", ["hr", "learning", 4]],
  ["Recruitment & Mobilisation Coordinator", ["hr", "talent-acquisition", 1]],

  // Hospitality — the kitchen: kitchenhand → cook → chef → sous → head → executive.
  ["Kitchenhand", ["hospitality", "kitchen", 1]],
  ["Kitchen Assistant", ["hospitality", "kitchen", 1]],
  ["Commis Chef", ["hospitality", "kitchen", 1]],
  ["Assistant Cook", ["hospitality", "kitchen", 1]],
  ["Cook", ["hospitality", "kitchen", 2]],
  ["Chef", ["hospitality", "kitchen", 2]],
  ["Demi Chef de Partie", ["hospitality", "kitchen", 2]],
  ["Chef de Partie", ["hospitality", "kitchen", 2]],
  ["Senior Cook", ["hospitality", "kitchen", 3]],
  ["Junior Sous Chef", ["hospitality", "kitchen", 3]],
  ["Sous Chef", ["hospitality", "kitchen", 3]],
  ["Head Chef", ["hospitality", "kitchen", 4]],
  ["Chef de Cuisine", ["hospitality", "kitchen", 4]],
  ["Executive Sous Chef", ["hospitality", "kitchen", 4]],
  ["Executive Chef", ["hospitality", "kitchen", 5]],
  // Front of house: attendant → supervisor → assistant manager → manager → director.
  ["Food and Beverage Attendant", ["hospitality", "generalist", 1]],
  ["Bartender", ["hospitality", "generalist", 1]],
  ["Waiter / Waitress", ["hospitality", "generalist", 1]],
  ["Cafe Team Member", ["hospitality", "generalist", 1]],
  ["Restaurant Captain", ["hospitality", "generalist", 2]],
  ["F&B Supervisor", ["hospitality", "generalist", 2]],
  ["Head Bartender", ["hospitality", "generalist", 2]],
  ["Assistant Restaurant Manager", ["hospitality", "generalist", 3]],
  ["Food and Beverage Duty Manager", ["hospitality", "generalist", 3]],
  ["Restaurant Manager", ["hospitality", "generalist", 4]],
  ["Catering Manager", ["hospitality", "generalist", 4]],
  ["Director of Food and Beverage", ["hospitality", "generalist", 5]],
  // Bakers and butchers: a trade ladder of their own.
  ["Apprentice Baker", ["hospitality", "food-trades", 1]],
  ["Baker - Coles Supermarkets Maroochydore", ["hospitality", "food-trades", 2]],
  ["Head Baker", ["hospitality", "food-trades", 3]],
  // Hospitality traps.
  ["Hospitality Assistant / Cleaner", ["facilities", "generalist", 1]], // cleaning, not food
  ["Chef de Projet H/F", null], // French: a project manager
  ["Catering Sales Manager", ["sales", "generalist", 4]], // sales is tried first
  ["Bakery Assistant Manager", ["hospitality", "food-trades", 3]], // no employer: a bakery

  // Education — schools: aide → teacher → leading teacher → HoD/deputy → principal.
  ["Teacher Aide", ["education", "education-support", 1]],
  ["School Learning Support Officer - Full Time Ongoing", ["education", "education-support", 1]],
  ["Education Assistant (Special Needs)", ["education", "education-support", 1]],
  ["Graduate Teacher", ["education", "generalist", 1]],
  ["Teacher - Primary", ["education", "generalist", 2]],
  ["Classroom Teacher - English", ["education", "generalist", 2]],
  ["TAFE Teacher - Fitting and Machining", ["education", "generalist", 2]],
  ["Leading Teacher Range 3", ["education", "generalist", 3]],
  ["Learning Specialist", ["education", "generalist", 3]],
  ["Head Teacher - PDHPE", ["education", "generalist", 4]],
  ["Head of Department - Mathematics", ["education", "generalist", 4]],
  ["Assistant Principal Range 1", ["education", "generalist", 4]],
  ["Deputy Principal", ["education", "generalist", 4]],
  ["Principal - St Joseph's School Nambour", ["education", "generalist", 5]],
  ["Principal Range 4", ["education", "generalist", 5]],
  // Early childhood: educator → ECT/senior → room/educational leader → centre director.
  ["Educator", ["education", "early-childhood", 1]],
  ["Casual Educator", ["education", "early-childhood", 1]],
  ["Trainee Educator", ["education", "early-childhood", 1]],
  ["Early Childhood Teacher", ["education", "early-childhood", 2]],
  ["Senior Educator", ["education", "early-childhood", 2]],
  ["Room Leader", ["education", "early-childhood", 3]],
  ["Educational Leader", ["education", "early-childhood", 3]],
  ["Assistant Centre Director", ["education", "early-childhood", 3]],
  ["Centre Director - Early Learning", ["education", "early-childhood", 4]],
  // Academic: associate lecturer → lecturer → senior → associate professor → professor.
  ["Associate Lecturer - Psychology", ["education", "academic", 1]],
  ["Lecturer", ["education", "academic", 2]],
  ["Senior Lecturer in Medical Education", ["education", "academic", 3]],
  ["Professor and Head of School, School of Social Sciences", ["education", "academic", 5]],
  // Education traps. "Principal" is a school's top rung and everyone else's grade.
  ["Principal Engineer HV Primary", ["engineering", "electrical", 4]], // not a school
  ["Principal HPC and Storage Architect", ["technology", "architecture", 4]], // not a school
  ["Principal Analyst", null],
  ["Clinical Educator", null], // clinical education: not a school ladder
  ["Diabetes Educator", null],
  ["Entry Level to Experienced Teacher (Queens)", null], // two rungs at once
  ["Lecturer / Senior Lecturer - Psychology", null],

  // Transport & warehousing. Warehouse: storeperson → forklift → supervisor → manager.
  ["Storeperson", ["logistics", "generalist", 1]],
  ["Warehouse Assistant", ["logistics", "generalist", 1]],
  ["Pick Packer Team Member - Nerang", ["logistics", "generalist", 1]],
  ["Forklift Operator", ["logistics", "generalist", 2]],
  ["Senior Storeperson", ["logistics", "generalist", 2]],
  ["Warehouse Team Leader", ["logistics", "generalist", 3]],
  ["Warehouse Supervisor", ["logistics", "generalist", 3]],
  ["Warehouse 2IC", ["logistics", "generalist", 3]],
  ["Warehouse Manager", ["logistics", "generalist", 4]],
  ["Superintendent Warehouse", ["logistics", "generalist", 4]],
  ["Head of Logistics", ["logistics", "generalist", 5]],
  // Driving: van / MR → HR / truck / bus → HC / MC / CDL-A.
  ["Delivery Driver", ["logistics", "driving", 1]],
  ["MR Driver", ["logistics", "driving", 1]],
  ["Truck Driver", ["logistics", "driving", 2]],
  ["Heavy Rigid Truck Driver", ["logistics", "driving", 2]],
  ["Bus Driver", ["logistics", "driving", 2]],
  ["HC Driver", ["logistics", "driving", 3]],
  ["MC Driver", ["logistics", "driving", 3]],
  ["CDL-A Company Driver", ["logistics", "driving", 3]],
  ["Transport Supervisor", ["logistics", "driving", 3]],
  ["Transport Manager", ["logistics", "driving", 4]],
  // Transport traps: gig platforms are not an employer's ladder.
  ["Amazon Flex Delivery Driver - Earn $14", null],
  ["Instacart Shopper & Delivery Driver - Flexible Hours", null],
  ["Delivery Driver - Sign Up and Start Earning", null],
  ["Dashers - Sign Up and Start Earning", null],
  ["DC Team Member", ["logistics", "generalist", 1]], // no employer: still a DC role

  // Administration: assistant → officer → senior → office manager.
  ["Receptionist", ["admin", "generalist", 1]],
  ["Administration Assistant", ["admin", "generalist", 1]],
  ["Ward Clerk", ["admin", "generalist", 1]],
  ["Site Administrator", ["admin", "generalist", 1]],
  ["Administration Officer", ["admin", "generalist", 2]],
  ["Medical Secretary", ["admin", "generalist", 2]],
  ["Senior Administration Officer", ["admin", "generalist", 3]],
  ["Assistant Front Office Manager", ["admin", "generalist", 3]],
  ["Office Manager", ["admin", "generalist", 4]],
  ["Administration Manager", ["admin", "generalist", 4]],
  ["Practice Manager", ["admin", "generalist", 4]],
  // Executive assistants: their own track.
  ["Executive Assistant", ["admin", "executive-assistant", 2]],
  ["Personal Assistant", ["admin", "executive-assistant", 2]],
  ["Senior Executive Assistant", ["admin", "executive-assistant", 3]],
  // Admin traps.
  ["Contracts Administrator", ["commercial", "generalist", 2]], // not admin
  ["SharePoint Administrator (NV1 clearance)", ["technology", "generalist", 2]], // not admin
  ["Company Secretary", ["legal", "in-house", 4]], // governance, not admin
  ["HR Administrator", ["hr", "generalist", 1]], // the function wins
  ["Project Administrator", ["project", "generalist", 1]],
  ["Chief of Staff", null],
  // Found by the whole-archive diff after the first wave-1 pass (2026-09-25).
  ["Executive Assistant Manager - Hotel", null], // a hotel's deputy GM, not an EA
  ["Senior Executive Assistant Manager", null],
  ["Associate Lecturer / Lecturer in Nursing", null], // two grades
  ["Senior Lecturer / Associate Professor in Law", null],
  ["Assistant Professor of Economics", ["education", "academic", 3]], // US tenure track
  ["Sessional Academic Tutor", ["education", "academic", 1]],
  ["Instrumental Music Tutor", null], // private tuition, not a school ladder
  ["Private Tutor", null],
  ["$350 60min Paid Market Research Study for Head of Logistics", null], // not a job
  ["Baker Hughes Malaysia Bootcamp 2026", null], // an oilfield company
  ["Coffee Barista - Tiong Bahru Bakery", ["hospitality", "generalist", 1]],
  // Wave 1 audit top-ups (2026-09-25).
  ["Restaurant Delivery - Sign Up and Start Earning", null], // gig
  ["Driver - Get Paid Daily", null],
  ["F&B Service Expert", ["hospitality", "generalist", 1]],
  ["Restaurant Server", ["hospitality", "generalist", 1]],
  ["F&B Executive", ["hospitality", "generalist", 2]],
  ["Food and Beverage Operations Manager", ["hospitality", "generalist", 4]],
  ["Restaurant General Manager", ["hospitality", "generalist", 4]],
  ["Driver Class A - $7K Sign On Bonus", ["logistics", "driving", 3]],
  ["Shuttle Driver - Class B Required", ["logistics", "driving", 2]],
  ["Lorry Driver", ["logistics", "driving", 2]],
  ["Dispatch Team Member", ["logistics", "generalist", 1]],
  ["Logistics Operations Coordinator", ["logistics", "generalist", 2]],
  ["Medical Screener - Reception Technician (Customer Service)", ["admin", "generalist", 1]],
  ["Administration Coordinator", ["admin", "generalist", 1]],
  ["Office Coordinator", ["admin", "generalist", 1]],
  ["Administrative Executive", ["admin", "generalist", 2]],
  ["Cyber Technical Lead - Identity Governance & Administration", ["technology", "security", 3]],
  ["Teaching Fellow - Business", ["education", "academic", 2]],
  ["Teaching Associate, School of Computing", ["education", "academic", 1]],
  ["Preschool Center Director", ["education", "early-childhood", 4]],
  ["HR and Payroll Generalist", ["payroll", "generalist", 2]],
  ["Payroll Business Partner", ["payroll", "generalist", 3]],
  ["Director HR Systems & Payroll", ["payroll", "generalist", 5]],

  // ---- Wave 2: corporate professions (2026-09-25) --------------------------
  // Legal. Private practice: graduate → lawyer → senior associate → special
  // counsel → partner. In-house: legal counsel → senior → principal → GC.
  ["Paralegal", ["legal", "generalist", 1]],
  ["Graduate Lawyer", ["legal", "generalist", 1]],
  ["Lawyer (2-4 PQE) - Commercial Litigation", ["legal", "generalist", 2]],
  ["Solicitor", ["legal", "generalist", 2]],
  ["Senior Associate - Construction", ["legal", "generalist", 3]],
  ["Special Counsel - Insurance", ["legal", "generalist", 4]],
  ["Partner - Banking and Finance", ["legal", "generalist", 5]],
  ["Legal Counsel", ["legal", "in-house", 2]],
  ["Senior Legal Counsel - Technology, Data and IP", ["legal", "in-house", 3]],
  ["Principal Legal Officer", ["legal", "in-house", 4]],
  ["General Counsel", ["legal", "in-house", 5]],
  ["Chief Legal Officer", ["legal", "in-house", 6]],
  ["Legal Secretary", ["admin", "generalist", 2]], // support, on the admin ladder
  ["Genetic Counsellor", null],

  // Insurance: claims, underwriting, actuarial.
  ["Claims Officer", ["insurance", "claims", 2]],
  ["Senior Claims Consultant", ["insurance", "claims", 3]],
  ["Claims Manager", ["insurance", "claims", 4]],
  ["Underwriter", ["insurance", "underwriting", 2]],
  ["Senior Underwriter", ["insurance", "underwriting", 3]],
  ["Actuarial Intern", ["insurance", "actuarial", 1]],
  ["Actuarial Analyst", ["insurance", "actuarial", 2]],
  ["Senior Actuarial Analyst", ["insurance", "actuarial", 3]],
  ["Actuarial Manager", ["insurance", "actuarial", 4]],
  ["Head of Actuarial Services", ["insurance", "actuarial", 5]],
  ["Insurance Agent - Colorado", null], // commission sales, not the insurance ladder
  ["Finance and Insurance Consultant", null], // a car dealership's F&I desk
  ["Insurance Planner", null],
  ["Mandataire d'assurance F/H (Indépendant)", null], // French: an insurance agent

  // Risk, compliance & audit.
  ["Compliance Officer", ["risk", "compliance", 2]],
  ["Risk Analyst", ["risk", "generalist", 2]],
  ["Senior Risk Advisor", ["risk", "generalist", 3]],
  ["Operational Risk Manager", ["risk", "generalist", 4]],
  ["Internal Auditor", ["risk", "audit", 2]],
  ["Assistant Manager - Audit and Assurance", ["risk", "audit", 3]],
  ["Head of Internal Audit", ["risk", "audit", 5]],
  ["Chief Risk Officer", ["risk", "generalist", 6]],
  ["Credit Risk Manager", ["risk", "generalist", 4]], // risk is tried before banking

  // Quality (QA/QC).
  ["QC Inspector", ["quality", "generalist", 1]],
  ["Quality Assurance Officer", ["quality", "generalist", 2]],
  ["QA/QC Engineer", ["quality", "generalist", 2]],
  ["QA QC Supervisor", ["quality", "generalist", 3]],
  ["Quality Manager", ["quality", "generalist", 4]],
  ["Head of Quality", ["quality", "generalist", 5]],
  ["Senior Quality Assurance Engineer - Software", ["software", "generalist", 3]], // a tester

  // Banking: branch → lending → relationship; advice; investment banking.
  ["Bank Teller", ["banking", "generalist", 1]],
  ["Banking Consultant", ["banking", "generalist", 2]],
  ["Customer Banking Specialist", ["banking", "generalist", 2]],
  ["Branch Manager - Retail Banking", ["banking", "generalist", 4]],
  ["Lending Assessment Officer", ["banking", "lending", 2]],
  ["Home Lending Executive", ["banking", "lending", 2]],
  ["Branch Lending Manager", ["banking", "lending", 3]],
  ["Business Banking Manager", ["banking", "relationship", 3]],
  ["Relationship Manager - Premier Banking", ["banking", "relationship", 3]],
  ["Senior Relationship Manager", ["banking", "relationship", 4]],
  ["Paraplanner", ["banking", "advice", 1]],
  ["Financial Adviser", ["banking", "advice", 2]],
  ["Private Wealth Adviser", ["banking", "advice", 2]],
  ["Analyst - Investment Banking", ["banking", "investment-banking", 2]],
  ["Associate, Natural Resources Investment Banking", ["banking", "investment-banking", 3]],
  ["Vice President, Infrastructure Investment Banking", ["banking", "investment-banking", 4]],
  ["Member Experience Officer - Heritage Bank Gatton", ["banking", "generalist", 2]],
  ["Credit Controller - Accounts", null], // collections, not lending

  // Marketing & communications.
  ["Marketing Assistant", ["marketing", "generalist", 1]],
  ["Marketing Coordinator", ["marketing", "generalist", 1]],
  ["Marketing Executive", ["marketing", "generalist", 2]],
  ["Digital Marketing Specialist", ["marketing", "generalist", 2]],
  ["Brand Manager", ["marketing", "generalist", 3]],
  ["Senior Marketing Executive", ["marketing", "generalist", 3]],
  ["Marketing Manager", ["marketing", "generalist", 4]],
  ["Head of Marketing", ["marketing", "generalist", 5]],
  ["Chief Marketing Officer", ["marketing", "generalist", 6]],
  ["Communications Officer", ["marketing", "communications", 2]],
  ["Senior Communications Advisor", ["marketing", "communications", 3]],
  ["Public Relations Officer", ["marketing", "communications", 2]],
  ["Brand Ambassador", null], // promotional staff
  ["Communications Technician", null], // telecoms
  ["Sales and Marketing Executive", ["sales", "generalist", 2]], // sales first

  // Procurement, buying & supply chain.
  ["Procurement Officer", ["procurement", "generalist", 2]],
  ["Procurement Specialist", ["procurement", "generalist", 2]],
  ["Senior Procurement Advisor", ["procurement", "generalist", 3]],
  ["Procurement Category Manager", ["procurement", "generalist", 4]],
  ["Procurement Manager", ["procurement", "generalist", 4]],
  ["Chief Procurement Officer", ["procurement", "generalist", 6]],
  ["Assistant Buyer", ["procurement", "buying", 1]],
  ["Senior Buyer", ["procurement", "buying", 3]],
  ["Supply Chain Analyst", ["procurement", "supply-chain", 2]],
  ["Demand Planner", ["procurement", "supply-chain", 2]],
  ["Supply Chain Manager", ["procurement", "supply-chain", 4]],
  ["Media Buyer", null], // advertising

  // Commercial & contracts (construction and infrastructure).
  ["Senior Contract Administrator", ["commercial", "generalist", 3]],
  ["Contracts Manager", ["commercial", "generalist", 4]],
  ["Commercial Manager", ["commercial", "generalist", 4]],
  ["Commercial Director", ["commercial", "generalist", 5]],
  ["Cadet Quantity Surveyor", ["commercial", "quantity-surveying", 1]],
  ["Quantity Surveyor", ["commercial", "quantity-surveying", 2]],
  ["Senior Quantity Surveyor", ["commercial", "quantity-surveying", 3]],
  ["Estimator", ["commercial", "quantity-surveying", 2]],
  ["Commercial Electrician", ["trades", "electrical", 2]], // a trade, not commercial
  ["Commercial Finance Manager", ["finance", "fpa", 4]], // finance is tried first

  // Policy.
  ["Assistant Policy Officer", ["policy", "generalist", 1]],
  ["Policy Officer", ["policy", "generalist", 2]],
  ["Senior Policy Advisor", ["policy", "generalist", 3]],
  ["Principal Policy Officer", ["policy", "generalist", 4]],
  ["Director, Strategic Policy", ["policy", "generalist", 5]],
  ["Senior Ministerial Liaison Officer", ["policy", "generalist", 3]],
  ["Cabinet Maker Apprentice", ["trades", "generalist", 1]], // carpentry, not cabinet
  ["Policy Administrator - Insurance", ["admin", "generalist", 1]], // not the policy ladder

  // Business analysis & product.
  ["Junior Business Analyst", ["product", "generalist", 1]],
  ["Business Analyst", ["product", "generalist", 2]],
  ["Senior Business Analyst", ["product", "generalist", 3]],
  ["Lead Business Analyst", ["product", "generalist", 3]],
  ["Associate Product Manager", ["product", "product", 2]],
  ["Product Owner", ["product", "product", 3]],
  ["Product Manager", ["product", "product", 3]], // runs a product, not a team
  ["Senior Product Manager", ["product", "product", 4]],
  ["Head of Product", ["product", "product", 5]],
  ["Chief Product Officer", ["product", "product", 6]],
  ["Product Manager - Retail Deposits", ["product", "product", 3]], // a bank, not a shop
  ["Product Marketing Manager", ["marketing", "generalist", 4]], // marketing first

  // Data & AI.
  ["Graduate Data Engineer", ["data", "engineering", 1]],
  ["Data Analyst", ["data", "generalist", 2]],
  ["Senior Data Analyst", ["data", "generalist", 3]],
  ["Analytics Manager", ["data", "generalist", 4]],
  ["Associate Data Scientist", ["data", "science", 1]],
  ["Data Scientist", ["data", "science", 2]],
  ["Senior Data Scientist", ["data", "science", 3]],
  ["Principal Data Scientist", ["data", "science", 4]],
  ["Machine Learning Engineer", ["data", "science", 2]],
  ["AI Engineer", ["data", "science", 2]],
  ["Data Engineer", ["data", "engineering", 2]],
  ["Staff Data Engineer", ["data", "engineering", 4]],
  ["Data Architect", ["data", "engineering", 4]],
  ["Head of Data & Analytics", ["data", "generalist", 5]],
  ["Chief Data Officer", ["data", "generalist", 6]],
  ["Data Entry Clerk", ["admin", "generalist", 1]], // not data science

  // IT & infrastructure, with cyber security.
  ["Service Desk Analyst", ["technology", "support", 1]],
  ["IT Support Technician", ["technology", "support", 1]],
  ["IT Support Engineer", ["technology", "support", 2]],
  ["Systems Administrator", ["technology", "generalist", 2]],
  ["Network Engineer", ["technology", "generalist", 2]],
  ["Senior Network Engineer", ["technology", "generalist", 3]],
  ["Cloud Engineer", ["technology", "generalist", 2]],
  ["Database Administrator", ["technology", "generalist", 2]],
  ["Solution Architect", ["technology", "architecture", 4]],
  ["Enterprise Architect", ["technology", "architecture", 4]],
  ["IT Manager", ["technology", "generalist", 4]],
  ["Head of IT", ["technology", "generalist", 5]],
  ["Chief Information Officer", ["technology", "generalist", 6]],
  ["Cyber Security Analyst", ["technology", "security", 2]],
  ["Senior Security Engineer", ["technology", "security", 3]],
  ["Security Architect", ["technology", "security", 4]],
  ["CISO", ["technology", "security", 6]],
  ["SAP FICO Consultant", ["technology", "enterprise-apps", 2]],
  ["DevOps Engineer", ["software", "generalist", 2]], // software is tried first
  ["Landscape Architect", ["architecture", "generalist", 2]], // not IT

  // Property & real estate.
  ["Assistant Property Manager", ["property", "generalist", 1]],
  ["Property Manager", ["property", "generalist", 2]],
  ["Senior Property Manager", ["property", "generalist", 3]],
  ["Graduate Valuer", ["property", "valuation", 1]],
  ["Valuer", ["property", "valuation", 2]],
  ["Senior Valuer", ["property", "valuation", 3]],
  ["Real Estate Agent", ["property", "agency", 2]],
  ["Lawyer (2-4 PQE) - Real Estate", ["legal", "generalist", 2]], // legal first

  // Community, stakeholder & heritage.
  ["Community Relations Officer", ["community", "generalist", 2]],
  ["Stakeholder Engagement Lead", ["community", "generalist", 3]],
  ["Heritage Advisor", ["community", "heritage", 2]],
  ["Senior Heritage Advisor", ["community", "heritage", 3]],
  ["Manager Heritage and Native Title", ["community", "heritage", 4]],
  ["Intern - Land Access & Native Title", ["community", "heritage", 1]],

  // Library, records & information.
  ["Library Technician", ["library", "generalist", 1]],
  ["Library Officer", ["library", "generalist", 2]],
  ["Librarian", ["library", "generalist", 2]],
  ["Senior Librarian", ["library", "generalist", 3]],
  ["Records Officer", ["library", "records", 2]],
  ["Document Controller", ["library", "records", 2]],
  ["Senior Archivist", ["library", "records", 3]],
  ["Furniture Library and Removal Assistant", null],

  // Design & creative.
  ["Junior Graphic Designer", ["creative", "generalist", 1]],
  ["Graphic Designer", ["creative", "generalist", 2]],
  ["Senior Interior Designer", ["creative", "generalist", 3]],
  ["Creative Director", ["creative", "generalist", 5]],
  ["Journalist", ["creative", "media", 2]],
  ["Senior Newsroom Journalist", ["creative", "media", 3]],
  ["Technical Writer", ["creative", "media", 2]],
  ["Photographer", ["creative", "performing", 2]],
  ["Performing Artiste", ["creative", "performing", 2]],
  ["Architectural Designer", ["architecture", "generalist", 2]], // not creative
  // Found by the whole-archive diff after wave 2 (2026-09-25).
  ["Demi Chef - Rydges South Bank", ["hospitality", "kitchen", 2]], // a suburb, not a bank
  ["Food and Beverage Supervisor FT - Rydges South Bank", ["hospitality", "generalist", 2]],
  ["Hotel Front Desk Night Auditor", ["admin", "generalist", 1]], // front desk, not audit
  ["Night Audit Clerk", ["admin", "generalist", 1]],
  ["Lecturer (Education Focused) in Business Analytics", ["education", "academic", 2]],
  ["Teaching Fellow - Cybersecurity", ["education", "academic", 2]],
  ["Teacher - Students At Educational Risk", ["education", "generalist", 2]],
  ["Leading Teacher Range 3 - Director Community Engagement Team", ["education", "generalist", 3]],
  ["Process Worker - Medium Risk PM - Banksmeadow - Chef Fresh", null],
  ["Senior Specialist Legal Editor (Banking & Finance)", ["creative", "media", 3]], // publishing, not banking
  ["Tax Support Associate – Retail", ["finance", "tax", 1]],
  ["Fixed Term Associate - HR Coordinator (Pre-Onboarding)", ["hr", "generalist", 1]],
  ["CMO - Intensive Care Unit, Maitland Hospital", ["medical", "generalist", 3]], // Career Medical Officer
  ["Chief Marketing Officer (CMO)", ["marketing", "generalist", 6]],
  ["Talent Partner - Corporate Services", ["hr", "talent-acquisition", 2]], // not a law partner
  ["Customer Partner - Insurance", ["insurance", "generalist", 2]], // an insurer, not a law firm
  ["Graduate Cost Manager", ["commercial", "quantity-surveying", 1]],
  ["Senior Accountant - Life Insurance and Investments", ["finance", "generalist", 3]],
  ["Insurance External Auditor - Senior Associate", ["risk", "audit", 3]],
  ["Senior Product Manager - Insurance", ["product", "product", 4]],
  ["CDL-A Dedicated Driver - Medical Insurance", ["logistics", "driving", 3]], // a benefit, not a job
  ["Multi Property Director of Food and Beverage", ["hospitality", "generalist", 5]], // hotels
  ["Multi Property Director of Rooms", null],
  // Engineering design and drafting (since wave 4), not the creative ladder.
  ["Senior Civil Designer", ["architecture", "drafting", 3]],
  ["Principal Electrical Designer", ["architecture", "drafting", 4]],
  ["Design Manager", ["construction", "generalist", 4]], // construction design management
  ["Graphic Design Manager", ["creative", "generalist", 4]],
  ["BIM Library Manager", null],
  ["Senior to Principal Power Systems Engineer", null], // electrical engineering, not IT
  ["Senior Water Infrastructure Engineer", ["engineering", "civil", 3]], // not IT
  ["Senior ICT Officer", ["technology", "generalist", 3]],
  ["SVP Data Scientist", ["data", "science", 2]], // a bank grade
  ["Teacher of Supply Chain and Logistics", ["education", "generalist", 2]],
  ["Teacher - Library - Canterbury Girls High School", ["education", "generalist", 2]],
  ["Banking Operations Clerk", ["banking", "generalist", 1]],

  // ---- Wave 3: health, care, emergency services, science (2026-09-25) -----
  // Medical: intern / RMO → registrar / CMO → specialist / GP → senior
  // specialist / director → executive director of medical services.
  ["Intern Medical Officer", ["medical", "generalist", 1]],
  ["Resident Medical Officer", ["medical", "generalist", 2]],
  ["Senior Resident Medical Officer", ["medical", "generalist", 2]],
  ["Career Medical Officer", ["medical", "generalist", 3]],
  ["Advanced Trainee Registrar - Cardiology", ["medical", "generalist", 3]],
  ["General Practitioner", ["medical", "generalist", 4]],
  ["Consultant Psychiatrist", ["medical", "generalist", 4]],
  ["Staff Specialist - Emergency Medicine", ["medical", "generalist", 4]],
  ["Visiting Medical Officer - Urologist", ["medical", "generalist", 4]],
  ["Senior Staff Specialist - Anaesthetics", ["medical", "generalist", 5]],
  ["Director of Medical Services", ["medical", "generalist", 5]],
  ["Executive Director Medical Services", ["medical", "generalist", 6]],
  ["Tree Surgeon", null], // an arborist
  ["Judicial Registrar", null], // a court officer
  ["Physician Assistant", null], // a US licence, not the doctors' ladder

  // Allied health: assistant → clinician → senior → team leader / manager.
  ["Allied Health Assistant", ["allied", "generalist", 1]],
  ["Occupational Therapist", ["allied", "generalist", 2]],
  ["Physiotherapist", ["allied", "generalist", 2]],
  ["Speech Pathologist", ["allied", "generalist", 2]],
  ["Clinical Dietitian", ["allied", "generalist", 2]],
  ["Podiatrist", ["allied", "generalist", 2]],
  ["Senior Occupational Therapist", ["allied", "generalist", 3]],
  ["Physical Therapy Team Leader", ["allied", "generalist", 3]],
  ["Allied Health Manager", ["allied", "generalist", 4]],
  ["Director of Allied Health", ["allied", "generalist", 5]],
  ["Pharmacy Assistant", ["allied", "pharmacy", 1]],
  ["Intern Pharmacist", ["allied", "pharmacy", 1]],
  ["Pharmacist", ["allied", "pharmacy", 2]],
  ["Senior Clinical Pharmacist", ["allied", "pharmacy", 3]],
  ["Pharmacist in Charge", ["allied", "pharmacy", 4]],
  ["Director of Pharmacy", ["allied", "pharmacy", 5]],
  ["Retail Pharmacy Assistant - CWH Nerang QLD", ["allied", "pharmacy", 1]],
  ["Pharmacist - Chemist Warehouse Bathurst", ["allied", "pharmacy", 2]],
  ["Phlebotomist", ["allied", "pathology", 1]],
  ["Medical Laboratory Scientist - Microbiology", ["allied", "pathology", 2]],
  ["Senior Medical Laboratory Scientist", ["allied", "pathology", 3]],
  ["Radiographer", ["allied", "imaging", 2]],
  ["Senior Medical Imaging Technologist", ["allied", "imaging", 3]],
  ["Radiation Therapist", ["allied", "imaging", 2]],

  // Dental: assistant → hygienist / therapist → dentist → senior → director.
  ["Dental Assistant", ["dental", "generalist", 1]],
  ["Dental Hygienist", ["dental", "generalist", 2]],
  ["Oral Health Therapist", ["dental", "generalist", 2]],
  ["General Dentist", ["dental", "generalist", 3]],
  ["Senior Dentist", ["dental", "generalist", 4]],
  ["Head of Dentistry", ["dental", "generalist", 5]],
  ["Oral Surgeon", ["dental", "generalist", 4]],

  // Care: aged and disability; social work; mental health.
  ["Personal Care Worker", ["care", "generalist", 1]],
  ["Disability Support Worker", ["care", "generalist", 1]],
  ["Home Care Worker - Casual", ["care", "generalist", 1]],
  ["Senior Personal Carer", ["care", "generalist", 2]],
  ["Care Coordinator - Aged Care", ["care", "generalist", 3]],
  ["Residential Services Manager", ["care", "generalist", 4]],
  ["Aged Care Facility Cleaner", ["facilities", "generalist", 1]], // not care
  ["Social Worker", ["care", "social-work", 2]],
  ["Case Manager", ["care", "social-work", 2]], // a caseload, not a team
  ["Youth Worker", ["care", "social-work", 2]],
  ["Senior Case Manager", ["care", "social-work", 3]],
  ["Senior Child Protection Practitioner", ["care", "social-work", 3]],
  ["Case Manager - Workers Compensation", null], // insurance claims
  ["Psychologist", ["care", "mental-health", 2]],
  ["Mental Health Clinician", ["care", "mental-health", 2]],
  ["Licensed Professional Counselor", ["care", "mental-health", 2]],
  ["Senior Clinical Psychologist", ["care", "mental-health", 3]],
  ["School Psychologist", ["care", "mental-health", 2]],
  ["Financial Counsellor", null], // money, not mental health

  // Emergency services, security & justice.
  ["Security Officer", ["emergency", "security", 1]],
  ["Senior Security Officer", ["emergency", "security", 2]],
  ["Security Manager", ["emergency", "security", 4]],
  ["Retail Security Officer", ["emergency", "security", 1]], // retail excludes it
  ["Paramedic", ["emergency", "generalist", 2]],
  ["Emergency Services Officer", ["emergency", "generalist", 2]],
  ["Intensive Care Paramedic", ["emergency", "generalist", 3]],
  ["Police Officer", ["emergency", "policing", 2]],
  ["Correctional Officer", ["emergency", "justice", 2]],
  ["Trainee Correctional Officer", ["emergency", "justice", 1]],
  ["Community Corrections Officer", ["emergency", "justice", 2]],
  ["Senior Youth Justice Officer", ["emergency", "justice", 3]],
  ["Court Services Officer", ["emergency", "justice", 2]],
  ["Administration Officer - Baseline Security Clearance", ["admin", "generalist", 2]],
  ["Medical Staff Associate - LPN, LVN, EMT or Paramedic", null], // four licences

  // Science & research.
  ["Laboratory Assistant", ["science", "generalist", 1]],
  ["Laboratory Technician", ["science", "generalist", 1]],
  ["Chemist", ["science", "generalist", 2]],
  ["Microbiologist", ["science", "generalist", 2]],
  ["Research Scientist", ["science", "generalist", 2]],
  ["Laboratory Manager", ["science", "generalist", 4]],
  ["Research Assistant", ["science", "research", 1]],
  ["Postdoctoral Research Fellow", ["science", "research", 2]],
  ["Senior Research Fellow", ["science", "research", 3]],
  ["Principal Research Fellow", ["science", "research", 4]],
  ["Clinical Research Associate", ["science", "generalist", 2]],
  ["Senior Clinical Research Associate", ["science", "generalist", 3]],
  ["Veterinarian", ["science", "veterinary", 2]],
  ["Environmental Scientist", ["science", "environmental", 2]],
  ["Senior Environmental Advisor", ["science", "environmental", 3]],
  ["Environmental Manager", ["science", "environmental", 4]],
  ["Principal Geochemist", ["geoscience", "generalist", 4]], // not the science lab
  ["Senior Data Scientist - Geotechnical", ["data", "science", 3]], // data first
  // Health-context support roles stay on their own ladders (found by the diff).
  ["Administration Officer - GP Plus", ["admin", "generalist", 2]], // not a GP
  ["Administration Officer - Medical Imaging", ["admin", "generalist", 2]],
  ["Dental Administrator and Treatment Coordinator", ["admin", "generalist", 1]],
  ["Sr Applications Administrator (Laboratory Systems)", ["technology", "generalist", 3]], // IT
  ["CleanPack Chemist (CDL) Class B CDL Route Driver", ["logistics", "driving", 2]],
  ["Pharmacy Delivery Driver", ["logistics", "driving", 1]],
  ["Laboratory Warehouse Assistant (General Labour)", ["logistics", "generalist", 1]],
  ["Evening Residence Counsellor - Front Desk", ["admin", "generalist", 1]],
  ["Child Care Worker", ["education", "early-childhood", 1]],
  ["Pharmacy Educator", ["allied", "pharmacy", 2]],
  ["Travel Speech Language Pathologist", ["allied", "generalist", 2]], // not a pathologist
  ["Speech Pathology Manager", ["allied", "generalist", 4]], // not the lab track
  ["Deputy Director of Pharmacy", ["allied", "pharmacy", 4]],
  ["Assistant Director Medical Imaging Technology", ["allied", "imaging", 4]],
  ["Deputy Chief Veterinary Officer", ["science", "veterinary", 5]],
  ["Deputy Chief Medical Officer", ["medical", "generalist", 5]],
  ["Principal Ecologist", ["science", "environmental", 4]],
  ["Principal Environmental Scientist", ["science", "environmental", 4]],
  ["Senior Staff Specialist or Staff Specialist", null], // two grades
  ["Deputy Registrar", null], // a university officer
  ["Senior Data Security Manager", null],
  ["Red Team and Security Manager", null],
  ["Clinical Neuropsychologist", ["care", "mental-health", 2]],

  // ---- Wave 4: engineering, trades, mining, construction and the rest -----
  // Engineering: graduate → engineer → senior → principal → engineering
  // manager → engineering director. Disciplines are tracks.
  ["Graduate Civil Engineer", ["engineering", "civil", 1]],
  ["Vacation Student Mining Engineer", ["engineering", "mining", 1]],
  ["Civil Engineer", ["engineering", "civil", 2]],
  ["Structural Engineer", ["engineering", "civil", 2]],
  ["Geotechnical Engineer", ["engineering", "civil", 2]],
  ["Site Engineer", ["engineering", "civil", 2]],
  ["Senior Structural Engineer", ["engineering", "civil", 3]],
  ["Principal Civil Engineer", ["engineering", "civil", 4]],
  ["Electrical Engineer", ["engineering", "electrical", 2]],
  ["Senior Instrumentation Engineer", ["engineering", "electrical", 3]],
  ["Automation Engineer", ["engineering", "electrical", 2]],
  ["Mechanical Engineer", ["engineering", "mechanical", 2]],
  ["Reliability Engineer", ["engineering", "mechanical", 2]],
  ["Process Engineer", ["engineering", "process", 2]],
  ["Metallurgist", ["engineering", "process", 2]],
  ["Senior Metallurgist", ["engineering", "process", 3]],
  ["Mining Engineer", ["engineering", "mining", 2]],
  ["Senior Project Engineer", ["engineering", "generalist", 3]],
  ["Technical Director - Geotechnical Engineering", ["engineering", "civil", 5]],
  ["Senior or Principal Mining Engineer", null], // two grades
  ["Automation Test Engineer", ["software", "generalist", 2]], // software testing
  ["Test Automation Consultant", ["software", "generalist", 2]],
  ["Sales Engineer - Control Systems", null], // presales, not engineering
  ["Aircraft Maintenance Engineer", ["trades", "mechanical", 2]], // a licensed trade

  // Geoscience & surveying.
  ["Geology Technician", ["geoscience", "generalist", 1]],
  ["Exploration Geologist", ["geoscience", "generalist", 2]],
  ["Senior Resource Geologist", ["geoscience", "generalist", 3]],
  ["Principal Geologist", ["geoscience", "generalist", 4]],
  ["Chief Geologist", ["geoscience", "generalist", 5]],
  ["Graduate Surveyor", ["geoscience", "surveying", 1]],
  ["Mine Surveyor", ["geoscience", "surveying", 2]],
  ["Senior Mine Surveyor", ["geoscience", "surveying", 3]],
  ["Quantity Surveyor - Tender", ["commercial", "quantity-surveying", 2]], // commercial first
  ["Marine Surveyor", null],

  // Architecture, planning & drafting.
  ["Graduate Architect", ["architecture", "generalist", 1]],
  ["Architect", ["architecture", "generalist", 2]],
  ["Senior Architect", ["architecture", "generalist", 3]],
  ["Principal Architect", ["architecture", "generalist", 4]],
  ["Town Planner", ["architecture", "planning", 2]],
  ["Principal Town Planner", ["architecture", "planning", 4]],
  ["Drafter", ["architecture", "drafting", 2]],
  ["BIM Modeller", ["architecture", "drafting", 2]],
  ["Senior Business Architect", null], // enterprise architecture, not buildings
  ["Senior Naval Architect", null],

  // Construction & site management.
  ["Construction Foreman", ["construction", "generalist", 2]],
  ["Leading Hand - Civil Construction", ["construction", "generalist", 2]],
  ["Site Supervisor", ["construction", "generalist", 3]],
  ["Assistant Site Manager", ["construction", "generalist", 3]],
  ["Site Manager", ["construction", "generalist", 4]],
  ["Construction Manager", ["construction", "generalist", 4]],
  ["Construction Director", ["construction", "generalist", 5]],

  // Trades: apprentice → tradesperson → leading hand / supervisor → superintendent.
  ["Apprentice Electrician", ["trades", "electrical", 1]],
  ["Electrician", ["trades", "electrical", 2]],
  ["HV Electrician", ["trades", "electrical", 2]],
  ["E&I Technician", ["trades", "electrical", 2]],
  ["Leading Hand Electrician", ["trades", "electrical", 3]],
  ["Mechanical Fitter", ["trades", "mechanical", 2]],
  ["HD Fitter", ["trades", "mechanical", 2]],
  ["Heavy Diesel Mechanic", ["trades", "mechanical", 2]],
  ["Automotive Technician", ["trades", "mechanical", 2]],
  ["Refrigeration Mechanic", ["trades", "mechanical", 2]],
  ["Maintenance Planner", ["trades", "mechanical", 2]],
  ["Master Automotive Technician", ["trades", "mechanical", 3]],
  ["Boilermaker", ["trades", "fabrication", 2]],
  ["Welder", ["trades", "fabrication", 2]],
  ["Welding Supervisor", ["trades", "fabrication", 3]],
  ["Carpenter", ["trades", "generalist", 2]],
  ["Plumber", ["trades", "generalist", 2]],
  ["Painter Blaster", ["trades", "generalist", 2]],
  ["Tiler", ["trades", "generalist", 2]],
  ["Advanced Rigger", ["trades", "generalist", 2]],
  ["Scaffolder", ["trades", "generalist", 2]],
  ["Concreter", ["trades", "generalist", 2]],
  ["Carpenter Helper", ["trades", "generalist", 1]],
  ["Construction Labourer", ["trades", "generalist", 1]],
  ["Civil Construction Apprentice - Broome", ["trades", "generalist", 1]],
  ["Maintenance Superintendent", ["operations", "generalist", 4]], // a mine site's
  ["Apprentice Chef", ["hospitality", "kitchen", 1]], // the kitchen, not the trades
  ["Trade Counter Assistant - Plumbing", null], // a counter, not the trade
  ["Point of Sale Technician", null],

  // Mining, plant & production operations.
  ["Dump Truck Operator", ["operations", "mining", 2]],
  ["Excavator Operator", ["operations", "mining", 2]],
  ["Jumbo Operator", ["operations", "mining", 2]],
  ["Shotfirer", ["operations", "mining", 2]],
  ["Senior Shotfirer", ["operations", "mining", 3]],
  ["Driller's Offsider", ["operations", "mining", 1]],
  ["Shift Boss - Underground Mining", ["operations", "mining", 3]],
  ["Underground Mine Superintendent", ["operations", "mining", 4]],
  ["Machine Operator", ["operations", "generalist", 2]],
  ["Process Worker", ["operations", "generalist", 1]],
  ["Meat Process Workers - Entry Level", ["operations", "generalist", 1]],
  ["Production Supervisor", ["operations", "generalist", 3]],
  ["Production Manager", ["operations", "generalist", 4]],
  ["Plant Manager - Chemical Plant", ["operations", "generalist", 4]],
  ["Forklift Operator - Yard", ["logistics", "generalist", 2]], // logistics, not plant

  // Cleaning & facilities.
  ["Cleaning and Trolley Collection", ["facilities", "generalist", 1]],
  ["Cleaner", ["facilities", "generalist", 1]],
  ["Housekeeper", ["facilities", "generalist", 1]],
  ["Laundry Attendant", ["facilities", "generalist", 1]],
  ["Cleaning Supervisor", ["facilities", "generalist", 3]],
  ["Executive Housekeeper", ["facilities", "generalist", 4]],
  ["Facilities Coordinator", ["facilities", "facilities", 2]],
  ["Facilities Manager", ["facilities", "facilities", 4]],
  ["Data Cleaning Analyst", ["data", "generalist", 2]],

  // Agriculture & horticulture.
  ["Farm Hand", ["agriculture", "generalist", 1]],
  ["Station Hand", ["agriculture", "generalist", 1]],
  ["Gardener", ["agriculture", "generalist", 2]],
  ["Horticulturist", ["agriculture", "generalist", 2]],
  ["Agronomist", ["agriculture", "generalist", 2]],
  ["Head Gardener", ["agriculture", "generalist", 3]],
  ["Farm Manager", ["agriculture", "generalist", 4]],
  ["Lecturer in Agricultural Science", ["education", "academic", 2]], // education first

  // Beauty, fitness & recreation.
  ["Beautician", ["personal", "generalist", 2]],
  ["Spa Therapist", ["personal", "generalist", 2]],
  ["Hair Stylist", ["personal", "generalist", 2]],
  ["Apprentice Hairdresser", ["personal", "generalist", 1]],
  ["Director Hairstylist", ["personal", "generalist", 3]], // a stylist grade
  ["Hair Salon Manager", ["personal", "generalist", 4]],
  ["Fitness Instructor", ["personal", "fitness", 2]],
  ["Personal Trainer", ["personal", "fitness", 2]],
  ["Sports Coach - Casual", ["personal", "fitness", 2]],
  ["National Assistant Head Coach - Para Swimming", ["personal", "fitness", 3]],
  // Found by the whole-archive diff after wave 4 (2026-09-25).
  ["Front Office .NET/C# Engineer", ["software", "generalist", 2]], // a trading desk's
  ["MC Driver (Livestock)", ["logistics", "driving", 3]],
  ["Local Delivery Driver - Plumbing Villawood", ["logistics", "driving", 1]],
  ["Office Manager Apprentice", ["admin", "generalist", 1]],
  ["Japanese Cuisine Sous Chef (6 days, Orchard)", ["hospitality", "kitchen", 3]], // a suburb
  ["Catering Site Manager - School", ["hospitality", "generalist", 4]],
  ["On-Site Manager - Warehouse", ["logistics", "generalist", 4]],
  ["Practice Manager - Architecture", ["admin", "generalist", 4]],
  ["Education Support Officer of Agriculture", ["education", "education-support", 1]],
  ["Quantity Surveying Manager", ["commercial", "quantity-surveying", 4]], // not surveying
  ["Associate Director - Structural Engineer", ["engineering", "civil", 4]],
  ["Assistant Chief Engineer", ["engineering", "generalist", 4]],
  ["Senior Mechanical Engineer or Technical Director", null], // two grades
  ["Director Master Hair Stylist", ["personal", "generalist", 3]], // a stylist grade
  ["Assistant Director of Housekeeping", ["facilities", "generalist", 4]],
  ["Associate Director - Design Manager, Water Infrastructure", ["construction", "generalist", 4]],
  ["EL2 Director Legislative Drafter", null],
  // HSE, from the 2026-09-24 audit.
  [
    "Work Health and Safety Advisor APS Level 5 - Chief Operating Officer",
    ["hse", "generalist", 2],
  ],
  ["FIFO Health and Safety Advisors", ["hse", "generalist", 2]],
  ["Safety Trainer", ["hse", "generalist", 2]],
  ["Fire Safety Engineering Intern", null],

  // ---- Strategy (2026-09-25) ----------------------------------------------
  // Added to the taxonomy on main after the four waves. Every title here is a
  // real one from the 90-day window (573 rows, 333 distinct; 475 were on no
  // ladder), written down BEFORE the family's rules existed.
  //
  // The corporate ladder: graduate / coordinator → analyst / associate →
  // senior analyst / lead → manager → head / GM / director → CSO.
  ["Strategy Graduate", ["strategy", "generalist", 1]],
  ["Strategy & Transformation Coordinator", ["strategy", "generalist", 1]],
  ["Strategy Analyst", ["strategy", "generalist", 2]],
  ["Strategy Associate", ["strategy", "generalist", 2]],
  ["Associate, Business Strategy", ["strategy", "generalist", 2]],
  ["Strategic Planning & Investment Analyst", ["strategy", "generalist", 2]],
  ["Strategy Advisor", ["strategy", "generalist", 2]],
  ["Senior Strategy Analyst", ["strategy", "generalist", 3]],
  ["Senior Strategy Associate", ["strategy", "generalist", 3]],
  ["Strategy Lead", ["strategy", "generalist", 3]],
  ["Strategy Manager", ["strategy", "generalist", 4]],
  ["Senior Manager, Group Strategy", ["strategy", "generalist", 4]],
  ["Strategy and Planning Manager", ["strategy", "generalist", 4]],
  ["Associate Director – Innovation Strategy & Transformation", ["strategy", "generalist", 4]],
  ["Head of Strategy", ["strategy", "generalist", 5]],
  ["Head of Group Strategy - Corporate Planning", ["strategy", "generalist", 5]],
  ["General Manager Strategy & Growth AU", ["strategy", "generalist", 5]],
  ["Chief Strategy Officer", ["strategy", "generalist", 6]],
  // Strategy consulting: the firms grade by consultant, not by analyst, and
  // post the grade after a pipe ("Strategy Consultant | Manager | Strategy&").
  // The GRADE decides the rung, not the first job noun.
  ["Strategy Consultant", ["strategy", "consulting", 2]],
  ["Corporate Strategy Consultant", ["strategy", "consulting", 2]],
  ["Economics and Strategy Advisory Consultant", ["strategy", "consulting", 2]],
  ["Senior Strategy Consultant", ["strategy", "consulting", 3]],
  ["Junior Strategy Consultant | Senior Associate | Strategy&", ["strategy", "consulting", 3]],
  [
    "Senior Consultant - Technology Strategy and Transformation - Technology Consulting",
    ["strategy", "consulting", 3],
  ],
  ["Strategy Consultant | Manager | Strategy&", ["strategy", "consulting", 4]],
  ["Senior Strategy Consultant | Senior Manager | Strategy&", ["strategy", "consulting", 4]],
  ["EY-Parthenon Strategy - Manager, Strategy Consultant", ["strategy", "consulting", 4]],
  ["Strategy Manager | Monitor Deloitte", ["strategy", "consulting", 4]],
  [
    "Manager - Technology Strategy and Transformation - Technology Consulting",
    ["strategy", "consulting", 4],
  ],
  ["Strategy & Transformation Managing Consultant", ["strategy", "consulting", 4]],
  // Traps: "strategy" in a title that belongs to another ladder, or to none.
  ["Head of Commercial Strategy", ["commercial", "generalist", 5]],
  ["Fraud & Scams Strategy Analyst", ["risk", "compliance", 2]],
  [
    "Executive Support Officer, Strategy Planning and Infrastructure - Cairns",
    ["admin", "executive-assistant", 2],
  ],
  ["Principal Planner Strategic Planning", null], // an urban planner
  ["Chief of Staff to Chief Strategy Officer", null],
  ["Quantitative Equity Strategy Manager - HSBC Global Asset Management", null],
  ["Product Strategy Lead", null],
  ["Digital Strategy Lead", null],
  ["Senior Customer Engagement Strategy Manager", null],
  ["Senior Manager, Workforce Strategy & Planning", null],
  ["Executive Security Partner & Strategy Lead", null],
  ["Manager/Senior Manager | Strategy & Transformation | Benefits Realisation Lead", null],
  // From the first archive audit of the family (2026-09-25): each was placed
  // on the strategy ladder and should not have been, or on the wrong rung.
  ["Strategy& - Deals | Senior Associate", ["strategy", "consulting", 3]],
  [
    "Strategy and Transactions - Transaction Diligence - Senior - Hong Kong",
    ["strategy", "consulting", 3],
  ],
  ["Assistant VP, Group Strategy & Transformation", ["strategy", "generalist", 4]],
  ["Off-cycle Intern - Algorithmic Quantitative Strategy", null],
  ["Research - Quantitative Strategy - Associate", null],
  ["HSBC Life Wealth Strategy Advisor", null],
  ["Benefits Specialist, Large Client Strategy", null],
  ["Analyst, Budget Strategy", null],
  ["Investment Associate - RCF Partnership Strategy", null],
  ["Operations Coordinator (Indigenous Strategy)", null],
  ["[West Hospital, Strategic Planning Exp] Senior AM/ Manager, Surgery - UP$6500 #HCY", null],
  ["Manager, Total Rewards & Compensation Strategy (Logistics / East) [EL]", null],
  ["Group Manager, IR Strategy & Bargaining", null],
  ["District Manager Integrated Renal Strategy", null],
  ["Asset Manager - Housing and Property Strategy", null],
  ["Administration Officer (Grade 2), Strategy and Planning", ["admin", "generalist", 2]],
  ["Director, Investment Strategy (HSBC Asset Management)", null],
  ["Director, Principal Gifts & Major Donor Strategy", null],
  ["Director, Scientific Strategy, Medical Affairs", null],
  ["Director, Employment Relationship Strategy", null],
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
const MARRIOTT = "washington-mar";
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
  ["Category Manager", COLES, ["procurement", "buying", 4]], // buying, not a store rung
  ["Finance Manager", COLES, ["finance", "generalist", 4]],
  ["HR Business Partner", COLES, ["hr", "generalist", 3]],
  ["Duty Manager", "sydney-edv", null], // Endeavour's pubs
  ["Team Leader - Distribution Centre", COLES, ["logistics", "generalist", 3]], // not a store rung
  ["Production Team Member", WESFARMERS, null], // WesCEF, not Bunnings
  ["Sales Consultant", "priv-suttons-motors", ["sales", "generalist", 2]], // car sales
  // From the 2026-09-24 audit: a retailer's DC and café roles are not store rungs.
  // …and they land on their own ladders instead (since 2026-09-25).
  ["DC Team Member", COLES, ["logistics", "generalist", 1]],
  ["Seasonal Casual DC Team Member", COLES, ["logistics", "generalist", 1]],
  ["Dispatch Team Member", COLES, ["logistics", "generalist", 1]],
  ["Cafe Team Member", COLES, ["hospitality", "generalist", 1]],
  ["Bakery Assistant Manager", COLES, ["retail", "generalist", 3]], // the store department
  ["Dry Goods Manager", COLES, ["retail", "generalist", 3]],
  ["Dry Goods Manager", "", null],
  // Bare "Engineering Manager": the employer's sector says which engineering.
  ["Engineering Manager", "melbourne-rea", ["software", "generalist", 4]],
  ["Engineering Manager", "sydney-cba", ["software", "generalist", 4]],
  ["Director of Engineering", "nz-xero", ["software", "generalist", 5]],
  ["Director of Engineering", MARRIOTT, null], // hotel plant and maintenance
  ["Assistant Director of Engineering", MARRIOTT, null],
  // …and a discipline-named one is on the ENGINEERING ladder (since wave 4).
  ["Substation Engineering Manager", "losangeles-acm", ["engineering", "electrical", 4]],
  ["Project Engineering Manager", "sydney-wor", ["engineering", "generalist", 4]],
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

// EVERY PARENT SKILL HAS A PATHWAY, OR A STATED REASON IT HAS NONE.
// Until 2026-09-25 the ladders covered 10 of 100 parent skills and nothing said
// so. A parent added to the taxonomy now fails here until someone decides.
const parents = new Set(ALL_SKILLS);
const claimed = new Map<string, string[]>();
for (const f of FAMILIES)
  for (const sk of f.skills ?? []) claimed.set(sk, [...(claimed.get(sk) ?? []), f.id]);
for (const sk of [...claimed.keys(), ...Object.keys(NOT_A_LADDER), ...PATHWAYS_PLANNED]) {
  if (!parents.has(sk)) {
    failures++;
    console.error(`✗ "${sk}" is not a parent skill in skillsTaxonomy.ts (renamed?)`);
  }
}
for (const sk of parents) {
  const n = [claimed.has(sk), sk in NOT_A_LADDER, PATHWAYS_PLANNED.includes(sk)].filter(
    Boolean,
  ).length;
  if (n !== 1) {
    failures++;
    console.error(
      n === 0
        ? `✗ parent skill "${sk}" has no ladder, no plan and no reason — decide one`
        : `✗ parent skill "${sk}" is in more than one of: a family, NOT_A_LADDER, PATHWAYS_PLANNED`,
    );
  }
}
console.log(
  `  ${claimed.size} parent skills have a ladder, ${Object.keys(NOT_A_LADDER).length} have none by design, ` +
    `${PATHWAYS_PLANNED.length} are planned.`,
);

if (failures) {
  console.error(`\n${failures} career-ladder fixture(s) failed.`);
  process.exit(1);
}
console.log(
  `✓ ${FIXTURES.length + EMPLOYER.length + CANONICAL.length} career-ladder fixtures place correctly; ` +
    `${RETAIL_EMPLOYERS.size} retail employers resolve.`,
);
