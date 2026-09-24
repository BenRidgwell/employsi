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
 * TUNING. The rules were written from typical Australian titles, not measured
 * against the archive. `scripts/gen-career-pathways.ts --audit` lists, per
 * family, the titles that matched a family but got no rung — that list is the
 * worklist. Every fixture in scripts/check-career-ladder.ts is a promise that
 * must survive a tuning pass.
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
 * Director" names the HR Director and an executive; it is on neither ladder.
 */
const SUPPORT_TO =
  /\b(assistant|pa|ea|support|coordinator|advisor|adviser)\s+to\b|\bexecutive assistant\b|\bpersonal assistant\b/;

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
    .trim();
}

/**
 * The generic seniority rubric, in precedence order. First match wins, so the
 * order is the logic: "Assistant Manager" must meet `assistant manager` (3)
 * before `manager` (4) and before `assistant` (1).
 */
const GENERIC_RUNGS: [RegExp, Rung][] = [
  // Executive. "Chief … Officer" and the C-suite acronyms; a bare "chief"
  // (Chief Engineer, Chief Steward) is a senior practitioner, not the board.
  [/\bchief\b(?:\s+\w+){1,4}\s+officer\b|\bc(?:e|f|o|t|i|p|hr|d|is|m)o\b/, 6],
  [
    /\bexecutive general manager\b|\begm\b|\bgroup executive\b|\bsenior vice president\b|\bsvp\b/,
    6,
  ],

  // Deputies and associates of a director sit a band below the director.
  [/\b(?:assistant|associate|deputy)\s+(?:director|head|general manager)\b/, 4],
  [
    /\bhead of\b|\bdirector\b|\bgeneral manager\b|\bgm\b|\bvice president\b|\bvp\b|\bexecutive manager\b/,
    5,
  ],

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
    /\bofficer\b|\badvis[oe]r\b|\bconsultant\b|\bgeneralist\b|\banalyst\b|\bspecialist\b|\bpractitioner\b|\bengineer\b|\bdeveloper\b|\baccountant\b|\bexecutive\b|\brecruiter\b|\bpartner\b/,
    2,
  ],
  [/\bassistant\b|\badministrator\b|\badmin\b|\bcoordinator\b|\bclerk\b|\bsupport\b/, 1],
];

export const FAMILIES: FamilyDef[] = [
  {
    id: "hr",
    label: "Human resources",
    match:
      /\bhr\b|\bhuman resources?\b|\bpeople and culture\b|\bpeople and capability\b|\bpeople and performance\b|\bpeople (?:partner|advis[oe]r|officer|business partner|lead|director|operations)\b|\bhead of people\b|\bdirector of people\b|\bchief people officer\b|\bchief human resources officer\b|\bemployee relations\b|\bindustrial relations\b|\bworkplace relations\b|\btalent acquisition\b|\blearning and development\b|\borganisational development\b|\borganizational development\b|\bremuneration\b|\bhris\b|\brecruiter\b|\binternal recruit|\brecruitment (?:coordinator|advis[oe]r|officer|manager|partner|lead|specialist|business partner)\b/,
    // Payroll reports into HR at some employers and finance at others, and its
    // ladder (officer → payroll manager) does not lead to CPO. Kept out until it
    // is a family of its own. Recruitment AGENCY consultants are a sales ladder.
    exclude: /\bpayroll\b|\brecruitment consultant\b/,
    tracks: [
      {
        id: "talent-acquisition",
        label: "Talent acquisition",
        match: /\btalent acquisition\b|\brecruit|\bsourc(?:er|ing)\b/,
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
    ],
    rungs: [
      [/\bchief people officer\b|\bchief human resources officer\b/, 6],
      [/\bhead of people\b|\bdirector of people\b|\bpeople director\b/, 5],
      // "People Partner" is the HRBP role under a newer name.
      [/\bpeople (?:business )?partner\b/, 3],
    ],
    convergeAt: 5,
  },
  {
    id: "finance",
    label: "Finance & accounting",
    match:
      /\bfinanc(?:e|ial)\b|\baccountant\b|\baccounting\b|\baccounts (?:payable|receivable)\b|\bbookkeeper\b|\b(?:financial|finance|group) controller\b|\bcomptroller\b|\btreasury\b|\bfp and a\b|\bcfo\b|\bchief financial officer\b|\btax\b/,
    // Advice, lending and insurance are other ladders that use the word.
    exclude:
      /\bfinancial (?:planner|adviser|advisor|counsellor)\b|\bfinance broker\b|\bmortgage\b|\bloan\b|\blending\b|\binsurance\b|\bfinance (?:sales|consultant)\b|\bsales\b(?! ledger)|\bcollections?\b|\bcustomer service\b/,
    tracks: [
      {
        id: "fpa",
        label: "FP&A & commercial",
        match:
          /\bfp and a\b|\bfinancial planning and analysis\b|\bcommercial\b|\bfinance business partner\b|\bfinancial analyst\b/,
      },
      { id: "tax", label: "Tax", match: /\btax\b/ },
      { id: "treasury", label: "Treasury", match: /\btreasury\b/ },
    ],
    rungs: [
      [/\bchief financial officer\b|\bcfo\b/, 6],
      // Transactional roles are the entry rung whatever noun they carry.
      [
        /\baccounts (?:payable|receivable)\b|\bbookkeeper\b|\baccounts officer\b|\bassistant accountant\b|\baccounts assistant\b|\bfinance assistant\b/,
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
    match: /\bnurse\b|\bnurses\b|\bnursing\b|\bmidwife\b|\bmidwifery\b|\bmidwives\b/,
    // Nursing HOMES advertise cooks, cleaners and carers under the word.
    exclude:
      /\bnursing home\b.*\b(?:cook|cleaner|chef|maintenance|driver|administration|receptionist)\b|\bveterinary nurse\b|\bdental nurse\b/,
    tracks: [{ id: "midwifery", label: "Midwifery", match: /\bmidwi/ }],
    generic: false,
    // Nursing titles carry their grade in the noun, not a seniority word, so
    // the family rules do nearly all the work here.
    rungs: [
      [/\bchief nursing\b|\bexecutive director of nursing\b|\bexecutive director nursing\b/, 6],
      [/\b(?:assistant|deputy) director of (?:nursing|midwifery)\b|\badon\b/, 4],
      [/\bdirector of nursing\b|\bnursing director\b|\bdirector of midwifery\b|\bdon\b/, 5],
      [
        /\bnurse unit manager\b|\bmidwifery unit manager\b|\bnum\b|\bnurse manager\b|\bclinical nurse consultant\b|\bnurse practitioner\b|\bclinical midwife consultant\b/,
        4,
      ],
      [
        /\bclinical nurse\b|\bclinical midwife\b|\bnurse educator\b|\bclinical nurse specialist\b|\bclinical nurse educator\b|\bsenior (?:registered )?nurse\b/,
        3,
      ],
      // Before the bare `nurse` below, which would otherwise claim "Enrolled Nurse".
      [
        /\bassistant in nursing\b|\bnursing assistant\b|\bain\b|\benrolled nurse\b|\bstudent nurse\b/,
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
    match: /\bproject\b|\bprogram\b|\bprogramme\b|\bpmo\b/,
    // Project ENGINEERS and accountants are on their own discipline's ladder;
    // a portfolio manager at a fund manages money, not projects.
    exclude:
      /\bproject (?:engineer|accountant|architect|surveyor|geologist|lawyer|scientist)\b|\bprogram(?:me)?\s+(?:developer|engineer)\b|\binvestment\b|\bfund\b|\bgraduate program\b|\bgraduate programme\b|\bnutrition\b|\bsocial worker\b/,
    generic: false,
    rungs: [
      [
        /\bhead of (?:pmo|projects|delivery)\b|\bproject director\b|\bprogram(?:me)? director\b|\bportfolio (?:manager|director)\b|\bpmo manager\b/,
        5,
      ],
      [/\bsenior project manager\b|\bprogram(?:me)? manager\b/, 4],
      // A project manager runs a project, not a team — the senior-practitioner
      // band, not the generic "manager".
      [/\bassistant project manager\b/, 2],
      [/\bproject manager\b|\bproject lead\b|\bproject leader\b/, 3],
      [/\b(?:project|program|programme|pmo) (?:officer|analyst|scheduler|controls)\b/, 2],
      [/\b(?:project|program|programme|pmo) (?:administrator|support|coordinator|assistant)\b/, 1],
    ],
  },
  {
    id: "software",
    label: "Software engineering",
    match:
      /\bsoftware\b|\bdeveloper\b|\bprogrammer\b|\bfull ?stack\b|\bfront ?end\b|\bback ?end\b|\bdevops\b|\bsite reliability\b|\bsre\b|\bengineering manager\b|\bhead of engineering\b|\bdirector of engineering\b|\bcto\b|\bchief technology officer\b|\bplatform engineer\b/,
    exclude:
      /\bsales\b|\baccount (?:manager|executive)\b|\bbusiness development\b|\bsupport\b|\btrainer\b|\bproperty developer\b|\bbusiness developer\b|\bland developer\b|\bloader\b|\boperator\b/,
    rungs: [
      [/\bchief technology officer\b|\bcto\b/, 6],
      [/\bhead of engineering\b|\bdirector of engineering\b|\bvp engineering\b/, 5],
      // The senior IC track: paid and scoped like a manager, manages no one.
      [/\bstaff (?:software )?engineer\b|\bprincipal\b|\barchitect\b|\bengineering manager\b/, 4],
      [/\btech(?:nical)? lead\b|\blead (?:developer|engineer|software engineer)\b/, 3],
    ],
  },
  {
    id: "retail",
    label: "Retail (store operations)",
    // The store ladder: assistant → key holder → 2IC → store manager → area /
    // state manager. "Sales Assistant" is here rather than in sales because in
    // Australian ads it is overwhelmingly a shop-floor role.
    match:
      /\bretail\b|\bstore\b|\bstores\b|\bshop\b|\bboutique\b|\bsupermarket\b|\bsales assistant\b|\bcheckout\b|\bcashier\b|\bnight ?fill\b|\bkey ?holder\b|\bvisual merchandis\w*|\bmerchandiser\b/,
    // A storeperson and a mining "Stores Officer" are warehousing; the trades
    // and professions that work in or for shops are their own ladders; head
    // office buying and planning is a different ladder not yet modelled.
    exclude:
      /\bstore ?(?:person|man|men)\b|\bstore (?:development|design|planning)\b|\bstores (?:officer|coordinator|clerk|supervisor|person)\b|\bwarehouse\b|\bdistribution cent|\bcold store\b|\bretail (?:bank|banking|lending|energy|credit)\b|\bpharmac|\bbutcher\b|\bbaker\b|\bbarista\b|\bchef\b|\bcook\b|\bshop ?fitter\b|\bmachine shop\b|\bshop floor\b|\bworkshop\b|\belectrician\b|\bmechanic\b|\btechnician\b|\bdriver\b|\bforklift\b|\bsecurity\b|\bcleaner\b|\bloss prevention\b|\boptometrist\b|\bhairdresser\b|\bsoftware\b|\bdeveloper\b|\bengineer\b|\banalyst\b|\bplanner\b|\bbuyer\b|\ballocator\b|\bproduction\b|\bmanufacturing\b|\b(?:plant|process|machine) operator\b|\blaborator/,
    // Only for employers in ladderEmployers.ts's retail set: store roles
    // advertised without a retail word. Deliberately absent — "Duty Manager"
    // (Endeavour's pubs, airports, cinemas) and a bare "Supervisor" or "Team
    // Leader" (distribution centres, Wesfarmers' chemical plants).
    employerMatch:
      /\bteam member\b|\bcrew member\b|\bcustomer service (?:assistant|advis[oe]r|team member|supervisor|manager)\b|\bcustomer (?:assistant|advis[oe]r)\b|\bdepartment manager\b|\bassistant manager\b|\b2ic\b|\bsecond in charge\b|\bconsole operator\b|\bsales (?:consultant|associate|advis[oe]r)\b|\bservice (?:team member|assistant)\b/,
    tracks: [
      { id: "visual-merchandising", label: "Visual merchandising", match: /\bvisual merchandis/ },
    ],
    // The generic rubric is right for "Store Manager" (4), "Retail Director"
    // (5) and "Assistant Manager" (3); these rules correct the rest. Retail
    // compresses: area, state and national managers all share rung 5, and the
    // node's titles show which.
    rungs: [
      [
        /\b(?:area|district|regional|state|national|multi ?site|cluster) (?:retail |store |operations |sales )?manager\b/,
        5,
      ],
      [
        /\b(?:trainee|graduate) (?:store |retail )?manager\b|\bmanager in training\b|\bassistant (?:store |retail |shop |boutique )?manager\b|\bdeputy (?:store|retail|shop|boutique) manager\b|\b2ic\b|\bsecond in charge\b|\bdepartment manager\b|\bduty manager\b|\bcustomer service manager\b|\bsenior visual merchandiser\b/,
        3,
      ],
      // A store supervisor or team leader is a key holder, not a senior
      // professional — the generic rubric would say 3.
      [
        /\bkey ?holder\b|\bsupervisor\b|\bteam leader\b|\bsenior (?:sales|retail|store|shop) (?:assistant|consultant|associate)\b|\bvisual merchandiser\b|\bvisual merchandising (?:coordinator|specialist)\b/,
        2,
      ],
      [
        /\b(?:sales|retail|store|shop) (?:assistant|consultant|associate|advis[oe]r)\b|\bteam member\b|\bcrew member\b|\bcashier\b|\bcheckout\b|\bnight ?fill\b|\bmerchandiser\b|\bcustomer (?:service )?(?:assistant|advis[oe]r)\b|\bconsole operator\b|\bservice assistant\b/,
        1,
      ],
    ],
  },
  {
    id: "sales",
    label: "Sales & business development",
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
        /\bchief (?:revenue|sales|commercial) officer\b|\bexecutive general manager\b|\bgroup executive\b|\bsvp\b|\bsenior vice president\b/,
        6,
      ],
      [
        /\bhead of (?:sales|business development|partnerships|account management|revenue)\b|\bsales director\b|\bdirector of (?:sales|business development)\b|\bbusiness development director\b|\bnational sales manager\b|\bgeneral manager\b|\bvp\b|\bvice president\b/,
        5,
      ],
      [/\bassistant sales manager\b/, 3],
      // A sales manager leads reps. An ACCOUNT manager does not, and is below.
      [
        /\baccount director\b|\b(?:state|regional|area) sales manager\b|\bsales manager\b|\bsales and marketing manager\b/,
        4,
      ],
      // Entry markers after the manager rungs, so "Graduate Account Manager"
      // is 1 and a (rare) "Junior Sales Manager" is not.
      [
        /\bgraduate\b|\btrainee\b|\bjunior\b|\bcadet\b|\bintern\b|\bsdr\b|\bbdr\b|\b(?:sales|business) development representative\b|\bsales (?:support|administrator|admin|coordinator)\b|\btelesales\b/,
        1,
      ],
      [
        /\bkey account\b|\bnational account manager\b|\bstrategic account\b|\bsenior account (?:manager|executive)\b|\benterprise account executive\b|\bbusiness development manager\b|\bbdm\b|\bsenior business development\b|\bsales (?:team )?(?:leader|lead)\b|\bsenior sales (?:executive|representative|consultant)\b/,
        3,
      ],
      [
        /\baccount (?:manager|executive)\b|\bbusiness development (?:executive|consultant|officer|associate)\b|\bbde\b|\bsales (?:executive|representative|rep|consultant|specialist|agent|advis[oe]r|associate|person|professional)\b|\bterritory manager\b|\binside sales\b|\bfield sales\b|\bnew business\b/,
        2,
      ],
    ],
  },
  {
    id: "hse",
    label: "Health, safety & environment",
    match:
      /\bhse\b|\bhsse\b|\bhseq\b|\bwhs\b|\bohs\b|\bhealth and safety\b|\bsafety\b|\bwork health\b|\boccupational health\b/,
    // Other people's "safety", and the elected health-and-safety rep, which is
    // a duty an employee holds, not a job.
    exclude:
      /\bfood safety\b|\bpatient safety\b|\bchild safety\b|\bcyber\b|\bsafety (?:glass|boots)\b|\bhsr\b|\bsafety rep(?:resentative)?\b|\bproduct safety\b|\bdrug safety\b|\bpharmacovigilance\b/,
    rungs: [[/\bsafety superintendent\b|\bhse superintendent\b/, 4]],
  },
];

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
  if (!t || SUPPORT_TO.test(t)) return null;
  for (const f of FAMILIES) {
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

/** Which family a title's function words belong to, ignoring rung and
 *  exclusions — the audit uses it to find titles a family failed to place. */
export function familyHint(title: string): string | null {
  const t = cleanTitle(title);
  return FAMILIES.find((f) => f.match.test(t))?.id ?? null;
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
