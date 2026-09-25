/**
 * A job title → where it sits on a career ladder: its FAMILY (HR, finance,
 * nursing…), its TRACK within the family (generalist, employee relations,
 * reward…) and its RUNG (entry → executive).
 *
 * This is the classifier under career pathways. It is a pure function of the
 * title so the generator, the Worker and the app all place a role identically —
 * the same reason skillsForText is the single skill matcher.
 *
 * WHAT A PATHWAY BUILT ON THIS IS, AND IS NOT.
 * The archive holds job ADS, not careers. No row says a person moved from HR
 * Officer to HR Business Partner, so nothing built from it may claim "N% of HR
 * Officers become HRBPs". What the ads do support, per step, is:
 *
 *   - that the ladder is REAL — employers advertise both rungs;
 *   - what the next rung asks for that this one does not (skills);
 *   - what it pays (salary text, where the ad states one);
 *   - how much demand there is at each rung, and where.
 *
 * The ORDER of the rungs is the one thing asserted rather than measured: it
 * comes from the seniority rubric below. Anything shown to a user as "the next
 * step" is that rubric, and should read as a typical ladder, not an observed
 * transition rate. Observed transitions would need a different source (CVs,
 * profile histories) — a different dataset, not a better regex.
 *
 * RUNGS ARE BANDS, NOT GRADES. Six bands cannot describe every organisation:
 * an Enrolled Nurse and an Assistant in Nursing share rung 1, and a Financial
 * Controller is a head of finance at one company and a manager at another. The
 * node a rung produces lists its commonest real titles so the band never has
 * to speak for itself.
 *
 * TUNING. The rules were written from typical Australian titles, then tuned
 * once against 90 days of the archive (2026-09-24). That pass was about
 * CORRECTNESS, not coverage: 6,769 rows changed placement (onto the right
 * rung, off a wrong ladder, or newly placed), while the placed share barely
 * moved (80.6% → 80.1% of rows whose words name a family). The audit's own figure reads higher
 * (88%) only because familyHint stopped counting deliberate exclusions as
 * failures — compare runs on one definition. `scripts/gen-career-pathways.ts
 * --audit` lists, per family, the titles a family claims but could not rung —
 * the worklist — and flags any rung paying less than the one below it. Every
 * fixture in scripts/check-career-ladder.ts is a promise that must survive a
 * tuning pass.
 */

export type Rung = 1 | 2 | 3 | 4 | 5 | 6;

export const RUNG_LABEL: Record<Rung, string> = {
  1: "Entry / support",
  2: "Practitioner",
  3: "Senior / partner",
  4: "Manager",
  5: "Head / director",
  6: "Executive",
};

export interface TrackDef {
  id: string;
  label: string;
  match: RegExp;
}

export interface FamilyDef {
  id: string;
  label: string;
  /** Matches the FUNCTION part of a title. Tested against the cleaned title. */
  match: RegExp;
  /** Titles that match `match` but belong to another ladder. */
  exclude?: RegExp;
  /** Specialisms. First match wins; no match is the generalist track. */
  tracks?: TrackDef[];
  /**
   * Family-specific rung rules, tried BEFORE the generic rubric. Used where the
   * generic reading is wrong for this family: a "Project Manager" is not a
   * people manager, a "Registered Nurse" carries no seniority word at all.
   */
  rungs?: [RegExp, Rung][];
  /**
   * False where the family's titles carry their grade in the NOUN and the
   * generic rubric would misread them — "Disability Support Worker - NDIS
   * Program" is not a rung-1 project role. Only `rungs` place these titles;
   * anything they miss is unplaced and shows up in the audit.
   */
  generic?: boolean;
  /**
   * The rung at which specialist tracks rejoin the generalist ladder. HR's
   * specialisms (ER, reward, L&D…) run to a manager rung of their own, but the
   * head of HR / CPO roles above are generalist. Asserted, like the rung order.
   */
  convergeAt?: Rung;
  /**
   * Titles this family claims ONLY when the employer is known to run this
   * ladder (PlaceContext.employerFamilies). "Team Member" names no function;
   * at Coles it is a store role, at a mine site it is not. Kept narrow on
   * purpose — the employer hint vouches for the ladder, not for every title
   * the employer advertises, so a Coles "Category Manager" stays unplaced.
   */
  employerMatch?: RegExp;
  /**
   * The parent skills (skillsTaxonomy.ts ALL_SKILLS) this ladder is the career
   * path FOR. scripts/check-career-ladder.ts asserts every parent skill is
   * claimed by a family or listed in NOT_A_LADDER with a reason, so a parent
   * added to the taxonomy forces a decision instead of silently having no
   * pathway — which is how 90 of 100 had none until 2026-09-25.
   */
  skills?: string[];
  /**
   * The support roles (see SUPPORT_TO) this family DOES place. Only the admin
   * ladder sets it: an Executive Assistant is on the admin ladder, and never on
   * the ladder of the executive supported.
   */
  supportRoles?: RegExp;
}

/** What is known about the advertiser, beyond the title. */
export interface PlaceContext {
  /** Families whose ladder this employer runs — see ladderEmployers.ts. */
  employerFamilies?: ReadonlySet<string>;
}

export interface Placement {
  family: string;
  track: string;
  rung: Rung;
  /** The title with noise (pay, brackets, location tails) removed. */
  canonical: string;
  /** "employer" when the family was chosen by the employer hint rather than by
   *  the title's own words — reported by the audit so the hint's effect is
   *  measured, never folded in silently. */
  via: "title" | "employer";
}

/**
 * Titles that are someone ELSE's support role. "Executive Assistant to the HR
 * Director" names the HR Director and an executive; it is on neither of THEIR
 * ladders. It is on the admin ladder, the one family whose `supportRoles`
 * accepts it — a chief of staff or an "advisor to" is on none.
 */
const SUPPORT_TO =
  /\b(assistant|pa|ea|support|coordinator|advisor|adviser)\s+to\b|\bexecutive assistant\b|\bpersonal assistant\b|\bexecutive (?:support officer|business partner)\b|\bchief of staff\b/;

/**
 * Adverts that are not a job: paid market-research panels recruit "Heads of
 * Logistics" for an hour's interview. Measured 2026-09-25 on the rung-5 list.
 */
const NOT_A_JOB =
  /\bpaid (?:market research|research|survey|study|interview)\b|\bmarket research study\b|\bsign up and start earning\b|\bget paid daily\b/;

/**
 * Support roles that carry a clinical or scientific DOMAIN word but are on the
 * admin, logistics or IT ladder: "Administration Officer – Medical Imaging",
 * "Pharmacy Delivery Driver", "Laboratory Warehouse Assistant". The families
 * in DOMAIN_FAMILIES skip them, rather than claim them by the domain word and
 * then fail (or worse) to rung them. Measured 2026-09-25: "Administration
 * Officer – GP Plus" was a rung-4 doctor.
 */
const DOMAIN_SUPPORT =
  /\badministrat\w*\b|\badmin\b|\breceptionist\b|\bfront desk\b|\bclerk\b|\bstore ?keeper\b|\bstore ?person\b|(?<!chemist )\bwarehouse\b|\bdrivers?\b|\bdelivery\b|\bpacker\b|\bbusiness support\b|\boffice (?:manager|reception|coordinator|assistant)\b|\breception\b/;
const DOMAIN_FAMILIES: ReadonlySet<string> = new Set([
  "facilities",
  "architecture",
  "trades",
  "agriculture",
  "medical",
  "allied",
  "dental",
  "care",
  "science",
]);

/** The support roles the admin ladder places: assistants, not advisers. */
const EA_PA =
  /\bexecutive assistant\b|\bpersonal assistant\b|\b(?:assistant|pa|ea) to\b|\bexecutive (?:support officer|business partner)\b/;

/**
 * Titles that span several rungs — "Senior Manager or Director", "Tax Manager
 * to Director", the Big-4 EOI listing "Senior Associate, Manager, Senior
 * Manager, Director". Placing one on its top rung inflates that rung's pay and
 * its bottom rung understates it; it is on no single rung, so it is unplaced.
 * "Registered or Enrolled Nurse" is the nursing form of the same thing.
 */
const MULTI_LEVEL =
  /\bengineer (?:or|to) (?:\w+ )?(?:director|manager|lead|principal)\b|\bsenior (?:or|to|and) principal\b|\bgraduate (?:or|to) (?:intermediate|senior)\b|\bintermediate (?:or|to|and) senior\b|\bsenior (?:or|and) intermediate\b|\b(?:senior )?staff specialist (?:or )?(?:senior )?staff specialist\b|\b(?:lecturer|professor)\s+(?:or\s+)?(?:associate |senior )?(?:lecturer|professor)\b|\b(?:manager|director|consultant|analyst|associate|advis[oe]r|officer|executive|specialist)\s+(?:or|to)\s+(?:(?:senior|associate|assistant)\s+)?(?:manager|director|consultant|analyst|associate|advis[oe]r|officer|specialist)\b|\bmanager (?:(?:senior|assistant|associate) (?:(?:project|program|programme) )?|(?:project|program|programme) )manager\b|\bsenior manager director\b|\bentry level to experienced\b|\blecturer (?:or )?senior lecturer\b|\bregistered(?: nurse)? (?:and |or )+enrolled\b|\benrolled(?: nurse)? (?:and |or )+registered\b/;

/**
 * Words that name a rung BELOW the executive. A C-suite word or a bank grade
 * alongside one of these is the reporting line or the grade, not the job:
 * "Analyst - CFO Advisory" is an analyst in EY's CFO Advisory practice, "SVP
 * Energy & Materials Sales Manager" is a Citi sales manager, "WHS Advisor APS 5
 * - Chief Operating Officer" names the division. Measured 2026-09-24: 60-odd
 * such rows sat on finance's rung 6. The noun decides instead.
 */
const SUBORDINATE =
  /\b(?:manager|director|head|lead|leader|supervisor|specialist|associate|analyst|engineer|developer|scientist|advis[oe]r|consultant|partner|coordinator|assistant|administrator|broker|auditor|architect|intern)\b/;
/** `re`, but only in a title with no subordinate noun — see SUBORDINATE. */
function execOnly(re: RegExp): RegExp {
  return new RegExp(`^(?!.*${SUBORDINATE.source})(?=.*(?:${re.source}))`);
}

/** A deputy or assistant to a director / head, or a bank's assistant VP. */
const DEPUTY =
  /\b(?:assistant|associate|deputy)\s+(?:director|head|general manager)\b|\bavp\b|\b(?:assistant|associate) vice president\b/;

/**
 * Pay and hours text that would otherwise read as a function. "$38/hr",
 * "24 hr" and "per hr" all contain the token `hr` and none is human resources.
 */
const HOURS_NOISE =
  /[$\d][\d.,]*\s*(?:\/|per|p)?\s*(?:hrs?|hours?)\b|\/\s*hrs?\b|\bper\s+hrs?\b|\b\d+\s*hrs?\b/g;

/** Lower-case, unify separators, strip pay/hours noise. */
export function cleanTitle(title: string): string {
  return ` ${title} `
    .toLowerCase()
    .replace(HOURS_NOISE, " ")
    .replace(/&/g, " and ")
    .replace(/\bhrbp\b/g, "hr business partner")
    .replace(/\bchro\b/g, "chief human resources officer")
    .replace(/\bsnr\b|\bsr\.?(?=\s)/g, "senior")
    .replace(/\bjnr\b|\bjr\.?(?=\s)/g, "junior")
    .replace(/\bmgr\b/g, "manager")
    .replace(/\bco-ordinator\b/g, "coordinator")
    .replace(/\bp\s*and\s*c\b/g, "people and culture")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(PLURAL_ROLE, "$1")
    .replace(/\bmidwives\b/g, "midwife")
    .replace(AD_BOILERPLATE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Registered Nurses", "HSE Advisors": one rule per noun, not two. */
const PLURAL_ROLE =
  /\b(nurse|advis[oe]r|officer|manager|coordinator|engineer|developer|consultant|assistant|accountant|recruiter|specialist|analyst|representative|executive|associate|driver|member|planner|salesperson|educator)s\b/g;

/**
 * Recruiting copy that lands in the title and names a track it is not.
 * Measured 2026-09-24: "HR Assistant (Training Provided)" sat on the L&D track,
 * and "Construction Manager - Attractive Remuneration" on HR's reward track.
 */
const AD_BOILERPLATE =
  /\b(?:(?:full|on the job|hands on) )?training (?:provided|given)\b|\b(?:hands on|on the job) training\b|\b(?:attractive|competitive|excellent|generous|great) (?:remuneration|salary|package|pay)(?: package)?\b/g;

/**
 * The generic seniority rubric, in precedence order. First match wins, so the
 * order is the logic: "Assistant Manager" must meet `assistant manager` (3)
 * before `manager` (4) and before `assistant` (1).
 */
const GENERIC_RUNGS: [RegExp, Rung][] = [
  // A deputy chief sits a band below the chief, whatever the chief is.
  [/\bdeputy chief\b/, 5],
  // Executive. "Chief … Officer" and the C-suite acronyms; a bare "chief"
  // (Chief Engineer, Chief Steward) is a senior practitioner, not the board.
  [
    execOnly(
      /\bchief\b(?:\s+\w+){1,4}\s+officer\b|\bc(?:e|f|o|t|i|p|hr|d|is|m)o\b|\bsenior vice president\b|\bsvp\b/,
    ),
    6,
  ],
  [/\bexecutive general manager\b|\begm\b|\bgroup executive\b/, 6],

  // Deputies and associates of a director sit a band below the director.
  [DEPUTY, 4],
  [
    /\bhead of\b|^head\b(?! office)|\bdirector\b|\bgeneral manager\b|\bgm\b|\bexecutive manager\b/,
    5,
  ],
  [execOnly(/\bvice president\b|\bvp\b/), 5],

  [/\bassistant manager\b|\b2ic\b/, 3],
  [/\bsenior manager\b|\bmanager\b|\bprincipal\b/, 4],
  // A mining superintendent manages the supervisors under them; placed with
  // managers rather than the senior practitioners.
  [/\bsuperintendent\b/, 4],

  // Entry markers override a practitioner noun: "Graduate Accountant" is 1.
  [
    /\bgraduate\b|\btrainee\b|\bjunior\b|\bintern\b|\binternship\b|\bcadet\b|\bapprentice\b|\bentry level\b/,
    1,
  ],

  // "Senior" lifts support roles to practitioner, and practitioners to senior.
  [/\bsenior\s+(?:\w+\s+){0,3}(?:assistant|administrator|coordinator|clerk|admin)\b/, 2],
  [/\bsenior\b|\blead\b|\bteam leader\b|\bsupervisor\b|\bbusiness partner\b/, 3],

  [
    /\bofficer\b|\badvis[oe]r\b|\bconsultant\b|\bgeneralist\b|\banalyst\b|\bspecialist\b|\bpractitioner\b|\bengineer\b|\bdeveloper\b|\baccountant\b|\bexecutive\b|\brecruiter\b|\bpartner\b|\btrainer\b|\bscientist\b|\bauditor\b/,
    2,
  ],
  [/\bassistant\b|\badministrator\b|\badmin\b|\bcoordinator\b|\bclerk\b|\bsupport\b/, 1],
];

export const FAMILIES: FamilyDef[] = [
  {
    id: "hr",
    label: "Human resources",
    match:
      /\bhr\b|\bhuman resources?\b|\bpeople and culture\b|\bpeople and capability\b|\bpeople and performance\b|\bpeople (?:partner|advis[oe]r|officer|business partner|lead|director|operations)\b|\bhead of people\b|\bdirector of people\b|\bchief people officer\b|\bchief human resources officer\b|\bemployee relations\b|\bindustrial relations\b|\bworkplace relations\b|\btalent acquisition\b|\blearning and development\b|\borganisational development\b|\borganizational development\b|\bremuneration\b|\bhris\b|\brecruiter\b|\binternal recruit|\brecruitment (?:coordinator|advis[oe]r|officer|manager|partner|lead|specialist|business partner|administrator|assistant|and mobilisation)\b|\bworkforce (?:plann\w*|capability|planning and)\b|\btalent (?:advis[oe]r|specialist|sourcer|partner)\b|\btraining and development\b|\blearning and talent\b/,
    skills: ["Human Resources"],
    // Payroll reports into HR at some employers and finance at others, and its
    // ladder (officer → payroll manager) does not lead to CPO: it is a family
    // of its own. Recruitment AGENCY consultants are a sales ladder.
    //
    // Workplace-relations LAWYERS practise employment law — "Senior Associate,
    // Workplace Relations, Employment & Safety" is a law-firm title. An "HR
    // Driver" holds a heavy-rigid licence. A project or product manager whose
    // product is an HR system is on the project ladder, tried later.
    exclude:
      /\bpayroll\b|\brecruitment consultant\b|\blawyer\b|\bsolicitor\b|\bcounsel\b|\blegal\b|\bparalegal\b|\bemployment and safety\b|\bassociate employment and\b|\bdriver\b|\btruck\b|\bforklift\b|\b(?:product|project|program|programme) manager\b|\bproduct owner\b/,
    tracks: [
      {
        id: "talent-acquisition",
        label: "Talent acquisition",
        match:
          /\btalent acquisition\b|\brecruit|\bsourc(?:er|ing)\b|\btalent (?:advis[oe]r|specialist|partner)\b/,
      },
      {
        id: "employee-relations",
        label: "Employee & industrial relations",
        match: /\bemployee relations\b|\bindustrial relations\b|\bworkplace relations\b/,
      },
      {
        id: "learning",
        label: "Learning & development",
        match:
          /\blearning\b|\btraining\b|\borgani[sz]ational development\b|\bcapability development\b/,
      },
      {
        id: "reward",
        label: "Reward & remuneration",
        match: /\bremuneration\b|\breward\b|\bcompensation\b|\bbenefits\b/,
      },
      {
        id: "hr-systems",
        label: "HR systems & analytics",
        match: /\bhris\b|\bhr systems\b|\bpeople systems\b|\bpeople analytics\b|\bhr analytics\b/,
      },
      {
        // Measured 2026-09-25: "Workforce Planner", "Workforce Planning
        // Officer", "Senior Manager Workforce Planning" — 60-odd ads a quarter
        // carrying the HR skill and no rung.
        id: "workforce",
        label: "Workforce planning",
        match: /\bworkforce (?:plann\w*|capability|planning and)\b/,
      },
    ],
    rungs: [
      [/\bchief people officer\b|\bchief human resources officer\b/, 6],
      [/\bhead of people\b|\bdirector of people\b|\bpeople director\b/, 5],
      // "People Partner" is the HRBP role under a newer name.
      [/\bpeople (?:business )?partner\b/, 3],
      // The generic rubric has no rung for a planner.
      [/\bworkforce planner\b/, 2],
    ],
    convergeAt: 5,
  },
  {
    id: "payroll",
    label: "Payroll",
    // administrator → officer / specialist → senior / team lead → payroll
    // manager → national / head of payroll. Its own ladder: it reports into HR
    // at some employers and finance at others, and leads to neither CPO nor
    // CFO. Measured 2026-09-25: ~500 payroll ads a quarter, none placed.
    match: /\bpayroll\b/,
    skills: ["Bookkeeping & Payroll"],
    // A payroll ACCOUNTANT is on the finance ladder, payroll tax is tax, and a
    // project manager or analyst whose system is payroll is on theirs.
    exclude:
      /\baccountant\b|\bpayroll accounting\b|\bpayroll tax\b|\b(?:project|program|programme|product) manager\b|\bbusiness analyst\b|\bdeveloper\b|\bengineer\b|\barchitect\b|\bsales\b|\brecruit|\btransformation\b/,
    generic: false,
    // Every title here says "payroll", so the rung words need not sit next to
    // it: "Payroll & Accounting Manager", "HR cum Finance Executive (Payroll)".
    rungs: [
      [/\bhead of payroll\b|\bdirector\b|\b(?:national|group|global) payroll manager\b/, 5],
      [/\bassistant (?:\w+ )?manager\b/, 3],
      [/\bmanager\b/, 4],
      [/\bsenior\b|\blead(?:er)?\b|\bsupervisor\b|\bbusiness partner\b/, 3],
      [
        /\b(?:officer|specialist|analyst|consultant|advis[oe]r|executive|associate|generalist)s?\b/,
        2,
      ],
      [/\b(?:administrator|admin|assistant|clerk|coordinator|support|trainee)\b/, 1],
    ],
  },
  {
    id: "finance",
    label: "Finance & accounting",
    skills: ["Finance & Accounting", "Bookkeeping & Payroll"],
    match:
      /\bfinance\b|\bfinancial\b(?! services)|\baccountant\b|\baccounting\b|\baccounts (?:payable|receivable)\b|\bbookkeeper\b|\b(?:financial|finance|group) controller\b|\bcomptroller\b|\btreasury\b|\bfp and a\b|\bcfo\b|\bchief financial officer\b|\btax\b/,
    // Advice, lending and insurance are other ladders that use the word; so
    // are bank sales ("Bancassurance Financial Executive") and financial-crime
    // compliance. "Financial Services" is an industry, dropped from `match`.
    exclude:
      /\bfinancial (?:planner|adviser|advisor|counsell?or|consultant|coach|aid|crime)\b|\bbancassurance\b|\bfinance broker\b|\bmortgage\b|\bloan\b|\blending\b|\binsurance (?:agent|broker|sales|consultant|advis[oe]r|specialist|planner)\b|\bfinance and insurance\b|\bfinance (?:sales|consultant)\b|\bsales\b(?! ledger)|\bcollections?\b|\bcustomer service\b|\blawyers?\b|\bsolicitors?\b|\bcounsel\b|\bparalegal\b|\bbanking and finance\b/,
    tracks: [
      {
        id: "fpa",
        label: "FP&A & commercial",
        match:
          /\bfp and a\b|\bfinancial planning and analysis\b|\bcommercial\b(?! (?:real estate|property|lending|banking|bank|insurance))|\bfinance business partner\b|\bfinancial analyst\b/,
      },
      { id: "tax", label: "Tax", match: /\btax\b/ },
      { id: "treasury", label: "Treasury", match: /\btreasury\b/ },
    ],
    rungs: [
      [execOnly(/\bchief financial officer\b|\bcfo\b/), 6],
      // Transactional roles are the entry rung whatever noun they carry —
      // unless they also name a rung above it: "Accounts Payable Manager" was
      // on rung 1 until 2026-09-24. Those fall to the generic rubric.
      [
        /^(?!.*\b(?:manager|supervisor|team leader|lead|director|head|controller)\b).*(?:\baccounts (?:payable|receivable)\b|\bbookkeeper\b|\baccounts officer\b|\bassistant accountant\b|\baccounts assistant\b|\bfinance assistant\b)/,
        1,
      ],
      // A Financial Controller heads finance at a mid-size employer and sits
      // under a finance director at a large one. Placed at manager: the band
      // below the ambiguity rather than above it.
      [/\bcontroller\b|\bcomptroller\b/, 4],
    ],
  },
  {
    id: "nursing",
    label: "Nursing & midwifery",
    skills: ["Nursing"],
    match: /\bnurse\b|\bnurses\b|\bnursing\b|\bmidwife\b|\bmidwifery\b|\bmidwives\b/,
    // Nursing HOMES advertise cooks, cleaners and carers under the word.
    exclude:
      /\b(?:cook|cleaner|chef|kitchen\w*|maintenance|driver|receptionist)\b|\b(?:administration|administrative) officer\b|\bveterinary nurse\b|\bdental nurse\b|\bprofessor\b|\blecturer\b|\bacademic\b|\btutor\b|\bschool of nursing\b|\btrainer\b|\bteacher\b|\b(?:physical|occupational) therap|\btherapy assistant\b|\btechnician\b|\btechnical officer\b|\badministration officer\b/,
    tracks: [{ id: "midwifery", label: "Midwifery", match: /\bmidwi/ }],
    generic: false,
    // Nursing titles carry their grade in the noun, not a seniority word, so
    // the family rules do nearly all the work here.
    rungs: [
      [/\bexecutive director (?:of )?nursing\b/, 6],
      [execOnly(/\bchief nursing\b/), 6],
      [
        /\b(?:assistant|associate|deputy) (?:director of (?:nursing|midwifery)|nursing director)\b|\badon\b/,
        4,
      ],
      [/\bdirector of nursing\b|\bnursing director\b|\bdirector of midwifery\b|\bdon\b/, 5],
      [
        /\b(?:nurse|nursing) unit manager\b|\bmidwifery unit manager\b|\bnum\b|\bnurse manager\b|\bclinical nurse consultant\b|\bnurse practitioner\b|\bclinical midwife consultant\b/,
        4,
      ],
      [
        /\bclinical nurse\b|\bclinical midwife\b|\bnurse educator\b|\bclinical nurse specialist\b|\bclinical nurse educator\b|\bclinical specialist\b|\bsenior (?:registered |staff )?nurse\b/,
        3,
      ],
      // Before the bare `nurse` below, which would otherwise claim "Enrolled Nurse".
      [
        // The US licensed and Canadian registered PRACTICAL nurse are the
        // enrolled-nurse grade, not the registered one.
        /\bassistant in nursing\b|\bnursing assistant\b|\bain\b|\benrolled nurse\b|\bstudent nurse\b|\b(?:licensed|registered) practical nurse\b|\blpn\b|\brpn\b/,
        1,
      ],
      [
        /\bgraduate (?:registered )?nurse\b|\bregistered nurse\b|\bregistered midwife\b|\bmidwife\b|\bnurse\b/,
        2,
      ],
    ],
  },
  {
    id: "project",
    label: "Project & program management",
    skills: ["Project Management"],
    match: /\bproject\b|\bprogram\b|\bprogramme\b|\bpmo\b/,
    // Project ENGINEERS and accountants are on their own discipline's ladder;
    // a portfolio manager at a fund manages money, not projects.
    exclude:
      /\bproject engineer(?:s|ing (?:manager|lead|director))?\b|\bproject (?:accountant|architect|surveyor|geologist|lawyer|scientist)\b|\bprogram(?:me)?\s+(?:developer|engineer)\b|\binvestment\b|\bfund\b|\bgraduate program\b|\bgraduate programme\b|\bnutrition\b|\bsocial worker\b|\bresidency\b|\bfellowship\b|\bgeologist\b|\bteacher\b|\b(?:vacation|cadetship|cadet|internship|intern|undergraduate|traineeship|graduate|summer|winter|early careers?|accelerator|apprenticeship|school based) (?:\w+ )?program(?:me)?\b/,
    // Planning, scheduling and cost control: officer → senior → lead → manager,
    // its own ladder beside the PM one. Until 2026-09-24 "Project Controls
    // Manager" sat on rung 2 with the project officers.
    tracks: [
      {
        id: "controls",
        label: "Project controls",
        match:
          /\bproject controls?\b|\b(?:project|program|programme) (?:planner|scheduler|controller|cost controller|planning)\b|\bcost controller\b/,
      },
    ],
    generic: false,
    rungs: [
      [
        /\bhead of project controls\b|\bproject controls director\b|\bdirector (?:of )?project controls\b/,
        5,
      ],
      [
        /\bmanager project controls?\b|\bproject controls? manager\b|\bprincipal (?:project |program |programme )?(?:planner|scheduler|cost controller|controls?)\b|\bplanning manager\b/,
        4,
      ],
      [
        /\bsenior (?:project |program |programme )?(?:planner|scheduler|controller|cost controller|controls?|control specialist)\b|\bproject controls? lead\b|\blead (?:project )?(?:planner|scheduler)\b/,
        3,
      ],
      [
        /\b(?:project|program|programme) (?:planner|scheduler|controller|cost controller)\b|\bproject controls? (?:officer|analyst|specialist|engineer|coordinator)\b|\bproject control specialist\b|\bcost controller\b/,
        2,
      ],
      [
        /\bhead of (?:pmo|projects|delivery)\b|\bproject director\b|\bprogram(?:me)? director\b|\bportfolio (?:manager|director)\b|\bpmo manager\b/,
        5,
      ],
      [
        /\bsenior project manager\b|\bprogram(?:me)? manager\b|\bsenior manager project management\b/,
        4,
      ],
      // A project manager runs a project, not a team — the senior-practitioner
      // band, not the generic "manager".
      [/\b(?:assistant|associate|junior) project manager\b/, 2],
      [/\bprincipal (?:project|program|programme) officer\b/, 3],
      [/\bproject manager\b|\bproject lead\b|\bproject leader\b|\bpmo lead\b/, 3],
      [
        /\b(?:project|program|programme|pmo) (?:officer|analyst|scheduler|controls)\b|\bproject management officer\b/,
        2,
      ],
      [/\b(?:project|program|programme|pmo) (?:administrator|support|coordinator|assistant)\b/, 1],
    ],
  },
  {
    id: "software",
    label: "Software engineering",
    skills: ["Software Engineering"],
    match:
      /\bsoftware\b|\bdeveloper\b|\bprogrammer\b|\bfull ?stack\b|\bfront ?end\b|\bback ?end\b|\bdevops\b|\bsite reliability\b|\bsre\b|\b(?:platform|product|web|mobile|cloud) engineering\b|\bcto\b|\bchief technology officer\b|\bplatform engineer\b|\b(?:net|java|python|c|golang|ruby|php|javascript|typescript|react|node|scala|kotlin|swift|ios|android|murex|sql) (?:engineer|developer)\b|\b(?:test|qa) automation\b|\bautomation (?:test|qa)\w*\b|\bsoftware test\w*\b|\bqa (?:engineer|analyst|tester)\b|\btest analyst\b|\bapi automation tester\b/,
    // A Costco "Front End Cashier" works the checkouts; software asset
    // management is licensing; a "Field CTO" is presales.
    exclude:
      /\bproduct owner\b|\bsales\b|\baccount (?:manager|executive)\b|\bbusiness development\b|\bsupport\b|\btrainer\b|\bproperty developer\b|\bbusiness developer\b|\bland developer\b|\bloader\b|\boperator\b|\bcashier\b|\bcheckout\b|\bsoftware (?:asset|licen\w*|administrator)\b|\b(?:field|account) cto\b|\b(?:substation|electrical|mechanical|civil|structural|maintenance|facilities|plant|process|manufacturing|production|hvac|building|mining|rail|traffic|water|asset|project|program|field|customer|systems|design) engineering\b|\bresidences\b/,
    // A bare "Engineering Manager" or "Director of Engineering" names no
    // discipline. Measured 2026-09-24: at Marriott it is the hotel's plant and
    // maintenance, at Worley and AECOM civil and process engineering, at REA,
    // CBA and Xero software. Only the employer says which (ladderEmployers.ts).
    employerMatch:
      /\bengineering manager\b|\bhead of engineering\b|\bdirector of engineering\b|\b(?:vp|vice president)(?: of)? engineering\b|\bengineering director\b/,
    rungs: [
      [DEPUTY, 4],
      [/\b(?:deputy|assistant|associate) (?:cto|chief technology officer)\b/, 5],
      [execOnly(/\bchief technology officer\b|\bcto\b/), 6],
      [/\bhead of engineering\b|\bdirector of engineering\b|\bvp engineering\b/, 5],
      // The senior IC track: paid and scoped like a manager, manages no one.
      [/\bstaff (?:\w+ ){0,2}engineer\b|\bprincipal\b|\barchitect\b|\bengineering manager\b/, 4],
      [/\btech(?:nical)? lead\b|\blead (?:developer|engineer|software engineer)\b/, 3],
    ],
  },
  {
    id: "retail",
    label: "Retail (store operations)",
    skills: ["Retail & Customer Service", "Retail Operations"],
    // The store ladder: assistant → key holder → 2IC → store manager → area /
    // state manager. "Sales Assistant" is here rather than in sales because in
    // Australian ads it is overwhelmingly a shop-floor role.
    match:
      /\bretail\b|\bstore\b|\bstores\b|\bshop\b|\bboutique\b|\bsupermarket\b|\bsales assistant\b|\bcheckout\b|\bcashier\b|\bnight ?fill\b|\bkey ?holder\b|\bvisual merchandis\w*|\bmerchandiser\b/,
    // A storeperson and a mining "Stores Officer" are warehousing; the trades
    // and professions that work in or for shops are their own ladders; head
    // office buying and planning is a different ladder not yet modelled.
    exclude:
      /\bstore ?(?:person|man|men)\b|\bstore (?:development|design|planning)\b|\bstores (?:officer|coordinator|clerk|supervisor|person)\b|\bwarehouse\b|\bdistribution cent|\bcold store\b|\bretail (?:bank|banking|lending|energy|credit)\b|\bpharmac|\bbutcher\b|\bbaker\b|\bbarista\b|\bchef\b|\bcook\b|\bshop ?fitter\b|\bmachine shop\b|\bshop floor\b|\bworkshop\b|\belectrician\b|\bmechanic\b|\btechnician\b|\bdriver\b|\bforklift\b|\bsecurity\b|\bcleaner\b|\bloss prevention\b|\boptometrist\b|\bhairdresser\b|\bsoftware\b|\bdeveloper\b|\bengineer\b|\banalyst\b|\bplanner\b|\bbuyer\b|\ballocator\b|\bproduction\b|\bmanufacturing\b|\b(?:plant|process|machine) operator\b|\blaborator|\bdc\b|\bdispatch\b|\bcafe\b|\bstocktake\b|\bstores and\b|\bsupply officer\b|\blease\b|\bleasing\b|\bproperty\b|\bcommercial\b|\bmedia\b|\bmarketing\b|\bsafety\b|\bwhs\b|\bhse\b|\bdesign\b|\bproduct (?:manager|owner)\b|\bdeposits\b|\bbanking\b/,
    // Only for employers in ladderEmployers.ts's retail set: store roles
    // advertised without a retail word. Deliberately absent — "Duty Manager"
    // (Endeavour's pubs, airports, cinemas) and a bare "Supervisor" or "Team
    // Leader" (distribution centres, Wesfarmers' chemical plants).
    employerMatch:
      /\bteam member\b|\bcrew member\b|\bcustomer service (?:assistant|advis[oe]r|team member|supervisor|manager)\b|\bcustomer (?:assistant|advis[oe]r)\b|\bdepartment manager\b|\bassistant manager\b|\b2ic\b|\bsecond in charge\b|\bconsole operator\b|\bsales (?:consultant|associate|advis[oe]r)\b|\bservice (?:team member|assistant)\b|\b(?:fresh produce|produce|dry goods|grocery|deli|bakery|seafood|dairy|frozen|fresh food) manager\b/,
    tracks: [
      { id: "visual-merchandising", label: "Visual merchandising", match: /\bvisual merchandis/ },
    ],
    // The DCs, cafés and stocktakes above are a retailer's other workforces;
    // "retail" in a head-office title ("Retail Media", "Retail Marketing
    // Manager", "Retail Lease Admin") is the INDUSTRY, not the store ladder.
    //
    // No generic rubric: it read those head-office titles as store rungs —
    // "Performance Media Specialist - Retail Media" was a rung-2 store role.
    // Every rung is enumerated. Retail compresses: area, state and national
    // managers all share rung 5, and the node's titles show which.
    generic: false,
    rungs: [
      [
        /\bhead of (?:retail|stores?|store operations)\b|\b(?:retail|store operations|stores) director\b|\bdirector (?:of )?(?:national )?(?:retail|stores|store operations)\b|\bgeneral manager (?:retail|stores|store operations)\b/,
        5,
      ],
      [
        /\b(?:area|district|regional|state|national|multi ?site|cluster) (?:retail |store |operations |sales )?manager\b/,
        5,
      ],
      [
        /\b(?:trainee|graduate) (?:store |retail )?manager\b|\bmanager in training\b|\bassistant (?:store |retail |shop |boutique )?manager\b|\bdeputy (?:store|retail|shop|boutique) manager\b|\b2ic\b|\bsecond in charge\b|\bdepartment manager\b|\bduty manager\b|\bcustomer service manager\b|\bsenior visual merchandiser\b|\bnight ?fill manager\b|\bassistant (?:\w+ ){1,3}manager\b|\bdepartment lead(?:er)?\b|\bstore support manager\b|\b(?:fresh produce|produce|dry goods|grocery|deli|bakery|seafood|dairy|frozen|fresh food) manager\b/,
        3,
      ],
      // Until 2026-09-24 "Nightfill Manager" (430 rows with its assistants) was
      // rung 1: the rung-1 rule below matched `nightfill` first.
      [
        /\b(?:store|retail|shop|boutique|flagship|outlet|retail store|retail sales|retail operations|store operations|store business|thrift shop)\s+manager\b|\bvisual merchandising manager\b/,
        4,
      ],
      [/\bvisual merchandis\w* director\b|\bdirector (?:of )?visual merchandis/, 5],
      // A store supervisor or team leader is a key holder, not a senior
      // professional — the generic rubric would say 3.
      [
        /\bkey ?holder\b|\bsupervisor\b|\bteam leader\b|\bsenior (?:sales|retail|store|shop) (?:assistant|consultant|associate)\b|\bvisual merchandiser\b|\bvisual merchandising (?:coordinator|specialist)\b|\bretail sales (?:specialist|executive)\b|\bretail executive\b/,
        2,
      ],
      [
        /\b(?:sales|retail|store|shop) (?:assistant|consultant|associate|advis[oe]r)\b|\bteam member\b|\bcrew member\b|\bcashier\b|\bcheckout\b|\bnight ?fill\b|\bmerchandiser\b|\bcustomer (?:service )?(?:assistant|advis[oe]r)\b|\bconsole operator\b|\bservice assistant\b|\bsalesperson\b/,
        1,
      ],
    ],
  },
  {
    id: "sales",
    label: "Sales & business development",
    skills: ["Sales & Business Dev"],
    // B2B and field sales: SDR → account executive → BDM / key account manager
    // → sales manager → head of sales → CRO. Nearly every rung is called
    // "manager", so the generic rubric is off and every rung is enumerated.
    match:
      /\bsales\b|\baccount (?:manager|executive|director|management)\b|\bkey account\b|\bnational account\b|\bstrategic account\b|\bbusiness development\b|\bbdm\b|\bbdr\b|\bsdr\b|\bbde\b|\bterritory manager\b|\bchief revenue officer\b|\bchief commercial officer\b/,
    // Technical presales and sales operations are other ladders; agency
    // recruitment is excluded from HR and from here alike.
    exclude:
      /\bpre ?sales\b|\bsales engineer\b|\bsolutions? engineer\b|\bsales tax\b|\bpoint of sale\b|\bsales ledger\b|\bsales (?:analyst|operations|ops|planner|planning|enablement)\b|\brecruitment\b|\baccounts? (?:payable|receivable)\b/,
    tracks: [
      {
        id: "account-management",
        label: "Account management",
        match:
          /\baccount manager\b|\bkey account\b|\baccount director\b|\bnational account\b|\bstrategic account\b|\baccount management\b/,
      },
    ],
    generic: false,
    rungs: [
      [
        execOnly(
          /\bchief (?:revenue|sales|commercial) officer\b|\bsvp\b|\bsenior vice president\b/,
        ),
        6,
      ],
      [/\bexecutive general manager\b|\bgroup executive\b/, 6],
      // Before the director rule: "Assistant Director of Sales" (23 roles) was
      // on rung 5 until 2026-09-24.
      [DEPUTY, 4],
      [
        /\bhead of (?:sales|business development|partnerships|account management|revenue)\b|\bsales director\b|\bdirector (?:of )?(?:sales|business development)\b|\bbusiness development director\b|\bnational sales manager\b|\bgeneral manager\b/,
        5,
      ],
      [execOnly(/\bvp\b|\bvice president\b/), 5],
      [/\bassistant (?:\w+ ){0,2}manager\b/, 3],
      // A sales manager leads reps. An ACCOUNT manager does not, and is below.
      [
        /\baccount director\b|\b(?:state|regional|area) sales manager\b|\bsales manager\b|\bsales and marketing manager\b|\bmanager sales\b/,
        4,
      ],
      // Entry markers after the manager rungs, so "Graduate Account Manager"
      // is 1 and a (rare) "Junior Sales Manager" is not.
      [
        /\bgraduate\b|\btrainee\b|\bjunior\b|\bcadet\b|\bintern\b|\bsdr\b|\bbdr\b|\b(?:sales|business) development rep(?:resentative)?\b|\b(?:sales|key account|account|business development) (?:support|administrator|admin|coordinator|assistant)\b|\btelesales\b|\blead generat/,
        1,
      ],
      [
        /\bkey account\b|\bnational account manager\b|\bstrategic account\b|\bsenior account (?:manager|executive)\b|\benterprise account executive\b|\bbusiness development manager\b|\bbdm\b|\bsenior business development\b|\bsales (?:team )?(?:leader|lead)\b|\baccount management team leader\b|\bsales supervisor\b|\bmanager business development\b|\bbusiness development (?:lead|partner)\b|\blead business development\b/,
        3,
      ],
      // "Senior Named Account Executive", "Senior Ready Mix Sales
      // Representative": the qualifier sits between "senior" and the noun.
      [
        /\bsenior (?:\w+ ){0,2}account (?:manager|executive)\b|\bsenior (?:\w+ ){0,3}sales (?:executive|representative|rep|consultant)\b/,
        3,
      ],
      [
        /\baccount (?:manager|executive)\b|\bbusiness development (?:executive|consultant|officer|associate|specialist)\b|\bsales and marketing (?:executive|consultant|representative)\b|\baccount management specialist\b|\bbde\b|\bsales (?:executive|representative|rep|consultant|specialist|agent|advis[oe]r|associate|person|professional|officer)\b|\bterritory manager\b|\binside sales\b|\bfield sales\b|\bnew business\b/,
        2,
      ],
    ],
  },
  {
    id: "hse",
    label: "Health, safety & environment",
    skills: ["HSE / Safety"],
    match:
      /\bhse\b|\bhsse\b|\bhseq\b|\bwhs\b|\bohs\b|\bhealth and safety\b|\bsafety\b|\bwork health\b|\boccupational health\b/,
    // Other people's "safety", and the elected health-and-safety rep, which is
    // a duty an employee holds, not a job.
    exclude:
      /\bfood safety\b|\bpatient safety\b|\bchild safety\b|\bcyber\b|\bsafety (?:glass|boots)\b|\bhsr\b|\bsafety rep(?:resentative)?\b|\bproduct safety\b|\bdrug safety\b|\bpharmacovigilance\b|\bfire safety engineer|\blawyer\b|\bsolicitor\b|\bcounsel\b|\bemployment and safety\b/,
    rungs: [[/\bsafety superintendent\b|\bhse superintendent\b/, 4]],
  },
  {
    id: "legal",
    label: "Legal",
    // Private practice: paralegal / graduate → lawyer / solicitor → senior
    // associate → special counsel → partner. In-house and government: legal
    // counsel / legal officer → senior → principal → general counsel → CLO.
    // Before risk and HR: a workplace-relations lawyer is a lawyer.
    match:
      /\blawyers?\b|\bsolicitors?\b|\bparalegal\b|\bbarrister\b|\blaw (?:clerk|graduate)\b|\blegal (?:counsel|officer|assistant|associate|practitioner|specialist|advis[oe]r|director|manager|clerk|intern|trainee|graduate)\b|\bcounsel\b|\bgeneral counsel\b|\bchief legal officer\b|\bhead of legal\b|\bcompany secretar\w*\b|\bspecial counsel\b|^(?:equity |salaried )?partner\b(?!.*\b(?:talent|customer|business|hr|people|delivery|channel|alliance)\b)|\bpartner\b.*\b(?:law|lawyers?|legal|litigation|disputes|banking and finance)\b|\bsenior associate\b.*\b(?:law|legal|litigation|disputes|workplace relations|employment|insurance|real estate|property|construction|corporate|commercial|banking|planning|environment|m and a)\b/,
    skills: ["Commercial & Legal"],
    // A legal SECRETARY is support (the admin ladder); genetic and financial
    // counsellors are not counsel.
    exclude:
      /\blegal secretary\b|\bcounsell?or\b|\bsales\b|\baccount (?:manager|executive)\b|\bbusiness development\b|\bnurse\b|\brecruit/,
    tracks: [
      {
        id: "in-house",
        label: "In-house & government",
        // Special counsel is a private-practice rank, between senior associate
        // and partner — not in-house.
        match:
          /^(?!.*\bspecial counsel\b).*(?:\bcounsel\b|\blegal officer\b|\bchief legal officer\b|\bhead of legal\b|\bcompany secretar)/,
      },
    ],
    generic: false,
    rungs: [
      [execOnly(/\bchief legal officer\b|\bclo\b/), 6],
      [
        /\bgeneral counsel\b|\bhead of legal\b|\blegal director\b|\bdirector (?:of )?legal\b|\b(?:equity |salaried )?partner\b/,
        5,
      ],
      [
        /\bspecial counsel\b|\bprincipal (?:lawyer|solicitor|legal officer|legal counsel|counsel)\b|\bexecutive counsel\b|\blead counsel\b|\bmanaging (?:lawyer|solicitor|principal)\b|\blegal manager\b|\bcompany secretary\b(?!.*\bassistant\b)/,
        4,
      ],
      [
        /\bsenior (?:associate|lawyer|solicitor|legal (?:counsel|officer)|corporate counsel|counsel)\b|\bassistant company secretary\b/,
        3,
      ],
      [
        /\bparalegal\b|\blegal assistant\b|\blaw clerk\b|\b(?:graduate|junior|trainee) (?:lawyer|solicitor)\b|\blaw graduate\b|\blegal (?:intern|trainee|graduate)\b/,
        1,
      ],
      [
        /\blawyers?\b|\bsolicitors?\b|\bbarrister\b|\bcounsel\b|\blegal officer\b|\bassociate\b|\blegal (?:specialist|advis[oe]r|practitioner)\b/,
        2,
      ],
    ],
  },
  {
    id: "insurance",
    label: "Insurance",
    // Claims: officer → senior → team leader → claims manager. Underwriting:
    // underwriter → senior → underwriting manager. Actuarial: intern →
    // analyst → senior / actuary → manager → head of actuarial.
    //
    // COMMISSION SALES IS LEFT OUT. US "Insurance Agent", Singapore's
    // "Insurance Planner" and a car dealer's "Finance and Insurance
    // Consultant" sell policies; they are not this ladder. Neither is the
    // French "mandataire / agent d'assurance" — assurance is French for
    // insurance, and those are agents too.
    match:
      /\binsurance\b|\bunderwrit\w*\b|\bclaims? (?:officer|consultant|assessor|specialist|manager|adjuster|handler|advis[oe]r|lead|team leader|analyst|representative|administrator)\b|\bloss adjuster\b|\bactuar\w*\b|\binsurance broker\b|\bbroking\b/,
    skills: ["Insurance & Actuarial"],
    exclude:
      /\bdriver\b|\binsurance (?:agent|planner|sales)\b|\bfinance and insurance\b|\bagents?\b|\baudit\w*\b|\baccountant\b|\bproduct (?:manager|owner)\b|\bcapital raising\b|\bmandataire\b|\bsales\b|\bnurse\b|\blawyer\b|\bsolicitor\b|\bsoftware\b|\bdeveloper\b|\bpolicy (?:administrator|admin)\b/,
    tracks: [
      { id: "actuarial", label: "Actuarial", match: /\bactuar/ },
      { id: "underwriting", label: "Underwriting", match: /\bunderwrit/ },
      { id: "claims", label: "Claims", match: /\bclaims?\b|\bloss adjuster\b/ },
    ],
    rungs: [
      [/\bhead of (?:actuarial|claims|underwriting)\b|\bappointed actuary\b|\bchief actuary\b/, 5],
      [/\bactuarial (?:intern|graduate|trainee|student)\b/, 1],
      [/\bsenior\b|\blead\b|\bteam leader\b|\bactuary\b/, 3],
      [
        /\bunderwriter\b|\bloss adjuster\b|\bclaims (?:officer|assessor|handler|representative)\b/,
        2,
      ],
    ],
  },
  {
    id: "risk",
    label: "Risk, compliance & audit",
    // officer / analyst → senior / adviser → risk or compliance manager →
    // head of risk / internal audit → CRO. Before banking: a bank's credit
    // risk and financial-crime compliance teams are on this ladder.
    match:
      /\brisk\b|\bcompliance\b|\baudit(?:or|ors)?\b|\bassurance\b|\bgovernance\b|\bfraud\b|\baml\b|\bfinancial crime\b|\bsanctions\b|\bkyc\b|\bregulatory (?:affairs|compliance|reporting|specialist|advis[oe]r|manager)\b|\bprivacy (?:officer|manager|advis[oe]r|specialist)\b|\bchief risk officer\b/,
    skills: ["Risk & Compliance"],
    // Quality assurance is its own ladder; cyber and data governance are IT's
    // and data's; French "assurance" is insurance; clinical risk is nursing's.
    exclude:
      /\b(?:low|medium|high|educational|at) risk\b|\bnight audit\w*\b|\bfront desk\b|\bprocess worker\b|\bteachers?\b|\blecturer\b|\bteaching\b|\bquality\b|\bqa\b|\bcyber\b|\bsecurity\b|\bidentity governance\b|\bdata (?:governance|and ai governance)\b|\binformation governance\b|\bai governance\b|\bmandataire\b|\bagent\b|\bassurances?\b.*\bcollectives?\b|\bclinical\b|\bsafety\b|\bengineer\b|\bsales\b|\bnurse\b|\bsoftware\b|\bstore\b|\bbeautician\b/,
    tracks: [
      { id: "audit", label: "Audit & assurance", match: /\baudit|\bassurance\b/ },
      {
        id: "compliance",
        label: "Compliance & financial crime",
        match:
          /\bcompliance\b|\bfinancial crime\b|\baml\b|\bkyc\b|\bsanctions\b|\bfraud\b|\bregulatory\b|\bprivacy\b/,
      },
    ],
  },
  {
    id: "quality",
    label: "Quality (QA / QC)",
    // inspector / technician → QA officer / QA-QC engineer → supervisor /
    // senior → quality manager → head of quality. Software QA is testing and
    // stays with software, which is tried first.
    match:
      /\bquality (?:assurance|control|manager|management|engineer|officer|advis[oe]r|inspector|technician|coordinator|lead|specialist|analyst|systems|director)\b|\bqa ?qc\b|\bqc (?:inspector|technician|officer|supervisor|analyst|engineer|manager)\b|\bqa (?:officer|manager|advis[oe]r|inspector|technician|coordinator|lead|specialist)\b|\bhead of quality\b/,
    skills: ["Quality Assurance"],
    exclude:
      /\bsoftware\b|\btest(?:er|ing)?\b|\bautomation\b|\bnurse\b|\bclinical\b|\bpatient\b|\bsales\b|\bdata quality\b|\bfood safety\b/,
    rungs: [
      [/\bhead of quality\b|\bquality director\b|\bdirector (?:of )?quality\b/, 5],
      [/\binspector\b|\btechnician\b/, 1],
    ],
  },
  {
    id: "community",
    label: "Community, stakeholder & heritage",
    // officer / advisor → senior → lead / specialist → manager. Heritage and
    // native title: field officer → heritage advisor → senior → manager.
    // Before banking: "Heritage Bank" is a bank, and excluded here.
    match:
      /\bnative title\b|\bcultural heritage\b|\bheritage (?:advis[oe]r|specialist|officer|field|manager|lead|consultant|coordinator|compliance)\b|\b(?:lead|superintendent|senior advis[oe]r|specialist) (?:\w+ )?heritage\b|\bstakeholder (?:engagement|relations|manager|advis[oe]r|specialist|lead|officer)\b|\bcommunity (?:relations|engagement|liaison|and stakeholder)\b|\bindigenous (?:engagement|relations|affairs)\b|\bgovernment (?:relations|and stakeholder relations)\b|\bland access\b/,
    skills: ["Community & Native Title"],
    exclude:
      /\bheritage bank\b|\bsales\b|\bnurse\b|\bengineer\b|\bcommunications\b|\bteach\w*\b|\blecturer\b/,
    tracks: [
      {
        id: "heritage",
        label: "Heritage & native title",
        match: /\bheritage\b|\bnative title\b|\bland access\b/,
      },
    ],
  },
  {
    id: "banking",
    label: "Banking, lending & advice",
    // Branch: teller → banking consultant → branch manager. Lending: lending
    // officer → lending manager → senior lending manager. Relationship
    // banking: relationship / business banking manager → senior RM → head.
    // Advice: paraplanner → financial adviser → senior → practice principal.
    // Investment banking runs on bank GRADES: analyst → associate → VP →
    // director → managing director — VP here is the fourth rung, not an
    // executive.
    match:
      /\bbanking\b|\bbanker\b|\bbank (?:teller|officer|manager|branch|consultant|specialist|analyst)\b|\bheritage bank\b|\blending\b|\blender\b|\bmortgage\b|\bloans?\b|\bcredit (?:analyst|officer|assessor|specialist|manager|assessment)\b|\bparaplanner\b|\bfinancial (?:planner|adviser|advisor)\b|\bwealth (?:adviser|advisor|manager|specialist|relationship manager|protection)\b|\bprivate wealth\b|\brelationship manager\b|\bteller\b/,
    skills: ["Banking & Lending"],
    // Collections and bank sales are other ladders; food and blood banks are
    // not banks, and neither is "Rydges South Bank" — hence no bare "bank" in
    // `match`. "Banking & Finance" is a law-firm practice area.
    exclude:
      /\bbanking and finance\b|\blegal\b|\beditor\b|\bcredit control\w*\b|\bcollections?\b|\bbancassurance\b|\bfinancial consultant\b|\bfood bank\b|\bblood bank\b|\bsperm bank\b|\bsoftware\b|\bdeveloper\b|\bengineer\b|\bdata\b|\bsales\b|\bnurse\b|\blawyer\b|\bsolicitor\b|\bmarketing\b|\bproduct (?:manager|owner)\b/,
    tracks: [
      { id: "investment-banking", label: "Investment banking", match: /\binvestment bank/ },
      {
        id: "advice",
        label: "Financial advice",
        match:
          /\bparaplanner\b|\bfinancial (?:planner|adviser|advisor)\b|\bwealth (?:adviser|advisor)\b|\bprivate wealth adviser\b/,
      },
      {
        id: "lending",
        label: "Lending",
        match: /\blending\b|\blender\b|\bmortgage\b|\bloans?\b|\bcredit\b/,
      },
      {
        id: "relationship",
        label: "Relationship banking",
        match:
          /\brelationship (?:manager|director)\b|\b(?:business|corporate|commercial|private|institutional|agribusiness) bank(?:ing|er)\b/,
      },
    ],
    generic: false,
    rungs: [
      // Investment banking, by grade.
      [/\binvestment bank\w*\b.*\bmanaging director\b|\bmanaging director\b.*\binvestment bank/, 6],
      [/\binvestment bank\w*\b.*\bdirector\b|\bdirector\b.*\binvestment bank/, 5],
      [
        /\binvestment bank\w*\b.*\b(?:vice president|vp)\b|\b(?:vice president|vp)\b.*\binvestment bank/,
        4,
      ],
      [/\binvestment bank\w*\b.*\bassociate\b|\bassociate\b.*\binvestment bank/, 3],
      [
        /\binvestment bank\w*\b.*\b(?:analyst|intern)\b|\b(?:analyst|intern)\b.*\binvestment bank/,
        2,
      ],
      // Everyone else.
      [/\bhead of\b|\bgeneral manager\b|\bdirector\b|\bpractice principal\b/, 5],
      [
        /\bsenior (?:\w+ ){0,2}(?:lending|banking|relationship) manager\b|\brelationship director\b|\bbranch manager\b|\bsenior (?:financial|wealth|private wealth) advis[oe]r\b/,
        4,
      ],
      [
        /\b(?:lending|banking|relationship|mortgage|credit|wealth) manager\b|\bsenior (?:credit|lending) (?:analyst|officer|specialist)\b|\bteam leader\b/,
        3,
      ],
      [
        /\bteller\b|\bparaplanner\b|\b(?:graduate|trainee|intern|junior)\b|\bcustomer service (?:officer|representative)\b|\bclerk\b/,
        1,
      ],
      [
        /\bbanking (?:consultant|specialist|advis[oe]r|officer|executive)\b|\b(?:customer|personal|transaction|premier) banking (?:specialist|advis[oe]r|consultant)\b|\bpersonal banker\b|\bmember experience officer\b|\blending (?:officer|specialist|executive|assessment officer|consultant)\b|\bhome lending\b|\bmortgage (?:broker|specialist|consultant|adviser|advisor|loan specialist)\b|\bcredit (?:analyst|officer|assessor|specialist)\b|\bfinancial (?:planner|adviser|advisor)\b|\b(?:private )?wealth (?:adviser|advisor|specialist)\b|\bwealth protection\b|\bspecialist\b|\bconsultant\b|\bofficer\b|\banalyst\b|\bexecutive\b/,
        2,
      ],
    ],
  },
  {
    id: "marketing",
    label: "Marketing & communications",
    // assistant / coordinator → executive / specialist → senior / brand manager
    // → marketing manager → head of marketing → CMO. Communications and PR
    // run the same bands. After sales: "Sales & Marketing Executive" is sales.
    match:
      /\bmarketing\b|\bbrand (?:manager|executive|coordinator|specialist|director|lead|strategist|marketing)\b|\bcommunications? (?:officer|advis[oe]r|coordinator|specialist|manager|lead|director|executive|partner|consultant|assistant|business partner)\b|\bhead of (?:communications|brand)\b|\bpublic relations\b|\bpr (?:executive|manager|coordinator|officer|consultant|specialist)\b|\bmedia relations\b|\bcontent (?:marketing|strategist|coordinator|manager|specialist|lead|producer|creator)\b|\bsocial media\b|\bcopy ?writer\b|\bseo\b|\bdigital marketing\b|\bcampaign (?:manager|coordinator|executive|specialist)\b|\bchief marketing officer\b|\binternal communications\b/,
    skills: ["Marketing & Comms"],
    // Brand ambassadors are promotional staff; communications TECHNICIANS and
    // engineers are telecoms.
    exclude:
      /\bbrand ambassador\b|\bcommunications? (?:technician|engineer|network|systems|operator|centre)\b|\btelecommunications\b|\bradio\b|\bmedia buyer\b|\bnurse\b|\bdriver\b/,
    tracks: [
      {
        id: "communications",
        label: "Communications & PR",
        match: /\bcommunications?\b|\bpublic relations\b|\bpr\b|\bmedia relations\b/,
      },
    ],
    rungs: [
      [/\bassistant brand manager\b/, 2],
      [/\bsenior brand manager\b|\bbrand director\b/, 4],
      // A brand manager in FMCG runs a brand, not a team.
      [/\bbrand manager\b/, 3],
    ],
  },
  {
    id: "procurement",
    label: "Procurement, buying & supply chain",
    // officer / specialist → senior → category manager / procurement manager
    // → head of procurement → CPO. Retail buying: assistant buyer → buyer →
    // senior buyer → buying manager. Supply chain: analyst / planner →
    // senior → supply chain manager → director.
    match:
      /\bprocurement\b|\bpurchasing\b|\bbuyers?\b|\bbuying\b|\bsourcing (?:analyst|specialist|manager|lead|officer)\b|\bcategory (?:manager|specialist|lead|analyst|executive)\b|\bsupply chain\b|\bvendor manage\w*\b|\bsupplier (?:manager|relationship|quality)\b|\bpurchase officer\b|\bexpeditor\b|\b(?:demand|supply|inventory|materials?|merchandise) planner\b|\binventory (?:analyst|controller|manager)\b|\bchief procurement officer\b/,
    skills: ["Procurement & Supply"],
    exclude:
      /\bteach\w*\b|\blecturer\b|\bmedia buyer\b|\bsoftware asset\b|\bsales\b|\baccount manager\b|\blawyer\b|\bsolicitor\b|\bnurse\b|\bdriver\b|\bmarketing\b/,
    tracks: [
      {
        id: "buying",
        label: "Buying & category",
        // A retailer's category manager buys a range; a procurement category
        // manager buys the company's own spend.
        match:
          /\bbuyers?\b|\bbuying\b|\bmerchandise planner\b|(?<!procurement )\bcategory (?:manager|executive|analyst|specialist)\b/,
      },
      {
        id: "supply-chain",
        label: "Supply chain & planning",
        match: /\bsupply chain\b|\bplanner\b|\binventory\b|\bexpeditor\b/,
      },
    ],
    rungs: [
      [/\bassistant buyer\b/, 1],
      [/\bsenior buyer\b/, 3],
      [/\bbuyer\b|\bplanner\b/, 2],
    ],
  },
  {
    id: "commercial",
    label: "Commercial & contracts",
    // Construction and infrastructure's commercial ladder. Contract
    // administrator → senior CA → contracts / commercial manager → commercial
    // director; quantity surveying: cadet → QS → senior QS → commercial
    // manager, with estimators beside them. After finance and legal, so a
    // "Commercial Finance Manager" and a commercial lawyer go there.
    match:
      /\bcontracts? (?:administrator|administration|manager|officer|specialist|advis[oe]r|lead|engineer|coordinator|analyst)\b|\bquantity surveyor\b|\bquantity surveying (?:manager|lead|director)\b|\bestimator\b|\bcost (?:manager|planner|estimator|engineer)\b|\bcommercial (?:manager|director|analyst|business partner|lead|advis[oe]r|specialist|officer|coordinator|executive)\b|\bhead of commercial\b/,
    skills: [],
    exclude:
      /\bcommercial (?:cleaning|cleaner|electrician|kitchen|property|real estate|lending|banking|pilot|diver|driver|painter|plumber|litigation|lawyer)\b|\bsales\b|\baccount manager\b|\bnurse\b/,
    tracks: [
      {
        id: "quantity-surveying",
        label: "Quantity surveying & estimating",
        match:
          /\bquantity survey\w*\b|\bestimator\b|\bcost (?:manager|planner|estimator|engineer)\b/,
      },
    ],
    rungs: [
      [
        /\b(?:cadet|graduate|junior|trainee) (?:quantity surveyor|estimator|cost manager|cost planner|contracts? administrator|commercial analyst)\b/,
        1,
      ],
      [
        /\bsenior (?:contracts? administrator|quantity surveyor|estimator)\b|\bchief estimator\b/,
        3,
      ],
      [/\bcontracts? administrator\b|\bquantity surveyor\b|\bestimator\b/, 2],
    ],
  },
  {
    id: "policy",
    label: "Policy & government",
    // assistant policy officer → policy officer / adviser / analyst → senior →
    // principal → director. Ministerial and cabinet liaison sit alongside.
    // "Cabinet" alone is mostly cabinet MAKERS — a carpentry trade.
    match:
      /\bpolicy (?:officer|advis[oe]r|analyst|manager|director|lead|specialist|consultant)\b|\b(?:strategic|public|social|economic|health|education|regulatory|budget) policy\b|\bdirector,? (?:\w+ )?policy\b|\bministerial\b|\bparliamentary\b|\bcabinet (?:liaison|officer|and parliamentary)\b|\blegislation officer\b/,
    skills: ["Policy & Programs"],
    exclude:
      /\bcabinet (?:maker|installer|assembler|delivery|attendant|vision)\b|\binsurance\b|\bpolicy (?:admin\w*|servicing|processing)\b|\bsales\b|\bnurse\b|\bengineer\b/,
    rungs: [[/\bassistant policy officer\b/, 1]],
  },
  {
    id: "product",
    label: "Business analysis & product",
    // Business analysis: junior → BA → senior → lead / principal → BA
    // manager. Product: associate product manager → product owner / product
    // manager → senior → head of product → CPO. A product manager runs a
    // product, not a team, so the generic "manager" rung is wrong for them.
    match:
      /\bbusiness (?:analyst|analysis|systems analyst|process analyst)\b|\bprocess (?:analyst|architect)\b|\bsystems analyst\b|\bproduct (?:manager|owner|lead|director|analyst|management)\b|\bhead of product\b|\bchief product officer\b|\bvp (?:of )?product\b/,
    skills: ["Business Analysis", "Product Management"],
    exclude:
      /\bproduct marketing\b|\bsales\b|\bnurse\b|\bproduct (?:specialist|consultant|trainer|demonstrator|advis[oe]r)\b|\bmarketing\b/,
    tracks: [{ id: "product", label: "Product management", match: /\bproduct\b/ }],
    generic: false,
    rungs: [
      [execOnly(/\bchief product officer\b|\bcpo\b/), 6],
      [
        /\bhead of (?:product|business analysis)\b|\bdirector (?:of )?product\b|\bproduct director\b|\bvp (?:of )?product\b/,
        5,
      ],
      [
        /\b(?:senior|lead|principal|group|staff) (?:\w+ )?product (?:manager|owner)\b|\bprincipal business analyst\b|\bbusiness analyst manager\b|\bmanager business analysis\b|\bbusiness analysis manager\b/,
        4,
      ],
      [/\b(?:associate|assistant|junior) product manager\b/, 2],
      [
        /\bsenior (?:\w+ ){0,2}(?:business|systems|process) analyst\b|\blead (?:\w+ )?business analyst\b|\bproduct (?:manager|owner|lead)\b|\bprocess architect\b/,
        3,
      ],
      [
        /\b(?:junior|graduate|trainee|intern) (?:\w+ )?(?:business|systems) analyst\b|\bbusiness analyst graduate\b/,
        1,
      ],
      [
        /\b(?:associate|assistant|junior) product manager\b|\bproduct analyst\b|\b(?:business|systems|process|business systems|technical business) analyst\b/,
        2,
      ],
    ],
  },
  {
    id: "data",
    label: "Data & AI",
    // analyst → senior → lead → analytics manager → head of data → CDO.
    // Data science and ML/AI engineering, and data engineering, are tracks
    // running the same bands; staff / principal is the senior IC rung.
    match:
      /\bdata (?:\w+ )?analyst\b|\bdata (?:scientist|engineer|architect|analytics|science|engineering|governance|platform|visuali[sz]ation|modeller|steward|quality)\b|\banalytics\b|\bbusiness intelligence\b|\bbi (?:developer|analyst|specialist|lead|engineer)\b|\bpower bi\b|\bmachine learning\b|\bml (?:engineer|scientist|ops)\b|\bai (?:engineer|architect|specialist|lead|scientist|ml engineer|solutions|governance|enablement)\b|\bgen(?:erative)? ai\b|\bapplied ai\b|\binsights? (?:analyst|manager|lead)\b|\breporting analyst\b|\bquantitative analyst\b|\bstatistician\b|\bchief data officer\b|\bhead of (?:data|ai|analytics)\b/,
    skills: ["Data Analytics", "Data Science & Machine Learning", "Data Engineering"],
    exclude:
      /\bdata entry\b|\bsales\b|\bnurse\b|\brecruit|\bmarketing\b|\bproduct (?:manager|owner)\b|\btrainer\b|\blecturer\b|\bprofessor\b|\bteach\w*\b/,
    tracks: [
      {
        id: "science",
        label: "Data science & AI",
        match: /\bscientist\b|\bmachine learning\b|\bml\b|\bai\b|\bstatistic|\bquantitative\b/,
      },
      {
        id: "engineering",
        label: "Data engineering",
        match: /\bdata (?:engineer|architect|platform|engineering|modeller)\b/,
      },
    ],
    rungs: [
      [/\bstaff (?:\w+ ){0,2}engineer\b|\bprincipal\b|\barchitect\b/, 4],
      [/\b(?:associate|junior|graduate) data scientist\b/, 1],
    ],
  },
  {
    id: "technology",
    label: "IT & infrastructure",
    // Service desk → IT support engineer → systems / network / cloud engineer
    // → senior → architect / IT manager → head of IT → CIO. Cyber security
    // and enterprise applications (SAP, Salesforce, ServiceNow) are tracks.
    // After software, which keeps developers, DevOps and SRE.
    match:
      /\bnetwork (?:engineer|administrator|analyst|architect|technician|specialist|manager|security)\b|\bsystems? (?:administrator|engineer|architect)\b|\bservice desk\b|\bhelp ?desk\b|\bit (?:support|manager|director|engineer|technician|officer|specialist|analyst|operations|infrastructure|security|service)\b|\bict (?:support|technician|officer|manager|specialist|engineer)\b|\bdesktop support\b|\beuc\b|\binfrastructure (?:engineer|architect|manager|lead|specialist|analyst)\b|\bcloud (?:engineer|architect|consultant|lead|specialist|operations|infrastructure|systems)\b|\bdatabase administrator\b|\bdba\b|\b(?:solutions?|enterprise|technical|domain|security|integration|cloud|application|servicenow|salesforce|hpc and storage) architect\b|\bcyber\w*\b|\binformation security\b|\bsecurity (?:engineer|analyst|architect|operations|specialist|consultant)\b|\bsoc analyst\b|\bincident responder\b|\bpenetration tester\b|\bidentity (?:and access|governance)\b|\biam\b|\bsap\b|\bservicenow\b|\bsalesforce (?:administrator|consultant|architect|analyst|developer)\b|\bdynamics 365\b|\berp\b|\b(?:sharepoint|m365|citrix|vmware|linux|windows|oracle|applications?) (?:administrator|engineer|consultant)\b|\bchief information (?:security )?officer\b|\bcio\b|\bciso\b|\bhead of (?:it|technology|cyber|information security|infrastructure)\b/,
    skills: ["IT & Systems", "Cybersecurity", "Cloud & DevOps"],
    exclude:
      /\bsales\b|\baccount (?:manager|executive)\b|\brecruit|\bnurse\b|\bteacher\b|\bdata (?:engineer|scientist|analyst|architect)\b|\blandscape architect\b|\bbuilding\b|\bpresales\b|\bpayroll\b|\bpower systems?\b|\bwater\b|\bcivil\b|\bstructural\b|\bmechanical\b|\bsubstation\b|\bprotection\b|\brail\b|\blecturer\b|\bprofessor\b|\bteach\w*\b/,
    tracks: [
      {
        id: "security",
        label: "Cyber security",
        match:
          /\bcyber|\bsecurity\b|\biam\b|\bidentity\b|\bsoc\b|\bincident respon|\bpenetration\b|\bciso\b/,
      },
      { id: "architecture", label: "Architecture", match: /\barchitect\b/ },
      {
        id: "enterprise-apps",
        label: "Enterprise applications",
        match:
          /\bsap\b|\bservicenow\b|\bsalesforce\b|\bdynamics 365\b|\berp\b|\boracle\b(?! (?:database|dba))/,
      },
      {
        id: "support",
        label: "Service desk & support",
        match:
          /\bservice desk\b|\bhelp ?desk\b|\bit support\b|\bict support\b|\bdesktop support\b|\beuc\b|\btechnician\b/,
      },
    ],
    rungs: [
      [/\barchitect\b/, 4],
      // An IT administrator is a practitioner, so a senior one is rung 3 — the
      // generic rubric reads "senior … administrator" as a senior SUPPORT role.
      [/\bsenior (?:\w+ ){0,2}administrator\b/, 3],
      [
        /^(?!.*\bsenior\b).*(?:\bservice desk (?:analyst|officer|technician|agent)\b|\bhelp ?desk\b|\b(?:it|ict|euc|desktop) (?:support )?(?:technician|officer|analyst|specialist|agent)\b|\btechnician\b|\bit support$)/,
        1,
      ],
      [
        /\b(?:systems?|network|database|salesforce|servicenow|sharepoint|m365|citrix|vmware|linux|windows|oracle|applications?) administrator\b|\bdba\b/,
        2,
      ],
    ],
  },
  {
    id: "property",
    label: "Property & real estate",
    // Property management: assistant → property manager → senior → portfolio
    // manager. Valuation: graduate → valuer → senior → director. Agency:
    // sales agent → senior → principal. After legal and banking, so a real
    // estate LAWYER or a bank's property RM goes there.
    match:
      /\bproperty (?:manager|management|officer|executive|administrator|analyst|consultant|valuer|coordinator|associate|director|portfolio)\b|\breal estate (?:agent|sales|manager|investment|associate|analyst|advisory|valuations?)\b|\bvaluers?\b|\bleasing (?:manager|executive|consultant|agent|administrator)\b|\bstrata (?:manager|community manager)\b|\bbody corporate manager\b/,
    skills: ["Real Estate & Property"],
    exclude:
      /\bbusiness valuation\b|\bm and a\b|\bdeals\b|\bcorporate finance\b|\bsales engineer\b|\bnurse\b|\bfacilities\b|\b(?:multi|dual|bi|complex) ?property\b/,
    tracks: [
      { id: "valuation", label: "Valuation", match: /\bvalu/ },
      { id: "agency", label: "Sales & leasing agency", match: /\bagent\b|\bsales\b|\bleasing\b/ },
    ],
    rungs: [
      [
        /\bassistant property manager\b|\bgraduate valuer\b|\bproperty (?:administrator|assistant)\b/,
        1,
      ],
      [/\bsenior (?:\w+ )?(?:property manager|valuer)\b/, 3],
      [
        /\b(?:residential |commercial |regional )?property manager\b|\bvaluer\b|\breal estate (?:agent|sales)\b|\bleasing (?:executive|consultant|agent)\b|\bstrata (?:manager|community manager)\b/,
        2,
      ],
    ],
  },
  {
    id: "library",
    label: "Library, records & information",
    // library assistant / technician → library officer / librarian → senior
    // → team leader → library manager. Records and document control run
    // alongside: officer → senior → records manager.
    match:
      /\blibrar(?:y|ian)\b|\brecords? (?:officer|manager|management|coordinator|clerk|advis[oe]r|specialist)\b|\binformation management\b|\barchivists?\b|\bdocument control(?:ler)?\b/,
    skills: ["Library & Information"],
    exclude:
      /\bteacher\b(?! librarian)|\bbim\b|\bfurniture\b|\bmedical records? (?:clerk)\b|\bsales\b|\bnurse\b|\bsoftware\b|\bdeveloper\b/,
    tracks: [
      {
        id: "records",
        label: "Records & document control",
        match: /\brecords?\b|\binformation management\b|\barchivist\b|\bdocument control/,
      },
    ],
    rungs: [
      [/\blibrary (?:technician|assistant)\b/, 1],
      [/\bsenior (?:\w+ )?(?:librarian|archivist)\b/, 3],
      [/\blibrarian\b|\barchivist\b|\bdocument controller\b/, 2],
    ],
  },
  {
    id: "creative",
    label: "Design, media & creative",
    // junior → designer / writer / journalist / photographer → senior → lead /
    // design manager → creative director. Performers are placed only as
    // practitioners: an artiste's career is not a ladder of titles.
    match:
      /\b(?:graphic|interior|web|ux|ui|product|visual|fashion|motion|creative|digital|packaging|brand|instructional)? ?designer\b|\bgraphic artist\b|\bart director\b|\bcreative director\b|\bhead of design\b|\b(?:graphic|creative|brand|digital|ux|ui|product|visual|interior|fashion|packaging) design (?:manager|lead|director)\b|\bjournalist\b|\bwriter\b|\beditor\b|\bphotographer\b|\bvideographer\b|\banimator\b|\bperformers?\b|\bperforming artiste?\b|\bartiste\b|\bdancers?\b|\bsinger\b|\bactor\b|\bmusician\b|\bstage manager\b|\bartistic director\b|\bpresenter\b/,
    skills: ["Design", "Journalism & Media", "Creative & Performing Arts"],
    // Architectural designers and drafters are the built environment's; an
    // instructional designer is L&D; a "frequent presenter" is an ED patient.
    exclude:
      /\b(?:civil|electrical|mechanical|structural|piping|hydraulic|instrumentation|process|pipeline|substation|rail|road|drainage|hvac|fire|building services|bim|cad|lighting|landscape) designer\b|\barchitectur\w*\b|\bdraft(?:er|sperson)\b|\bengineer\b|\bsoftware\b|\bdeveloper\b|\binstructional\b|\bsimulated patient\b|\bpatient\b|\bsales\b|\bnurse\b|\bteacher\b|\binstructor\b|\bcoordinator\b|\bproduct designer\b.*\bengineer/,
    tracks: [
      {
        id: "media",
        label: "Writing & media",
        match: /\bjournalist\b|\bwriter\b|\beditor\b|\bproducer\b|\bpresenter\b/,
      },
      {
        id: "performing",
        label: "Performing arts & photography",
        match:
          /\bperform|\bartiste\b|\bdancer|\bsinger\b|\bactor\b|\bmusician\b|\bphotographer\b|\bvideographer\b|\bstage manager\b|\bartistic director\b/,
      },
    ],
    generic: false,
    rungs: [
      [
        /\bcreative director\b|\bartistic director\b|\bhead of (?:design|creative|content|editorial)\b|\beditor in chief\b|\bdesign director\b/,
        5,
      ],
      [
        /\bdesign (?:manager|lead)\b|\bart director\b|\bmanaging editor\b|\bprincipal (?:\w+ )?(?:designer|writer)\b|\bmanager\b/,
        4,
      ],
      [/\bsenior\b|\blead\b/, 3],
      [/\b(?:junior|graduate|trainee|intern|assistant)\b/, 1],
      [
        /\bdesigner\b|\bgraphic artist\b|\bwriter\b|\bjournalist\b|\beditor\b|\bphotographer\b|\bvideographer\b|\banimator\b|\bperformers?\b|\bperforming artiste?\b|\bartiste\b|\bdancers?\b|\bsinger\b|\bactor\b|\bmusician\b|\bstage manager\b|\bpresenter\b/,
        2,
      ],
    ],
  },
  {
    id: "medical",
    label: "Medical practitioners",
    // intern → resident (RMO) → registrar / career medical officer → specialist
    // (staff specialist, consultant, VMO, GP) → senior staff specialist /
    // director → executive director of medical services.
    //
    // "Registrar" is a court and a university officer too; "surgeon" is also
    // an arborist; a US physician ASSISTANT is its own licence.
    match:
      /\bmedical officer\b|\bresident medical\b|\brmo\b|\bregistrar\b|\bstaff specialist\b|\bphysicians?\b|\bpsychiatrist\b|\bsurgeon\b|\banaesthetist\b|\banesthesiologist\b|\bgeneral practitioner\b|\bgp\b|\bmedical practitioner\b|\bdoctors?\b|\bobstetrician\b|\bp(?:a)?ediatrician\b|\b(?:cardio|dermato|endocrino|gastroentero|haemato|hemato|nephro|neuro|onco|ophthalmo|patho|radio|rheumato|uro|gynaeco|gyneco)logist\b|\bintensivist\b|\bhospitalist\b|\bmedical (?:director|services|intern)\b|\bcmo\b.*\b(?:hospital|icu|ed|emergency|intensive care|medical|psychiatry)\b|\bbasic physician trainee\b/,
    skills: ["Medical Practice"],
    exclude:
      /\bspeech (?:language )?patholog\w*\b|\bpathologists? assistant\b|\bdeputy registrar\b|\bphysician (?:assistant|associate)\b|\btree surgeon\b|\bjudicial\b|\bacademic registrar\b|\bcourt\b|\bregistrar of\b|\bbusiness names\b|\bland registrar\b|\bsales\b|\brecruit|\bnurse\b|\bdental\b|\boral surgeon\b|\bveterinar|\bpractice manager\b|\breceptionist\b|\bschool\b|\blecturer\b|\bprofessor\b/,
    generic: false,
    rungs: [
      [/\bdeputy chief\b/, 5],
      [
        /\bexecutive director (?:of )?medical services\b|\bchief medical officer\b(?!.*\b(?:hospital|icu|ed)\b)/,
        6,
      ],
      [/\bdirector\b|\bsenior staff specialist\b|\bhead of (?:department|unit)\b/, 5],
      [
        /\b(?:basic|advanced) (?:physician )?trainee\b|\btrainee registrar\b|\bregistrar trainee\b/,
        3,
      ],
      [/\bintern\b|\bmedical student\b|\bpgy ?1\b/, 1],
      [
        /\bregistrar\b|\bcareer medical officer\b|\bcmo\b|\bsenior (?:hospital|house) officer\b|\bfellow\b|\bprincipal house officer\b|\bpho\b/,
        3,
      ],
      [
        /\bstaff specialist\b|\bconsultant\b|\bvisiting medical officer\b|\bvmo\b|\bgeneral practitioner\b|\bgp\b|\bphysicians?\b|\bpsychiatrist\b|\bsurgeon\b|\banaesthetist\b|\banesthesiologist\b|\bspecialist\b|\b(?:cardio|dermato|endocrino|gastroentero|haemato|hemato|nephro|neuro|onco|ophthalmo|patho|radio|rheumato|uro|gynaeco|gyneco)logist\b|\bobstetrician\b|\bp(?:a)?ediatrician\b|\bintensivist\b|\bhospitalist\b|\bsenior medical officer\b/,
        4,
      ],
      [
        /\bresident\b|\brmo\b|\bhouse (?:officer|medical officer)\b|\bjunior medical officer\b|\bmedical officer\b|\bmedical practitioner\b|\bdoctors?\b/,
        2,
      ],
    ],
  },
  {
    id: "allied",
    label: "Allied health, pharmacy & diagnostics",
    // assistant → clinician (grade 1–2) → senior → team leader / chief →
    // manager → director. Pharmacy: assistant / intern → pharmacist → senior
    // → pharmacist in charge → director. Imaging and pathology run the same
    // bands, collectors and assistants at the bottom.
    match:
      /\boccupational therap\w*\b|\bphysio\w*\b|\bphysical therap\w*\b|\bspeech (?:language )?(?:patholog\w*|therap\w*)\b|\bdietitians?\b|\bdieticians?\b|\bnutritionist\b|\bpodiatrist\b|\bexercise physiologist\b|\baudiologist\b|\borthoptist\b|\bprosthetist\b|\borthotist\b|\bsonographer\b|\bradiograph\w*\b|\bmedical imaging\b|\bimaging technologist\b|\bnuclear medicine\b|\bradiation therap\w*\b|\bradiologic\w* technologist\b|\bpharmac(?:ist|y)\b|\bphlebotom\w*\b|\bpathology (?:collector|assistant|technician|specimen collector)\b|\bspecimen collector\b|\bmedical laborator\w*\b|\bmedical scientist\b|\ballied health\b|\btherapy assistant\b|\bchiropractor\b|\bosteopath\b|\bmassage therapist\b|\bsupervising scientist\b/,
    skills: ["Allied Health", "Pharmacy", "Medical Imaging & Pathology", "Radiation Safety"],
    exclude:
      /\blecturer\b|\bprofessor\b|\bteach\w*\b|\bsales\b|\bengineer\b|\bsoftware\b|\bdental\b|\bveterinar\w*\b|\bnurse\b|\bdeveloper\b|\brecruit/,
    tracks: [
      { id: "pharmacy", label: "Pharmacy", match: /\bpharmac/ },
      {
        id: "imaging",
        label: "Medical imaging & radiation therapy",
        match:
          /\bradiograph|\bimaging\b|\bsonograph|\bnuclear medicine\b|\bradiation therap|\bradiologic|\bmri\b|\bx ?ray\b/,
      },
      {
        id: "pathology",
        label: "Pathology & laboratory medicine",
        match:
          /\bphlebotom|(?<!speech |speech language )\bpathology\b|\bmedical laborator|\bmedical scientist\b|\bspecimen\b|\bsupervising scientist\b/,
      },
    ],
    generic: false,
    rungs: [
      [DEPUTY, 4],
      [/\bdirector\b|\bhead of\b/, 5],
      [
        /\bmanager\b|\bpharmacist in charge\b|\bchief (?:pharmacist|radiographer|physiotherapist|occupational therapist|dietitian|scientist)\b|\bsupervising scientist\b/,
        4,
      ],
      [/\bsenior\b|\bteam lead(?:er)?\b|\bclinical specialist\b|\badvanced\b|\blead\b/, 3],
      [
        /\bassistants?\b|\btechnicians?\b|\bphlebotom\w*\b|\bcollector\b|\bintern\b|\bstudent\b|\bgraduate\b|\baide\b|\btrainee\b/,
        1,
      ],
      [
        /\boccupational therapist\b|\bphysio\w*\b|\bphysical therapist\b|\bspeech (?:language )?(?:pathologist|therapist)\b|\bdietitian\b|\bdietician\b|\bnutritionist\b|\bpodiatrist\b|\bexercise physiologist\b|\baudiologist\b|\borthoptist\b|\bprosthetist\b|\borthotist\b|\bsonographer\b|\bradiographer\b|\bimaging technologist\b|\bradiation therapist\b|\bradiologic\w* technologist\b|\bpharmacist\b|\bmedical (?:laboratory )?scientist\b|\bchiropractor\b|\bosteopath\b|\bmassage therapist\b|\btherapist\b|\btechnologist\b|\beducator\b/,
        2,
      ],
    ],
  },
  {
    id: "dental",
    label: "Dental",
    // dental assistant → hygienist / oral health therapist → dentist →
    // senior dentist / specialist → clinical director.
    match:
      /\bdental\b|\bdentists?\b|\bdentistry\b|\boral (?:health|surgeon)\b|\borthodontist\b|\bendodontist\b|\bperiodontist\b|\bprosthodontist\b|\bchirurgien dentiste\b/,
    skills: ["Dental"],
    // A dental receptionist or practice manager is admin; dental schools are
    // academia.
    exclude:
      /\blecturer\b|\bacademics?\b|\bprofessor\b|\bsales\b|\breceptionist\b|\bpractice manager\b|\binsurance\b|\boperations manager\b/,
    generic: false,
    rungs: [
      [/\bhead of dentistry\b|\bclinical director\b|\bdirector\b/, 5],
      [
        /\bsenior dentist\b|\bprincipal dentist\b|\borthodontist\b|\boral surgeon\b|\bendodontist\b|\bperiodontist\b|\bprosthodontist\b/,
        4,
      ],
      [/\bdentists?\b|\bdental officer\b|\bchirurgien dentiste\b/, 3],
      [
        /\bsenior dental assistant\b|\bhygienist\b|\boral health therapist\b|\bdental therapist\b|\bdental prosthetist\b|\bdental technician\b|\bdental resident\b/,
        2,
      ],
      [/\bdental (?:assistant|nurse|surgery assistant)\b|\btrainee\b|\bsterilising\b/, 1],
    ],
  },
  {
    id: "care",
    label: "Care, social work & mental health",
    // Aged and disability care: care worker → senior carer / team leader →
    // care coordinator → facility / service manager → regional manager.
    // Social work: social worker / case manager / youth worker → senior →
    // team leader → manager. Mental health: counsellor / psychologist /
    // clinician → senior → principal → manager.
    //
    // A CASE MANAGER holds a caseload, not a team: the practitioner rung, the
    // way a project manager is not a people manager.
    match:
      /\bpersonal care (?:worker|assistant|attendant|aide)\b|\bpersonal carers?\b|\bcarers?\b|\bcare (?:worker|partner|assistant|attendant|coordinator|manager|team leader|supervisor)\b|\bsupport worker\b|\bdisability (?:support|advis[oe]r|services|supporter)\b|\bhome care\b|\bcommunity care\b|\baged care (?:worker|assistant|manager)\b|\bresidential (?:care|services manager|manager)\b|\bsocial work(?:er|ers)?\b|\bcase ?(?:manager|worker|management)\b|\bcaseworker\b|\byouth workers?\b|\bhousing officer\b|\bchild protection\b|\bchild safety (?:officer|practitioner|support officer)\b|\bfamily (?:support|violence) (?:worker|practitioner)\b|\bwelfare officer\b|\bpsycholog(?:ist|y officer)\b|\bneuropsychologist\b|\bcounsell?ors?\b|\bmental health (?:clinician|worker|therapist|counsell?or|practitioner|support worker)\b|\bmarriage and family therapist\b|\blicensed (?:clinical|professional|mental health|marriage|independent clinical)\b|\blcsw\b|\blifestyle (?:coordinator|assistant)\b|\bdiversional therap\w*\b/,
    skills: [
      "Aged & Disability Care",
      "Social & Community Services",
      "Mental Health & Counselling",
    ],
    // Other people's "case managers" and "counsellors": insurance claims,
    // superannuation, money; cleaners and cooks in aged care are their own
    // ladders; nurses are nursing's.
    exclude:
      /\bchild ?care\b|\bteach\w*\b|\bcleaner\b|\bcleaning\b|\bcook\b|\bchef\b|\bkitchen\b|\bcall centre\b|\bcustomer (?:support|care)\b|\brostering\b|\bworkers compensation\b|\binjury management\b|\bsuperannuation\b|\binvestigations\b|\bclaims\b|\bfinancial counsell?or\b|\bgenetic counsell?or\b|\bnurse\b|\brn\b|\blpn\b|\binsurance\b|\bsales\b|\blecturer\b|\bprofessor\b|\bhead of school\b|\bdisaster recovery\b|\bhealth care worker\b/,
    tracks: [
      {
        id: "social-work",
        label: "Social work & case management",
        match:
          /\bsocial work|\bcase ?(?:manager|worker|management)\b|\bcaseworker\b|\byouth worker|\bhousing officer\b|\bchild (?:protection|safety)\b|\bfamily (?:support|violence)\b|\bwelfare\b/,
      },
      {
        id: "mental-health",
        label: "Mental health & counselling",
        match:
          /psycholog|\bcounsell?or|\bmental health\b|\btherapist\b|\blcsw\b|\blicensed (?:clinical|professional|mental health|marriage|independent clinical)\b/,
      },
    ],
    generic: false,
    rungs: [
      [/\bhead of\b|\bdirector\b|\b(?:area|regional|state|general|operations) manager\b/, 5],
      [/(?<!\bcase )\bmanager\b/, 4],
      [
        /\bsenior (?:personal |residential |disability |home |community |aged )?(?:care ?(?:worker|carer|assistant|partner)|carer|support worker)\b|\bsenior (?:personal )?carer\b/,
        2,
      ],
      [/\bsenior\b|\bteam lead(?:er)?\b|\bcoordinator\b|\bsupervisor\b|\bprincipal\b/, 3],
      [
        /\b(?:personal care|care|support|home care|community care|disability support|aged care|residential care|therapeutic (?:residential )?care|lifestyle) (?:worker|assistant|attendant|aide|partner)\b|\bpersonal carers?\b|\bcarers?\b|\btrainee\b|\bstudent\b|\bprovisional psychologist\b|\bdisability supporter\b/,
        1,
      ],
      [
        /\bsocial workers?\b|\bcase ?(?:manager|worker)\b|\bcaseworker\b|\byouth workers?\b|\bpsychologist\b|\bneuropsychologist\b|\bcounsell?ors?\b|\bclinician\b|\btherapist\b|\bpractitioner\b|\bofficer\b|\badvis[oe]r\b|\bspecialist\b|\blicensed\b|\blcsw\b/,
        2,
      ],
    ],
  },
  {
    id: "emergency",
    label: "Emergency services, security & justice",
    // Security: officer → senior → supervisor → security manager. Paramedics
    // and site emergency-services officers: paramedic → intensive care /
    // team leader → manager. Policing: officer → senior constable / sergeant
    // → inspector → superintendent. Justice: correctional / youth justice /
    // court officer → senior → supervisor → manager → director.
    //
    // "Security clearance required" names a clearance, not a guard's job.
    match:
      /\bsecurity (?:officers?|guards?|supervisor|manager|consultant|patrol|controller|screening officer|screener|team leader)\b|\bguards?\b|\bcrowd controller\b|\bparamedic\w*\b|\bemergency (?:services? officer|medical technician|response officer|management officer|communicator)\b|\bemt\b|\bmedic\b|\bfire ?fighter\b|\bpolice\b|\bconstable\b|\bsergeant\b|\bcorrection(?:al|s)\b|\bcustodial\b|\byouth justice\b|\bjustice officer\b|\bcourt services\b|\bbailiff\b|\bsheriff\b|\bprobation\b|\bparole\b|\bprison\b|\blife ?guard\b|\bmesso\b/,
    skills: ["Emergency & Public Safety", "Corrections & Justice"],
    exclude:
      /\badministrat\w*\b|\badmin\b|\bclerk\b|\bfront desk\b|\bcyber\b|\bclearance\b|\bnv[12]\b|\bbaseline\b|\bvetting\b|\bmedical staff associate\b|\blpn\b|\blvn\b|\bnurse\b|\bsoftware\b|\bengineer\b|\bsocial security\b|\b(?:information|network) security\b|\bsecurity (?:analyst|architect|engineer|specialist)\b|\bdata security\b|\bred team\b|\blecturer\b|\bteach\w*\b|\bcleaner\b|\bwelder\b|\bspray painter\b|\bguardian\b|\bparole board\b/,
    tracks: [
      { id: "security", label: "Security", match: /\bsecurity\b|\bguards?\b|\bcrowd controller\b/ },
      {
        id: "policing",
        label: "Policing",
        match: /\bpolice\b|\bconstable\b|\bsergeant\b|\bsheriff\b/,
      },
      {
        id: "justice",
        label: "Corrections & justice",
        match:
          /\bcorrection|\bcustodial\b|\byouth justice\b|\bjustice officer\b|\bcourt services\b|\bbailiff\b|\bprobation\b|\bparole\b|\bprison\b/,
      },
    ],
    generic: false,
    rungs: [
      [
        /\bcommander\b|\bdirector\b|\bhead of\b|\bgeneral manager\b|\bassistant commissioner\b|\bsuperintendent\b(?=.*\b(?:correctional|prison|police)\b)(?!.*\bassistant superintendent\b)/,
        5,
      ],
      [
        /\bmanager\b|\binspector\b|\bsenior sergeant\b|\bassistant superintendent\b|\bsuperintendent\b|\bstation officer\b/,
        4,
      ],
      [/\bsenior security (?:officer|guard)\b/, 2],
      [
        /\bsupervisor\b|\bteam leader\b|\bsergeant\b|\bsenior\b|\b(?:intensive|critical|advanced) care paramedic\b/,
        3,
      ],
      [
        /\btrainee\b|\brecruits?\b(?! incentive)|\bsecurity (?:officer|guard)s?\b|\bguards?\b|\bcrowd controller\b|\bemt\b|\bemergency medical technician\b|\blife ?guard\b|\bstudent\b|\bgraduate paramedic\b|\bauxiliary\b/,
        1,
      ],
      [
        /\bparamedic\b|\bofficer\b|\bconstable\b|\bmedic\b|\bfire ?fighter\b|\bworker\b|\bpractitioner\b|\bbailiff\b|\bsheriff\b|\bcommunicator\b/,
        2,
      ],
    ],
  },
  {
    id: "science",
    label: "Science, research & environment",
    // Laboratory: assistant / technician → scientist / chemist / analyst →
    // senior → laboratory manager. Research: research assistant → postdoc /
    // research fellow → senior research fellow → principal research fellow.
    // Veterinary: vet nurse → veterinarian → senior. Environmental: officer /
    // scientist → senior → environmental manager.
    //
    // After data (data scientists are data's) and allied health (medical
    // laboratory scientists are pathology's). Geoscience is the mining
    // family's, and "Chemist Warehouse" is a pharmacy chain.
    match:
      /\blaborator(?:y|ies)\b|\blab (?:technician|assistant|manager|analyst|supervisor|coordinator|attendant)\b|\bscientists?\b|\bchemists?\b|\bmicrobiologist\b|\bbiologist\b|\becologist\b|\bhydrologist\b|\bresearch (?:fellow|associate|assistant|officer|scientist|technician)\b|\bpost ?doc\w*\b|\bpostdoctoral\b|\bveterinar\w*\b|\bvet (?:nurse|technician|assistant)\b|\benvironmental (?:scientist|advis[oe]r|officer|consultant|specialist|manager|coordinator|superintendent|lead|approvals|compliance)\b|\bclinical research (?:associate|coordinator|manager)\b|\bclinical trials? (?:coordinator|manager|associate|assistant)\b/,
    skills: ["Science & Laboratory", "Environmental"],
    exclude:
      /\bdata scientists?\b|\bdecision scientist\b|\bchemist warehouse\b|\bcwh\b|\bgeolog\w*\b|\bgeochem\w*\b|\bgeophysic\w*\b|\bhydrogeolog\w*\b|\bpharmacist\b|\bsales\b|\bsoftware\b|\bteach\w*\b|\blecturer\b|\bprofessor\b|\b(?:registered|enrolled|clinical) nurse\b|\bmetallurg\w*\b|\bmedical (?:laboratory )?scientist\b/,
    tracks: [
      { id: "veterinary", label: "Veterinary", match: /\bveterinar|\bvet\b/ },
      {
        id: "environmental",
        label: "Environmental",
        match: /\benvironmental\b|\becolog|\bhydrolog|\bcontaminat|\bbiodiversity\b/,
      },
      {
        id: "research",
        label: "Research",
        // A clinical research associate monitors drug trials — industry, not
        // the academic research ladder.
        match:
          /(?<!clinical )\bresearch (?:fellow|associate|assistant|officer)\b|\bpost ?doc|\bpostdoctoral\b/,
      },
    ],
    rungs: [
      [/\bprincipal\b|\blab(?:oratory)? manager\b/, 4],
      [/\bsenior\b|\blead\b|\bsupervisor\b/, 3],
      [
        /\bresearch assistant\b|\blab(?:oratory)? (?:assistant|technician|attendant|worker|technicians)\b|\btechnician\b|\bvet(?:erinary)? (?:nurse|assistant)\b|\bgraduate\b|\bintern\b/,
        1,
      ],
      [
        /\bresearch (?:fellow|associate|officer|scientist)\b|\bpost ?doc\w*\b|\bpostdoctoral\b|\bscientists?\b|\bchemists?\b|\bmicrobiologist\b|\bbiologist\b|\becologist\b|\bhydrologist\b|\bveterinarian\b|\bclinical research associate\b/,
        2,
      ],
    ],
  },
  {
    id: "engineering",
    label: "Engineering",
    // undergraduate / graduate → engineer → senior → lead → principal /
    // engineering manager → technical or engineering director. Disciplines
    // are tracks. Project and site engineers are here: project management
    // excludes them on purpose.
    //
    // After software, data, IT, quality, HSE and commercial, which keep their
    // own engineers (software, data, network, QA, safety, cost). A bare
    // "Engineering Manager" names no discipline and stays unplaced unless the
    // employer says software (see software's employerMatch).
    match:
      /\bengineers?\b|\b(?:civil|structural|electrical|mechanical|process|chemical|mining|mine|geotechnical|project|site|maintenance|reliability|asset|design|production|instrumentation|controls?|automation|pipelines?|subsea|piping|water|transport|rail|substation|hv|building services|hydraulic|fire|drilling|reservoir|petroleum|metallurgical|marine|aerospace|avionics|commissioning|facilities|plant|manufacturing|industrial) engineering (?:manager|director|lead|superintendent|technician|graduate|intern)\b|\btechnical director\b.*\bengineering\b|\bchief engineer\b|\bmetallurgists?\b/,
    skills: [
      "Civil Engineering",
      "Electrical Engineering",
      "Mechanical Engineering",
      "Process Engineering",
      "Mining Engineering",
      "Pipeline Engineering",
      "Geotechnical",
      "Instrumentation & Control",
      "Automation & Robotics",
      "Metallurgy",
    ],
    // Presales and service engineers are other ladders; an aircraft
    // maintenance engineer holds a trade licence; test automation is
    // software testing.
    exclude:
      /\bsales\b|\bpre ?sales\b|\bsolutions? engineer\b|\bcustomer engineer\b|\bsupport engineer\b|\bfield service engineer\b|\bservice engineer\b|\bsoftware\b|\bdata\b|\bcloud\b|\bnetwork\b|\bsecurity\b|\bdevops\b|\bsite reliability\b|\bprompt\b|\bai\b|\bmachine learning\b|\bml\b|\btest (?:automation|analyst)\b|\bautomation test\b|\bqa\b|\bquality\b|\bsafety\b|\brecruit\w*\b|\bteach\w*\b|\blecturer\b|\bprofessor\b|\baircraft maintenance engineer\b|\blame\b|\bsound engineer\b|\baudio engineer\b|\bgame\b|\bfull ?stack\b|\bfront ?end\b|\bback ?end\b|\bplatform\b|\bnaval architect\b/,
    tracks: [
      {
        id: "civil",
        label: "Civil & structural",
        match:
          /\bcivil\b|\bstructural\b|\bgeotech\w*\b|\bwater\b|\bwastewater\b|\btransport\b|\btraffic\b|\broad\b|\brail\b|\bbridges?\b|\btunnel\w*\b|\bhydraulic\b|\bdams?\b|\bcoastal\b|\bpavements?\b|\bdrainage\b|\bsite engineer\b|\bresident engineer\b/,
      },
      {
        id: "electrical",
        label: "Electrical, instrumentation & controls",
        match:
          /\belectrical\b|\bhv\b|\bhigh voltage\b|\bpower\b|\bsubstation\b|\bprotection\b|\boverhead lines\b|\binstrumentation\b|\bcontrols?\b|\bautomation\b|\bscada\b|\bplc\b|\be and i\b|\bot\b/,
      },
      {
        id: "mechanical",
        label: "Mechanical & reliability",
        match: /\bmechanical\b|\bhvac\b|\bpiping\b|\breliability\b|\bmaintenance\b|\brotating\b/,
      },
      {
        id: "process",
        label: "Process, chemical & metallurgy",
        match: /\bprocess\b|\bchemical\b|\bmetallurg\w*\b|\btailings\b/,
      },
      {
        id: "mining",
        label: "Mining",
        match: /\bmining\b|\bmine\b|\bdrill and blast\b|\bblasting\b|\bventilation\b/,
      },
    ],
    generic: false,
    rungs: [
      // Deputies first: "Associate Director – Structural Engineer" also
      // contains "director", the top rung's own word.
      [DEPUTY, 4],
      [/\b(?:assistant|deputy) chief engineer\b/, 4],
      [
        /\b(?:engineering|technical) director\b|\bhead of engineering\b|\bdirector (?:of )?engineering\b|\bchief engineer\b|\bgeneral manager\b|\bdirector\b/,
        5,
      ],
      [/\bprincipal\b|\bengineering manager\b|\bmanager\b|\bsuperintendent\b|\bstaff\b/, 4],
      [/\bsenior\b|\blead\b/, 3],
      [
        /\bgraduate\b|\bundergraduate\b|\bvacation\b|\bintern\w*\b|\bcadet\b|\bstudent\b|\bjunior\b|\btrainee\b|\bapprentice\b|\bentry level\b/,
        1,
      ],
      [/\bengineers?\b|\bmetallurgists?\b|\bintermediate\b/, 2],
    ],
  },
  {
    id: "geoscience",
    label: "Geoscience & surveying",
    // geology technician → geologist → senior → principal / superintendent →
    // chief geologist. Surveying: graduate → surveyor → senior → lead.
    match:
      /\bgeolog\w*\b|\bgeoscien\w*\b|\bgeophysic\w*\b|\bgeochem\w*\b|\bhydrogeolog\w*\b|\bsurveyors?\b|\bsurveying\b|\bmine survey\b/,
    skills: ["Geology", "Surveying"],
    // A quantity surveyor is commercial; a marine or building surveyor is an
    // inspector; a survey interviewer asks questions.
    exclude:
      /\bquantity survey\w*\b|\bmarine surveyor\b|\bbuilding survey\w*\b|\bflag state\b|\binsurance\b|\bsurvey (?:interviewer|research|designer)\b|\bteach\w*\b|\blecturer\b|\bprofessor\b|\bsales\b/,
    tracks: [{ id: "surveying", label: "Surveying", match: /\bsurvey/ }],
    generic: false,
    rungs: [
      [
        /\bchief geologist\b|\bhead of\b|\bdirector\b|\bgeneral manager\b|\bexploration manager\b/,
        5,
      ],
      [/\bprincipal\b|\bsuperintendent\b|\bmanager\b/, 4],
      [/\bsenior\b|\blead\b|\bspecialist\b/, 3],
      [
        /\btechnician\b|\bgraduate\b|\bvacation\b|\bstudent\b|\bintern\b|\bundergraduate\b|\bearly career\b|\bassistant\b/,
        1,
      ],
      [
        /\bgeologists?\b|\bgeoscientist\b|\bgeophysicist\b|\bgeochemist\b|\bhydrogeologist\b|\bsurveyors?\b/,
        2,
      ],
    ],
  },
  {
    id: "architecture",
    label: "Architecture, planning & drafting",
    // graduate → architect → senior / project architect → associate /
    // principal → director. Town planning and drafting / design (drafters,
    // BIM modellers, engineering designers) run the same bands.
    match:
      /\barchitects?\b|\barchitectur\w*\b|\b(?:town|urban|strategic|statutory|land use) planners?\b|\burban design\w*\b|\bdraft(?:er|sperson|sman|ing)\b|\bbim (?:modeller|manager|coordinator|technician|lead)\b|\bcad (?:drafter|operator|technician|designer)\b|\b(?:civil|electrical|mechanical|structural|piping|hydraulic|instrumentation|process|pipeline|substation|rail|road|drainage|hvac|fire|building services|lighting|offshore pipeline) designers?\b|\bdesign drafter\b/,
    skills: ["Architecture & Planning"],
    // Enterprise, solution and business architects are IT's; a naval
    // architect designs ships.
    exclude:
      /\b(?:solutions?|enterprise|technical|domain|security|integration|cloud|data|application|technology|business|software|network|infrastructure|naval|salesforce|servicenow|hpc|process|information|platform)\s+architect\w*\b|\bpractice manager\b|\blegislative\b|\bproduct architect\b|\bstrategy and architecture\b|\bclient technology engineering architecture\b|\bteach\w*\b|\blecturer\b|\bprofessor\b|\bsales\b/,
    tracks: [
      { id: "planning", label: "Town planning", match: /\bplanners?\b|\burban design/ },
      {
        id: "drafting",
        label: "Drafting & engineering design",
        match: /\bdraft|\bbim\b|\bcad\b|(?<!architectural )\bdesigners?\b/,
      },
    ],
    generic: false,
    rungs: [
      [/\bdirector\b|\bhead of\b|\bpractice (?:leader|director)\b/, 5],
      [DEPUTY, 4],
      [/\bprincipal\b|\bmanager\b|\bassociate\b(?!.*\b(?:graduate|junior)\b)/, 4],
      [/\bsenior\b|\blead\b|\bproject architect\b/, 3],
      [
        /\bgraduate\b|\bstudent\b|\bassistant\b|\bjunior\b|\bcadet\b|\btrainee\b|\bvacation\b|\bintern\b|\bundergraduate\b/,
        1,
      ],
      [
        /\barchitects?\b|\bplanners?\b|\bdraft(?:er|sperson|sman)\b|\bdesigners?\b|\bmodeller\b|\btechnologist\b|\bcoordinator\b|\btechnician\b/,
        2,
      ],
    ],
  },
  {
    id: "construction",
    label: "Construction & site management",
    // leading hand / foreman → site supervisor → site manager / construction
    // manager / design manager → construction director. A mine site's
    // superintendents are operations', not this ladder.
    match:
      /\bconstruction (?:manager|supervisor|director|coordinator|forem[ae]n|superintendent)\b|\bsite (?:manager|supervisor|forem[ae]n|coordinator)\b|\b(?:general |build |carpenter )?forem[ae]n\b|\bforeperson\b|\bleading hand\b.*\b(?:construction|civil|building)\b|\bdesign manager\b|\bbuilding (?:supervisor|site manager)\b|\b(?:civil|piping|build) superintendent\b/,
    skills: ["Construction Management"],
    exclude:
      /\b(?:graphic|creative|brand|digital|ux|ui|product|visual|interior|fashion|packaging|instructional|learning) design manager\b|\bsales\b|\bteach\w*\b|\bnurse\b|\bhospitality\b|\brestaurant\b|\bretail\b|\bcleaning\b|\bsoftware\b|\bcatering\b|\bwarehouse\b|\bgarage\b|\bfleet\b|\bdriver\b/,
    generic: false,
    rungs: [
      [DEPUTY, 4],
      [/\bdirector\b|\bhead of\b|\bgeneral manager\b/, 5],
      [
        /\bassistant (?:site|construction) manager\b|\bsupervisor\b|\bgeneral forem[ae]n\b|\bsite coordinator\b/,
        3,
      ],
      [/\bmanager\b|\bsuperintendent\b/, 4],
      [/\bleading hand\b|\bforem[ae]n\b|\bforeperson\b/, 2],
      [/\btrainee\b|\bcadet\b|\bgraduate\b/, 1],
    ],
  },
  {
    id: "trades",
    label: "Trades",
    // apprentice / trades assistant → tradesperson → leading hand / senior /
    // supervisor → superintendent → maintenance manager. Electrical,
    // mechanical and fabrication trades are tracks; the building and
    // construction trades are the generalist ladder.
    //
    // An apprentice CHEF or BAKER is on hospitality's ladder; a trade COUNTER
    // is a shop.
    match:
      /\belectricians?\b|\blinesperson\b|\bline worker\b|\bcable jointer\b|\bfitters?\b|\bfitter and turner\b|\bmachinists?\b|\bturner\b|\bboilermakers?\b|\bwelders?\b|\bwelding (?:supervisor|inspector)\b|\bfabricators?\b|\bsheet ?metal\b|\bplumbers?\b|\bplumbing\b|\bgas ?fitter\b|\bdrainer\b|\brefrigeration (?:mechanic|technician|engineer|installer)\b|\b(?:hvac|refrigeration hvac) (?:technician|tech|mechanic)\b|\bair ?conditioning (?:technician|mechanic)\b|\bcarpenters?\b|\bjoiners?\b|\bcabinet ?makers?\b|\bshopfitters?\b|\bformworkers?\b|\bmechanics?\b|\bautomotive (?:technician|mechanic|electrician|apprentice|glazier)\b|\bdiesel (?:mechanic|fitter|technician)\b|\bhd (?:fitter|mechanic)\b|\bheavy (?:diesel|duty) (?:mechanic|fitter)\b|\briggers?\b|\bscaffolders?\b|\bdogman\b|\bpainters?\b|\bblasters?\b|\bplasterers?\b|\btilers?\b|\bglaziers?\b|\bbricklayers?\b|\bconcreters?\b|\bsteel ?fixer\b|\bstonemason\b|\blabou?rers?\b|\btraffic controllers?\b|\bcivil construction apprentice\b|\broad workers?\b|\btradesperson\b|\btrades? assistant\b|\bapprentice\w*\b|\bmaintainers?\b|\bmaintenance (?:technician|planner|officer|worker|person|carpenter|plumber|electrician|fitter)\b|\be and i (?:technician|fitter|supervisor)\b|\binstrument (?:technician|fitter)\b|\belectrical (?:and instrumentation )?technician\b|\bhv (?:technician|operator)\b|\bhigh voltage (?:technician|operator)\b|\bfield service (?:technician|engineer)\b|\bservice technician\b|\blubrication technician\b|\bhandy ?(?:person|man)\b|\bcnc (?:machinist|operator)\b|\baircraft maintenance engineer\b|\bavionics technician\b|\bjourneyman\b/,
    skills: [
      "Electrical Trade",
      "Mechanical Fitting",
      "Welding & Fabrication",
      "Plumbing",
      "HVAC & Refrigeration",
      "Carpentry & Joinery",
      "Automotive Trade",
      "Heavy Diesel Maintenance",
      "Rigging & Scaffolding",
      "Painting & Plastering",
      "Bricklaying & Concreting",
      "Construction Labouring",
      "Electronics & Telecoms Trade",
      "Fixed Plant Maintenance",
    ],
    exclude:
      /\bchef\b|\bcook\b|\bbaker\b|\bbutcher\b|\bpastry\b|\bhair\w*\b|\bbeauty\b|\bbarber\b|\bflorist\b|\bsales\b|\b(?:electrical|mechanical|civil|structural|process|mining|project|site|reliability) engineer\b|\bsoftware\b|\bdeveloper\b|\bteach\w*\b|\blecturer\b|\btrainer\b|\bestimator\b|\bdesigner\b|\bdrafter\b|\btrade counter\b|\bcounter assistant\b|\beducator\b|\bpoint of sale\b|\bnurse\b|\bdental\b|\bpharmac\w*\b|\bperformance\b|\bartist\b/,
    tracks: [
      {
        id: "electrical",
        label: "Electrical",
        match:
          /\belectric|\blinesperson\b|\bline worker\b|\bcable jointer\b|\bhv\b|\bhigh voltage\b|\be and i\b|\binstrument\w*\b/,
      },
      {
        id: "mechanical",
        label: "Mechanical & automotive",
        match:
          /\bfitter|\bmachinist|\bturner\b|\bmechanic|\bdiesel\b|\bhd\b|\brefrigeration\b|\bhvac\b|\bair ?conditioning\b|\bmaintainer|\blubrication\b|\bmaintenance planner\b|\bfield service\b|\bservice technician\b|\bcnc\b|\bautomotive\b|\baircraft\b|\bavionics\b/,
      },
      {
        id: "fabrication",
        label: "Welding & fabrication",
        match: /\bboilermaker|\bwelder|\bwelding\b|\bfabricator|\bsheet ?metal\b|\bsteel ?fixer\b/,
      },
    ],
    generic: false,
    rungs: [
      [/\bhead of\b|\bdirector\b|\bgeneral manager\b/, 5],
      [/\bmanager\b|\bsuperintendent\b/, 4],
      [
        /\bsupervisor\b|\bforem[ae]n\b|\bforeperson\b|\bleading hand\b|\bteam lead(?:er)?\b|\bsenior\b|\blead\b|\bmaster\b|\bspecial class\b|\binspector\b/,
        3,
      ],
      [
        /\bapprentice\w*\b|\btrainee\w*\b|\btraineeship\b|\btrades? assistant\b|\bhelper\b|\blabou?rers?\b|\btraffic controllers?\b|\boffsider\b|\bschool based\b|\bpre ?apprentice\b|\bentry level\b|\bcivil construction apprentice\b/,
        1,
      ],
      [/\w/, 2],
    ],
  },
  {
    id: "operations",
    label: "Mining, plant & production operations",
    // Mining: trainee / offsider → plant or mining operator / shotfirer /
    // driller → senior / leading hand → shift boss / supervisor →
    // superintendent → mine manager. Production: process worker → machine
    // operator → leading hand / supervisor → production or plant manager.
    // After engineering and geoscience; before logistics, which keeps the
    // forklift and the delivery truck.
    match:
      /\b(?:excavator|dozer|loader|grader|dump truck|haul truck|water cart|roller|shovel|scraper|drill|jumbo|bogger|mobile plant|fixed plant|batch plant|power plant|crusher|process plant|plant|machine|production|process|control room|mining|underground|surface|bulldozer|backhoe|crane|reclaimer|stacker|shiploader|dragline|mill|kiln|tailings|track machine) operators?\b|\bmine ?workers?\b|\bunderground (?:miner|mining operators?)\b|\bminers?\b|\bnipper\b|\bshot ?firers?\b|\bblast (?:crew|hole|operators?)\b|\bblasting (?:technician|miner)\b|\bdrillers?\b|\bdriller'?s? offsider\b|\bdrill (?:offsider|assistant)\b|\bprocess workers?\b|\bproduction (?:workers?|supervisor|manager|superintendent|coordinator)\b|\bfactory (?:hand|worker|supervisor|manager)\b|\bmeat process\w*\b|\bplant manager\b|\bmine manager\b|\bunderground (?:mine )?manager\b|\bshift boss\b|\bmining (?:supervisor|superintendent|manager)\b|\b(?:maintenance|production|mining|underground|plant|processing) superintendent\b|\bsuperintendent (?:mining|production|maintenance|underground|plant|processing)\b|\bunderground mine superintendent\b|\bwellsite leader\b|\btoolpusher\b|\bdrilling (?:supervisor|superintendent|manager)\b/,
    skills: [
      "Plant & Equipment Operation",
      "Underground Mining",
      "Drill & Blast",
      "Drilling & Wells",
      "Manufacturing & Production",
    ],
    exclude:
      /\bengineer\b|\bgeolog\w*\b|\bsurveyor\b|\bsoftware\b|\bconsole operator\b|\bcheckout\b|\bforklift\b|\btour operator\b|\bsales\b|\bteach\w*\b|\btrainer\b|\bdriver\b|\bchef\b|\bdata\b|\bmarketing\b|\bchef fresh\b/,
    tracks: [
      {
        id: "mining",
        label: "Mining & mobile plant",
        match:
          /\bexcavator\b|\bdozer\b|\bloader\b|\bgrader\b|\bdump truck\b|\bhaul truck\b|\bmine\b|\bmining\b|\bunderground\b|\bjumbo\b|\bbogger\b|\bshot ?fir|\bblast|\bdrill|\bminers?\b|\bnipper\b|\bcrusher\b|\bshift boss\b|\bdragline\b|\bshovel\b|\bwater cart\b|\bmobile plant\b|\bwellsite\b|\btoolpusher\b/,
      },
    ],
    generic: false,
    rungs: [
      [/\bgeneral manager\b|\bhead of\b|\bdirector\b|\bmine manager\b/, 5],
      [/\bsuperintendent\b|\bmanager\b/, 4],
      [
        /\bsupervisor\b|\bshift boss\b|\bleading hand\b|\bteam lead(?:er)?\b|\bsenior\b|\bforeman\b|\bcoordinator\b|\btoolpusher\b|\bwellsite leader\b/,
        3,
      ],
      [
        /\btrainee\b|\bentry level\b|\boffsider\b|\bassistant\b|\bnipper\b|\bfactory hand\b|\bprocess workers?\b|\bproduction workers?\b|\bmeat process\w*\b|\bno experience\b/,
        1,
      ],
      [/\w/, 2],
    ],
  },
  {
    id: "facilities",
    label: "Cleaning & facilities",
    // cleaner / housekeeper / laundry → cleaner in charge / supervisor →
    // executive housekeeper / cleaning manager. Facilities: coordinator /
    // officer → facilities manager → head of facilities. 1,216 of the
    // quarter's ads are one title, "Cleaning and Trolley Collection".
    match:
      /\bcleaners?\b|\bcleaning\b|\bhousekeep\w*\b|\blaundry\b|\bjanitor\w*\b|\bcustodians?\b|\bfacilit(?:y|ies) (?:manager|officer|coordinator|supervisor|technician|assistant|lead|administrator|maintenance|management)\b|\bhead of facilities\b|\bhotel services assistant\b|\bgroundsperson\b|\bgrounds ?keeper\b/,
    skills: ["Cleaning & Facilities"],
    exclude:
      /\bdata cleaning\b|\bdry cleaning\b|\bcleaning (?:sales|chemicals?)\b|\bengineer\b|\bsales\b|\bsoftware\b|\bteach\w*\b|\bnurse\b|\bcare worker\b|\baged care facility manager\b/,
    tracks: [
      {
        id: "facilities",
        label: "Facilities management",
        match:
          /\bfacilit(?:y|ies) (?:manager|officer|coordinator|supervisor|technician|assistant|lead|administrator|maintenance|management)\b|\bhead of facilities\b|\bgrounds/,
      },
    ],
    generic: false,
    rungs: [
      [DEPUTY, 4],
      [/\bhead of\b|\bdirector\b|\bgeneral manager\b/, 5],
      [
        /\bassistant (?:\w+ )?manager\b|\bsupervisor\b|\bteam lead(?:er)?\b|\bcleaner in charge\b|\bleading hand\b|\bsenior\b/,
        3,
      ],
      [/\bmanager\b|\bexecutive housekeeper\b/, 4],
      [/\bfacilit(?:y|ies) (?:officer|coordinator|technician|administrator|lead)\b/, 2],
      [
        /\bcleaners?\b|\bcleaning\b|\bhousekeep\w*\b|\blaundry\b|\battendant\b|\bjanitor\w*\b|\bcustodians?\b|\bhotel services assistant\b|\bfacilities assistant\b|\bgroundsperson\b|\bgrounds ?keeper\b/,
        1,
      ],
    ],
  },
  {
    id: "agriculture",
    label: "Agriculture, horticulture & animals",
    // farm or station hand → stockperson / gardener / horticulturist /
    // agronomist → senior / head gardener / overseer → farm manager →
    // general manager.
    match:
      /\bfarm (?:hand|worker|manager|assistant|labourer|supervisor)\b|\bstation hand\b|\bstock ?(?:person|man)\b|\blivestock\b|\bdairy (?:farm\w*|hand)\b|\bagronomist\b|\bagricultur\w*\b|\bhorticultur\w*\b|\bgardeners?\b|\blandscap(?:er|ing)\b|\blandscape gardener\b|\bgreenkeeper\b|\barborist\b|\bnursery (?:hand|worker|assistant)\b|\baquaculture\b|\bviticultur\w*\b|\bvineyard\b|\bfruit picker\b/,
    skills: ["Agriculture & Farming"],
    exclude:
      /\btransport\b|\beducation\b|\blecturer\b|\bprofessor\b|\bteach\w*\b|\bsales\b|\bclient partner\b|\bagents?\b|\bdata\b|\bscientist\b|\bengineer\b|\bpolicy\b|\bassessor\b|\bfinance\b|\bbank\w*\b|\binsurance\b|\bresearch\b|\banaesthetic\b/,
    generic: false,
    rungs: [
      [/\bhead of\b|\bdirector\b|\bgeneral manager\b/, 5],
      [/\bmanager\b/, 4],
      [/\bsenior\b|\blead\b|\bhead gardener\b|\bleading hand\b|\bsupervisor\b|\boverseer\b/, 3],
      [
        /\bfarm (?:hand|worker|assistant|labourer)\b|\bstation hand\b|\blabourer\b|\bassistant\b|\battendant\b|\btrainee\b|\bapprentice\b|\bpicker\b|\bnursery hand\b/,
        1,
      ],
      [/\w/, 2],
    ],
  },
  {
    id: "personal",
    label: "Beauty, fitness & recreation",
    // apprentice / junior → beautician / stylist / therapist / instructor →
    // senior → salon or centre manager. Hairdressing's "Director Stylist" is
    // a senior stylist GRADE, not a director.
    match:
      /\bbeaut(?:ician|y therapist|y consultant|y advisor|y specialist)\b|\bspa therapist\b|\bhair ?(?:stylist|dresser|salon)\w*\b|\bhairdress\w*\b|\bbarbers?\b|\bnail tech\w*\b|\ba?esthetician\b|\bbrow specialist\b|\bmake ?up artist\b|\breflexologist\b|\bsalon manager\b|\bfitness instructor\b|\bpersonal trainers?\b|\bsports? coach(?:es|ing)?\b|\bswim(?:ming)? (?:coach|instructor)\b|\bhead coach\b|\bgroup fitness\b|\bfootball (?:coach\w*|and soccer coach)\b/,
    skills: ["Personal Services & Beauty", "Sport & Recreation"],
    exclude: /\bsales\b|\bretail\b|\bteach\w*\b|\blecturer\b|\bnurse\b|\bdriving\b/,
    tracks: [
      {
        id: "fitness",
        label: "Fitness & sport",
        match: /\bfitness\b|\btrainers?\b|\bcoach|\bswim|\bsport/,
      },
    ],
    generic: false,
    rungs: [
      [/\bdirector (?:\w+ )?(?:hair ?)?stylist\b/, 3],
      [/\bhead of\b|\bdirector\b|\bgeneral manager\b/, 5],
      [/\bmanager\b/, 4],
      [/\bsenior\b|\blead\b|\bsupervisor\b|\bhead coach\b|\bmaster\b/, 3],
      [/\bapprentice\b|\bjunior\b|\btrainee\b|\bassistant\b|\bintern\w*\b/, 1],
      [/\w/, 2],
    ],
  },
  {
    id: "hospitality",
    label: "Hospitality & food",
    // Three ladders that share venues. The kitchen: kitchenhand → cook / chef de
    // partie → sous → head chef → executive chef. Front of house: attendant →
    // supervisor → assistant / duty manager → venue manager → F&B director.
    // Bakers and butchers: apprentice → tradesperson → head baker.
    //
    // After retail: a supermarket's "Bakery Manager" is a store department
    // rung, and retail excludes the trades themselves (baker, butcher, barista,
    // chef, cook), which then land here.
    match:
      /\bchefs?\b|\bcooks?\b|\bkitchen ?hand\b|\bkitchen (?:assistant|porter|crew|staff|attendant|manager|supervisor)\b|\bcommis\b|\bsous\b|\bpastry\b|\bpatissier\b|\bbaker\b|\bbakery (?:assistant|manager)\b|\bbutcher\w*\b|\bbarista\b|\bbartender\b|\bbar (?:attendant|staff|manager|supervisor|back)\b|\bwait(?:er|ress|staff|ing staff)\b|\bfood and beverage\b|\bf and b\b|\brestaurant\b|\bcafe (?:team member|all ?rounder|manager|supervisor|assistant)\b|\bcatering (?:\w+ )?(?:assistant|attendant|manager|supervisor|coordinator)\b|\bhospitality (?:assistant|attendant|all ?rounders?|supervisor|manager|team member|staff)\b|\bdishwasher\b/,
    skills: ["Hospitality & Food Service", "Food Trades"],
    // "Chef de projet" is French for project manager; cleaners and sales are
    // their own ladders; a patisserie's sales assistant is retail.
    exclude:
      /\bbaker hughes\b|\bchef fresh\b|\bprocess worker\b|\bchef de (?:projet|mission)\b|\bchef d equipe\b|\bcleaner\b|\bcleaning\b|\bhousekeep|\bsales\b|\bmarketing\b|\brecruit|\bnurse\b|\bdriver\b|\baccount(?:ant|s)?\b|\bengineer\b|\bdeveloper\b|\bcategory manager\b/,
    tracks: [
      {
        id: "kitchen",
        label: "Kitchen",
        match:
          /\bchefs?\b|\bcooks?\b|\bkitchen\w*\b|\bcommis\b|\bsous\b|\bpastry\b|\bpatissier\b|\bdishwasher\b/,
      },
      {
        id: "food-trades",
        label: "Bakers & butchers",
        // A barista or cashier at a bakery café is front of house.
        match: /^(?!.*\b(?:barista|cashier|cafe)\b).*(?:\bbaker\w*|\bbutcher\w*)/,
      },
    ],
    generic: false,
    rungs: [
      // The kitchen, top down.
      [
        /\b(?:group |corporate )?executive chef\b|\bculinary director\b|\bdirector of culinary\b/,
        5,
      ],
      [
        /\bexecutive sous chef\b|\bhead chef\b|\bchef de cuisine\b|\bchef manager\b|\bkitchen manager\b|\bhead cook\b|\bchief cook\b/,
        4,
      ],
      [
        /\bsous chef\b|\bsenior (?:cook|chef)\b|\bsenior chef de partie\b|\bhead baker\b|\bsenior (?:baker|butcher)\b|\bkitchen supervisor\b/,
        3,
      ],
      [
        /\b(?:apprentice|trainee|junior) (?:chef|cook|baker|butcher|pastry cook)\b|\bcommis\b|\b(?:assistant|trainee) cook\b|\bkitchen ?hand\b|\bkitchen (?:assistant|porter|crew|attendant|staff)\b|\bdishwasher\b|\bbakery assistant\b(?! manager)|\bbutcher apprentice/,
        1,
      ],
      [
        /\bchef de partie\b|\bdemi chef\b|\bchefs?\b|\bcooks?\b|\bpastry (?:chef|cook)\b|\bbaker\b|\bbutcher\b/,
        2,
      ],
      // Front of house, top down.
      [
        /\bdirector of (?:food and beverage|f and b)\b|\b(?:food and beverage|f and b) director\b|\bhead of (?:food and beverage|hospitality)\b|\b(?:area|group|regional) (?:venue|restaurant|hospitality) manager\b/,
        5,
      ],
      [/\bassistant (?:\w+ ){0,3}manager\b|\bduty manager\b/, 3],
      [
        /\b(?:restaurant|venue|bar|cafe|catering|food and beverage|f and b|hospitality|banquets?|outlet)(?: \w+)? manager\b|\bmanager (?:restaurant|food and beverage|f and b)\b/,
        4,
      ],
      [
        /\bsupervisor\b|\bteam leader\b|\bcaptain\b|\b(?:food and beverage|f and b) executive\b|\bhead (?:bartender|waiter|barista)\b|\bchef de rang\b|\bsenior (?:barista|bartender|waiter)\b/,
        2,
      ],
      [
        /\bbarista\b|\bbartender\b|\bbar (?:attendant|staff|back)\b|\bwait(?:er|ress|staff|ing staff)\b|\b(?:food and beverage|f and b) (?:attendant|assistant|associate|server)\b|\bcafe (?:team member|all ?rounder|assistant)\b|\bcatering (?:assistant|attendant)\b|\bhospitality (?:assistant|attendant|all ?rounders?|team member|staff)\b|\b(?:food and beverage|f and b)(?: and event)? service expert\b|\brestaurant (?:server|service crew|crew)\b/,
        1,
      ],
    ],
  },
  {
    id: "education",
    label: "Education",
    // Four ladders. Schools: aide → teacher → leading teacher → head of
    // department / assistant or deputy principal → principal. Early childhood
    // (Australian): educator → early childhood teacher → room / educational
    // leader → centre director. Education support: aide / SLSO → lead →
    // manager. Academic: associate lecturer → lecturer → senior lecturer →
    // associate professor → professor.
    //
    // "PRINCIPAL" IS THE TRAP. It tops a school's ladder and is a mid-senior
    // grade everywhere else ("Principal Engineer", "Principal Analyst"), and
    // the generic rubric reads it as the latter. So it counts here only
    // qualified by a school word, and this family's rules never fall back to
    // the generic rubric. "Principal Engineer HV Primary" is the measured case
    // — "primary" is a substation, not a school.
    match:
      /\bteachers?\b|\bteaching\b|\beducators?\b|\beducarer\b|\blecturer\b|\bprofessor\b|\b(?:academic|university|sessional) tutor\b|\bteaching (?:fellow|associate)\b|\b(?:deputy|assistant|associate|vice) principal\b|\bprincipal (?:range|of the school)\b|\bprincipal\b.*\b(?:school|college|catholic|primary school|ps)\b|\bschool principal\b|^(?:acting )?principal$|\bhead of (?:school|department|curriculum|faculty)\b|\bhead teacher\b|\bdean\b|\bteacher aide\b|\beducation (?:assistant|support)\b|\blearning support (?:officer|assistant)\b|\bintegration aide\b|\bstudent support (?:officer|assistant)\b|\bearly childhood\b|\bchild ?care\b|\bkindergarten\b|\bpreschool\b|\broom leader\b|\beducational leader\b|\bcent(?:re|er) director\b|\bnanny\b|\blearning specialist\b/,
    skills: [
      "Teaching & Education",
      "Education Leadership",
      "Education Support",
      "Childcare & Early Learning",
    ],
    // Clinical, health and community educators teach patients and clients,
    // not classes; "principal" beside an engineering or analyst noun is a grade.
    exclude:
      /\bclinical (?:nurse )?educator\b|\bdiabetes educator\b|\bhealth educator\b|\bcounsell?or\b|\bpatient educator\b|\bdriving instructor\b|\bengineer|\barchitect\b|\banalyst\b|\bsubstation\b|\benablement\b|\bregulatory\b|\bpolicy\b|\bmarketing\b|\bsales\b|\bcleaner\b|\bcook\b|\bchef\b|\bpsychologist\b|\bspeech pathologist\b|\boccupational therapist\b|\bsocial worker\b|\bexecutive assistant\b/,
    tracks: [
      {
        id: "early-childhood",
        label: "Early childhood",
        match:
          /\beducators?\b|\beducarer\b|\bearly childhood\b|\bchild ?care\b|\bkindergarten\b|\bpreschool\b|\broom leader\b|\beducational leader\b|\bcent(?:re|er) director\b|\bnanny\b/,
      },
      {
        id: "education-support",
        label: "Education support",
        match:
          /\bteacher aide\b|\beducation (?:assistant|support)\b|\blearning support\b|\bintegration aide\b|\bstudent support\b/,
      },
      {
        id: "academic",
        label: "Academic",
        match:
          /\blecturer\b|\bprofessor\b|\bdean\b|\bschool of\b|\buniversity\b|\bfaculty\b|\b(?:academic|university|sessional) tutor\b|\bteaching (?:fellow|associate)\b/,
      },
    ],
    generic: false,
    rungs: [
      // Academic.
      [/\b(?:deputy |pro )?vice chancellor\b|\bprovost\b/, 6],
      [
        /\b(?<!associate |assistant )professor\b|\bdean\b|\bhead of (?:school|department) (?:school of|of)\b/,
        5,
      ],
      [/\bassociate professor\b/, 4],
      // A US assistant professor is the first tenure-track grade: the band of
      // an Australian senior lecturer, not of a professor.
      [/\bassistant professor\b/, 3],
      [/\bsenior lecturer\b/, 3],
      [/\bassociate lecturer\b|\btutor\b|\bteaching associate\b/, 1],
      [/\blecturer\b|\bteaching fellow\b/, 2],
      // Schools, top down.
      // Deputies first: "Assistant Principal Range 1" also contains
      // "principal range", the top rung's own words.
      [
        /\b(?:deputy|assistant|associate|vice) principal\b|\bhead of (?:department|curriculum|faculty|year)\b|\bhead teacher\b/,
        4,
      ],
      [
        /\bprincipal (?:range|of the school)\b|\bschool principal\b|^(?:acting )?principal\b|\bhead of school\b|\bexecutive principal\b/,
        5,
      ],
      [
        /\bleading teacher\b|\blead teacher\b|\bsenior teacher\b|\blearning specialist\b|\bhighly accomplished\b/,
        3,
      ],
      [
        /\b(?:graduate|student|pre service|trainee|beginning) teachers?\b|\bteacher (?:graduate|grad)\b/,
        1,
      ],
      // Early childhood.
      [
        /\b(?:area|regional|state|operations) manager\b|\bhead of (?:early learning|early childhood)\b/,
        5,
      ],
      [/\broom leader\b|\beducational leader\b|\bassistant centre director\b|\b2ic\b/, 3],
      [/\bcent(?:re|er) (?:director|manager)\b|\bnominated supervisor\b/, 4],
      [
        /\bearly childhood teacher\b|\bsenior educator\b|\bdiploma (?:qualified )?educator\b|\beducator diploma\b|\bkindergarten teacher\b|\bpreschool teacher\b/,
        2,
      ],
      [
        /\beducators?\b|\beducarer\b|\bchild ?care worker\b|\bearly childhood (?:assistant|educator|worker)\b|\bnanny\b/,
        1,
      ],
      // Education support.
      [
        /\bmanager (?:\w+ )?(?:education|student|learning) support\b|\b(?:education|student|learning) support manager\b/,
        4,
      ],
      [
        /\b(?:education|student|learning) support (?:\w+ )?(?:team )?lead(?:er)?\b|\beducation assistant lead\b/,
        3,
      ],
      [
        /\bteacher aide\b|\beducation (?:assistant|support)\b|\blearning support (?:officer|assistant)\b|\bintegration aide\b|\bstudent support (?:officer|assistant)\b/,
        1,
      ],
      // A teacher.
      [/\bteachers?\b/, 2],
    ],
  },
  {
    id: "logistics",
    label: "Transport & warehousing",
    // Warehouse: storeperson / pick packer → forklift / senior storeperson →
    // team leader / supervisor → warehouse manager → head of logistics.
    // Driving follows the LICENCE: van / MR → truck / HR / bus → HC / MC /
    // US CDL-A → transport supervisor → transport manager.
    //
    // GIG PLATFORMS ARE LEFT OUT. Amazon Flex, Instacart, Uber, DoorDash and
    // the "sign up and start earning" ads are ~1,000 a quarter and are not an
    // employer's ladder: there is no rung to climb and no one to promote you.
    match:
      /\bdrivers?\b|\btruck\b|\bcourier\b|\bstore ?person\b|\bstore ?keeper\b|\bwarehouse\b|\bforklift\b|\bpick ?packer\b|\bpacker\b|\bdespatch\b|\bdispatch\b|\bfreight\b|\blogistics\b|\bdistribution cent|\bdc\b|\bstockhand\b|\bfleet\b|\btransport (?:manager|supervisor|coordinator|planner|operator|allocator)\b|\blocomotive\b/,
    skills: ["Driving & Transport", "Warehousing & Logistics"],
    exclude:
      /\bamazon flex\b|\binstacart\b|\buber\b|\bdash(?:er|ers)\b|\bdoordash\b|\bgopuff\b|\bmenulog\b|\bdeliveroo\b|\bgig\b|\bearn\b|\bsign up\b|\bflexible hours\b|\binstant pay\b|\bcash out\b|\byour (?:own )?schedule\b|\bengineer\b|\bdeveloper\b|\bsoftware\b|\bsales\b|\baccount manager\b|\bmechanic\b|\bdriver (?:and|or) (?:sales|mechanic)\b|\bnurse\b|\bdevice driver\b|\bdriving instructor\b/,
    tracks: [
      {
        id: "driving",
        label: "Driving",
        match: /\bdrivers?\b|\btruck\b|\bcourier\b|\btransport\b|\bfleet\b|\blocomotive\b/,
      },
    ],
    generic: false,
    rungs: [
      [
        /\bhead of (?:logistics|supply chain|distribution|transport|warehousing|fleet)\b|\b(?:logistics|distribution|transport|supply chain|warehouse) director\b|\bgeneral manager (?:logistics|distribution|transport|warehousing)\b|\bnational (?:logistics|transport|distribution|warehouse|fleet) manager\b/,
        5,
      ],
      [/\bassistant (?:\w+ ){0,2}manager\b|\b2ic\b|\bsecond in charge\b/, 3],
      [
        /\b(?:warehouse|distribution cent\w*|dc|transport|fleet|logistics|depot|freight|despatch|dispatch|operations) manager\b|\bmanager (?:warehouse|logistics|transport|distribution)\b|\bsuperintendent\b/,
        4,
      ],
      [
        /\bsupervisor\b|\bteam leader\b|\bleading hand\b|\blead (?:warehouse|storeperson|driver)\b|\b(?:warehouse|logistics|transport) lead\b|\bhc driver\b|\bmc driver\b|\bheavy combination\b|\bmulti combination\b|\bb ?double\b|\broad train\b|\bcdl (?:class )?a\b|\bclass a (?:cdl )?(?:company )?driver\b|\bdriver (?:cdl )?class a\b|\botr (?:class a )?driver\b|\blocomotive driver\b|\btrain driver\b/,
        3,
      ],
      [
        /\bforklift (?:operator|driver)\b|\breach truck\b|\bsenior store ?person\b|\bwarehouse (?:officer|coordinator|operator|executive|technician)\b|\bfreight (?:coordinator|operator|controller)\b|\blogistics (?:coordinator|officer|analyst)\b|\btransport (?:coordinator|planner|allocator)\b|\bhr driver\b|\bheavy rigid\b|\btruck driver\b|\bbus driver\b|\bcoach driver\b|\btanker driver\b|\btipper driver\b|\bagitator\b|\bmixer driver\b|\bconcrete (?:truck )?driver\b|\b(?:side|rear|front) lift\b|\bclass (?:b|4|5) driver\b|\bclass b\b.*\bdriver\b|\bdriver\b.*\bclass b\b|\bcdl (?:class )?b\b|\blinehaul\b|\blorry driver\b|\blogistics (?:\w+ )?coordinator\b/,
        2,
      ],
      [
        /\bstore ?person\b|\bstore ?keeper\b|\bwarehouse (?:assistant|team member|associate|attendant|operative|worker|hand|labourer|store ?person)\b|\bpick ?packer\b|\bpacker\b|\bdespatch (?:officer|hand|assistant)\b|\bstockhand\b|\b(?:dc|dispatch|despatch) (?:team member|store ?person|operator)\b|\bdelivery driver\b|\bvan driver\b|\bcourier\b|\bmr driver\b|\blr driver\b|\bmedium rigid\b|\blight rigid\b|\bmulti drop\b|\btrolley collect|\byard hand\b|\btrainee (?:freight|warehouse)\b|^drivers?$/,
        1,
      ],
    ],
  },
  {
    id: "admin",
    label: "Administration",
    // assistant / receptionist / clerk → administration officer → senior
    // officer / supervisor → office / administration / practice manager.
    // Executive assistants are a track of their own: EA → senior EA.
    //
    // LAST, because it is everyone's support function: an "HR Administrator"
    // or "Project Administrator" is placed by its function first.
    match:
      /\badministration\b|\badministrative\b|\badmin\b|\badministrator\b|\breceptionist\b|\breception\b|\bmedical screener\b|\bexecutive assistant\b|\bpersonal assistant\b|\b(?:pa|ea) to\b|\bexecutive (?:support officer|business partner)\b|\bsecretary\b|\bclerk\b|\boffice (?:manager|assistant|coordinator|administrator|junior)\b|\bbusiness support (?:officer|assistant|coordinator|manager)\b|\bdata entry\b|\bfront (?:office|desk)\b|\bpractice manager\b/,
    skills: ["Administration & Office Support"],
    supportRoles: EA_PA,
    // Construction contract administration is a commercial ladder; systems
    // administrators are IT; a company secretary is governance; law clerks are
    // legal; a chief of staff is on none of these.
    // A hotel's "Executive Assistant Manager" is its deputy GM, not an EA.
    exclude:
      /\bexecutive assistant manager\b|\bidentity governance\b|\bcyber\b|\bcontracts? administrat|\bcompany secretar|\bchief of staff\b|\b(?:system|systems|network|database|sharepoint|salesforce|servicenow|platform|cloud|m365|it|ict|lms|crm|erp|sap|citrix|vmware|linux|windows|oracle|workday|jira|atlassian|security|applications?) administrator\b|\blaw clerk\b|\bsales\b|\bnurse\b|\bdriver\b|\bpayroll\b|\baccounts? (?:payable|receivable)\b|\bhospitality assistant\b/,
    tracks: [{ id: "executive-assistant", label: "Executive assistants", match: EA_PA }],
    generic: false,
    rungs: [
      [/\bapprentice\b|\btrainee\b/, 1],
      [
        /\bhead of (?:administration|business support|office services)\b|\b(?:administration|business support) director\b|\bdirector of administration\b/,
        5,
      ],
      [/\bassistant (?:\w+ ){0,2}manager\b/, 3],
      [
        /\b(?:administration|administrative|admin|office|practice|front office|business support|operations support|reception) manager\b|\bmanager (?:administration|business support|office services)\b/,
        4,
      ],
      [
        /\bsenior (?:executive|personal) assistant\b|\bexecutive assistant to the (?:ceo|chief executive|managing director|chair|board)\b|\b(?:administration|admin|office|reception|front office|business support) (?:supervisor|team leader|lead)\b|\bsenior (?:administration|administrative|admin|business support|office) officer\b/,
        3,
      ],
      [
        /\bexecutive assistant\b|\bexecutive business partner\b|\bpersonal assistant\b|\b(?:pa|ea) to\b|\bexecutive support officer\b|\b(?:administration|administrative|admin|office|business support|clinic administration|school administrative) officer\b|\bsenior (?:administration|administrative|admin|office) assistant\b|\bsecretary\b|\badmin(?:istration|istrative)? executive\b|\b(?:administration|reception) (?:\w+ )?officer\b/,
        2,
      ],
      [
        /\b(?:administration|administrative|admin|office|reception|clerical|business support) (?:assistant|clerk|support|trainee|junior|coordinator)\b|\breceptionist\b|\breception\b|\bmedical screener\b|^(?:office )?admin$|\bclerk\b|\badministrator\b|\bdata entry\b|\bfront (?:office|desk)\b/,
        1,
      ],
    ],
  },
];

/**
 * Parent skills that get NO ladder of their own, and why. Every parent skill in
 * skillsTaxonomy.ts must be claimed by a family's `skills`, listed here, or
 * listed in PATHWAYS_PLANNED — scripts/check-career-ladder.ts fails otherwise.
 * A reason is required: "not modelled" is what PLANNED is for.
 */
export const NOT_A_LADDER: Record<string, string> = {
  // Cross-cutting: a skill every ladder's upper rungs ask for, not a job family.
  "Leadership & Coordination": "asked for at the upper rungs of every ladder",
  "General Management": "the top rung of many ladders, not a ladder of its own",
  Operations: "a function name every ladder uses, not an occupation",
  // Sectors: the industry a role is in. Its roles are placed by occupation.
  Telecommunications: "a sector; its engineers, sales and technicians are placed by occupation",
  "Shipbuilding & Marine": "a sector; its trades and engineers are placed by occupation",
  Decarbonisation: "an energy-sector specialism; placed by occupation",
  "Hydrogen & Renewables": "an energy-sector specialism; placed by occupation",
  "LNG Operations": "an energy-sector specialism; placed by occupation",
  "Subsea Engineering": "an energy-sector specialism; placed by occupation",
};

/**
 * Parent skills whose ladder is not built YET. The coverage check accepts them
 * so a wave can land on its own, and prints them, so the gap stays visible.
 * Empty is the finished state.
 */
export const PATHWAYS_PLANNED: string[] = [];

function rungFrom(rules: [RegExp, Rung][], t: string): Rung | null {
  for (const [re, rung] of rules) if (re.test(t)) return rung;
  return null;
}

/**
 * The title with trailing noise removed, for display and for counting "the
 * same role" across boards. A tail after " - " or " | " is cut only when the
 * head alone still places identically — "HR Advisor - Perth" loses its city,
 * "Manager - Human Resources" keeps its function.
 */
function canonicalOf(raw: string, placed: Placed, ctx: PlaceContext | undefined): string {
  const noParens = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  const head = noParens.split(/\s[-|–—:]\s|,\s/)[0] ?? noParens;
  for (const candidate of [head, noParens]) {
    const c = cleanTitle(candidate);
    const p = placeClean(c, ctx);
    if (p && p.family === placed.family && p.track === placed.track && p.rung === placed.rung)
      return c;
  }
  return cleanTitle(raw);
}

type Placed = Omit<Placement, "canonical">;

function placeClean(t: string, ctx: PlaceContext | undefined): Placed | null {
  if (!t || MULTI_LEVEL.test(t) || NOT_A_JOB.test(t)) return null;
  const support = SUPPORT_TO.test(t);
  for (const f of FAMILIES) {
    if (support && !f.supportRoles?.test(t)) continue;
    if (DOMAIN_FAMILIES.has(f.id) && DOMAIN_SUPPORT.test(t)) continue;
    const byTitle = f.match.test(t);
    const byEmployer =
      !byTitle &&
      !!f.employerMatch &&
      !!ctx?.employerFamilies?.has(f.id) &&
      f.employerMatch.test(t);
    // An exclusion means "not THIS ladder", not "no ladder": a Project
    // Accountant leaves the project family and is placed by finance.
    if (!(byTitle || byEmployer) || f.exclude?.test(t)) continue;
    const rung =
      rungFrom(f.rungs ?? [], t) ?? (f.generic === false ? null : rungFrom(GENERIC_RUNGS, t));
    if (!rung) return null;
    const track = f.tracks?.find((tr) => tr.match.test(t))?.id ?? "generalist";
    return { family: f.id, track, rung, via: byTitle ? "title" : "employer" };
  }
  return null;
}

/**
 * Place one advertised title, or null when it is on no ladder we model or its
 * rung cannot be read. Families are tried in declaration order and the first
 * that matches without excluding decides — so a title is never on two ladders
 * at once, and the ORDER of FAMILIES is part of the rules: nursing and project
 * come before software so "Software Project Manager" is a project role;
 * retail comes before sales so "Retail Sales Assistant" is a store role; and
 * both come before HSE, whose generic rubric cannot read "Sales Representative"
 * and would leave "Safety Equipment Sales Representative" unplaced.
 *
 * `ctx` adds what the employer says. It can only ADD a family for a title whose
 * own words name none — a title that names a function is placed by it,
 * whoever advertises it — so an unknown employer places exactly as before.
 */
export function placeTitle(title: string, ctx?: PlaceContext): Placement | null {
  const placed = placeClean(cleanTitle(title), ctx);
  if (!placed) return null;
  return { ...placed, canonical: canonicalOf(title, placed, ctx) };
}

/** Which family CLAIMS a title whose rung could not be read — the audit's
 *  worklist of titles a family failed to place. Titles left out on purpose
 *  (an exclusion, someone else's support role, a multi-rung title) are not
 *  failures and are not counted: until 2026-09-24 they were, and "HR Driver"
 *  and "Project Engineer" topped the lists every run. */
export function familyHint(title: string): string | null {
  const t = cleanTitle(title);
  if (!t || MULTI_LEVEL.test(t) || NOT_A_JOB.test(t)) return null;
  const support = SUPPORT_TO.test(t);
  return (
    FAMILIES.find(
      (f) =>
        (!support || !!f.supportRoles?.test(t)) &&
        !(DOMAIN_FAMILIES.has(f.id) && DOMAIN_SUPPORT.test(t)) &&
        f.match.test(t) &&
        !f.exclude?.test(t),
    )?.id ?? null
  );
}

// ---- The generated dataset's shape (src/employsi/data/careerPathways.ts) ----

export interface PayFigure {
  /** Median advertised annual pay, AUD. Null below MIN_ADS. */
  median: number | null;
  /** Ads that stated a readable salary. */
  n: number;
}

export interface PathwayNode {
  family: string;
  track: string;
  rung: Rung;
  /** Distinct roles advertised in the window (cross-board duplicates merged). */
  ads: number;
  /** Of those, still advertised at the end of the window. */
  live: number;
  employers: number;
  /** Live roles by country code. */
  byCountry: Record<string, number>;
  /** Commonest canonical titles, [title, roles]. */
  titles: [string, number][];
  /** Roles that carry any skills — the denominator of `skills`' shares.
   *  Several feeds store none, so this is usually below `ads`. */
  skillBase: number;
  /** Commonest skills, [skill, share of skill-bearing roles 0-1]. */
  skills: [string, number][];
  /** Pay by country — never pooled, since the markets are not one market. */
  pay: Record<string, PayFigure>;
}

export interface PathwayEdge {
  family: string;
  from: { track: string; rung: Rung };
  to: { track: string; rung: Rung };
  /** "step" is the next rung on the same track; "converge" is a specialist
   *  track joining the generalist ladder at the family's convergeAt rung. */
  kind: "step" | "converge";
  /** Employers advertising BOTH ends in the window — evidence the ladder
   *  exists inside real organisations, not that anyone climbed it. */
  sharedEmployers: number;
  /** Weighted skill overlap, 0-1: Σ min(share) / Σ max(share). */
  skillOverlap: number;
  /** Skills much commoner at the destination: [skill, share gained]. */
  skillsToGain: [string, number][];
  /** Destination median ÷ origin median, per country where both exist. */
  payStep: Record<string, number>;
}

export interface CareerPathways {
  generated: string;
  window: { from: string; to: string };
  families: { id: string; label: string; tracks: { id: string; label: string }[] }[];
  nodes: PathwayNode[];
  edges: PathwayEdge[];
}
