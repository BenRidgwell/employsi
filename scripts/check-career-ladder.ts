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
  ["Casual Cleaner - 24 hr roster", null],
  ["People Leader - Customer Service", null], // a line manager, not HR
  // HR, from the 2026-09-24 audit. Ad boilerplate in the title named a track.
  ["HR Assistant (Entry Level, Training Provided)", ["hr", "generalist", 1]], // not L&D
  ["HR Specialist - Training Provided, Up to 4k", ["hr", "generalist", 2]],
  ["Project Manager - Pharma West - Attractive Remuneration", ["project", "generalist", 3]],
  ["Construction Manager - Pharma West - Attractive Remuneration", null], // was HR reward 4
  // Workplace-relations LAWYERS practise employment law; they are not on the ER ladder.
  ["Senior Associate - Workplace Relations, Employment & Safety", null],
  ["Workplace Relations Lawyer", null],
  ["Solicitor, Employment & Industrial Relations", null],
  ["Senior Legal Counsel - Employee Relations", null],
  ["Internship - Chief of Staff to the Chief HR Officer", null], // was rung 6
  ["Head, Employee Relations", ["hr", "employee-relations", 5]],
  // Heavy rigid licence: the driving ladder since 2026-09-25, never HR.
  ["HR Driver", ["logistics", "driving", 2]],
  ["HR Truck Drivers - Casual", ["logistics", "driving", 2]],
  // A project or product manager whose PRODUCT is HR is on the project ladder.
  ["Senior Project Manager - HRIS", ["project", "generalist", 4]],
  ["Principal Product Manager - Talent Acquisition Applications", null],
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
  ["Financial Planner", null],
  ["Mortgage Broker - Finance", null],
  ["Traffic Controller", null],
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
  ["Senior Financial Crime Compliance Specialist", null],
  ["Director of Employee and Community Engagement - Banking and Financial Services", null],
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
  ["Veterinary Nurse", null],
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
  ["Project Engineer", null],
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
  ["Front End Loader Operator", null],
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
  ["Retail Pharmacist", null],
  ["Shopfitter", null],
  ["Butcher - Supermarket", ["hospitality", "food-trades", 2]], // a trade, not a store rung
  ["Retail Buyer", null], // head-office buying: not yet a ladder
  ["Store Development Manager", null], // property, not the store ladder
  ["Retail Banking Manager", null],
  ["Retail HR Business Partner", ["hr", "generalist", 3]], // HR is tried first
  // Retail, from the 2026-09-24 audit.
  ["Nightfill Manager", ["retail", "generalist", 3]], // was rung 1
  ["Assistant Nightfill Manager", ["retail", "generalist", 3]],
  ["Retail Salesperson", ["retail", "generalist", 1]],
  ["Retail Sales Associates", ["retail", "generalist", 1]],
  ["Retail Department Leader", ["retail", "generalist", 3]],
  // "Retail" as the INDUSTRY of a head-office role is not the store ladder.
  ["Performance Media Specialist - Retail Media", null],
  ["Retail Marketing Manager", null],
  ["Retail Implementation Specialist", null],
  ["Regional Manager - Retail Lease Admin", null],
  ["Stores and Supply Officer", null],
  ["Retail Design Manager", null],
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
  ["Senior Business Analyst - SAP Payroll - Sydney", null],

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
  ["Hospitality Assistant / Cleaner", null], // cleaning, not food service
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
  ["Principal Engineer HV Primary", null],
  ["Principal HPC and Storage Architect", null],
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
  ["Contracts Administrator", null], // construction contracts: a commercial ladder
  ["SharePoint Administrator (NV1 clearance)", null], // IT
  ["Company Secretary", null], // governance
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
  ["Cyber Technical Lead - Identity Governance & Administration", null],
  ["Teaching Fellow - Business", ["education", "academic", 2]],
  ["Teaching Associate, School of Computing", ["education", "academic", 1]],
  ["Preschool Center Director", ["education", "early-childhood", 4]],
  ["HR and Payroll Generalist", ["payroll", "generalist", 2]],
  ["Payroll Business Partner", ["payroll", "generalist", 3]],
  ["Director HR Systems & Payroll", ["payroll", "generalist", 5]],
  // HSE, from the 2026-09-24 audit.
  [
    "Work Health and Safety Advisor APS Level 5 - Chief Operating Officer",
    ["hse", "generalist", 2],
  ],
  ["FIFO Health and Safety Advisors", ["hse", "generalist", 2]],
  ["Safety Trainer", ["hse", "generalist", 2]],
  ["Fire Safety Engineering Intern", null],
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
  ["Category Manager", COLES, null],
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
  ["Substation Engineering Manager", "losangeles-acm", null],
  ["Project Engineering Manager", "sydney-wor", null],
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
if (PATHWAYS_PLANNED.length)
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
