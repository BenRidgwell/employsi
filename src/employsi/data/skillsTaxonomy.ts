// Canonical skill taxonomy for the live jobs pipeline AND the Jobs and Skills
// Australia (JSA) Internet Vacancy Index. Each canonical skill has a set of
// lowercase match terms; a job (or an ANZSCO occupation title) "demands" a skill
// when any term appears in its title. Originally tuned to the resources / energy
// / finance / industrial roster, now extended to cover the whole Australian
// labour market (health, education, trades, hospitality, transport, community,
// creative, agriculture, safety, personal and cleaning services) so the IVI's
// ANZSCO occupations all map onto searchable skills. Kept dependency-free so the
// Cloudflare cron worker, the IVI generator and the app can all import it.

export interface SkillDef {
  skill: string; // canonical display name
  cat: string; // grouping for the legend
  /**
   * The broader skill this one is a speciality WITHIN, e.g. "Talent
   * Acquisition" inside "Human Resources".
   *
   * THE PARENT MUST MATCH ON ITS OWN EVIDENCE BEFORE A CHILD CAN.
   * A child is not an independent skill that happens to be related; it is a
   * narrowing of its parent, so the title has to be a parent title first. That
   * rule is what makes child terms safe to write loosely: "aged care" is a
   * sound term for Aged Care Nursing precisely because the title must
   * independently say "nurse", so "Aged Care Worker" — a real job, and not a
   * nursing one — never reaches it. Without the gate every child term would
   * need re-qualifying with its parent's vocabulary and would still leak.
   *
   * A child does NOT replace its parent. Both are emitted, so every existing
   * count over a parent is unchanged by adding children beneath it, and a
   * child's count is a SUBSET of its parent's rather than a sibling of it.
   *
   * One level only: a parent may not itself have a parent. Asserted in
   * scripts/check-skills.ts, along with a child sharing its parent's `cat` and
   * clearing an evidence floor in the live archive — a speciality nobody
   * advertises is a speciality we should not be reporting on.
   *
   * WHAT LIMITS THIS. The matcher reads TITLES (see skillsForText), and the
   * archive stores no description column, so a child only exists if employers
   * name it in the title. Measured 2026-09-10 over released markets: children
   * reach 26% of Human Resources ads and 29% of Nursing ads. The rest say only
   * "HR Advisor" or "Registered Nurse", which is not a gap in the taxonomy —
   * it is the ad not saying.
   */
  parent?: string;
  terms: string[]; // lowercase substrings matched against title (+ description)
  /**
   * Titles this skill must NOT claim, however well its terms match.
   *
   * The matcher is otherwise positive-only, which works until one skill's term
   * is a strict prefix of another occupation's name. "administrator" is the
   * case that forced this: it is right for 461 of the 525 administrator ads in
   * the last 90 days (site, contract, sales, office) and wrong for the other
   * 64, every one of which is a DATABASE or SYSTEMS administrator. Deleting the
   * term to fix the 64 would have cost the 461; there was no positive term that
   * separates them, because the distinguishing word comes BEFORE the match.
   *
   * An except phrase suppresses the whole skill for that title, not just the
   * term, because a title containing "database administrator" is not partly an
   * office-support role. Both this file's matcher and the Python reader the
   * dataset generators use honour it, so the app and the whole-of-market series
   * cannot drift apart on it.
   */
  except?: string[];
}

const RAW_SKILLS: SkillDef[] = [
  // ── Mining & geoscience ────────────────────────────────────────────────
  {
    skill: "Mining Engineering",
    cat: "Mining",
    terms: ["mining engineer", "mine engineer", "mining engineering"],
  },
  {
    skill: "Geology",
    cat: "Mining",
    terms: ["geologist", "geology", "geoscience", "exploration geo", "geophysicist"],
  },
  {
    skill: "Metallurgy",
    cat: "Mining",
    terms: ["metallurg", "metallurgy", "processing plant", "mineral processing"],
  },
  {
    skill: "Drill & Blast",
    cat: "Mining",
    terms: [
      "drill and blast",
      "drill & blast",
      "blasting",
      "shotfirer",
      "drillers, miners",
      "shot firer",
    ],
  },
  {
    skill: "Surveying",
    cat: "Mining",
    terms: ["surveyor", "mine survey", "surveying", "spatial scientist"],
  },
  { skill: "Geotechnical", cat: "Mining", terms: ["geotechnical", "geotech", "ground control"] },
  {
    skill: "Underground Mining",
    cat: "Mining",
    terms: ["underground mine", "underground mining", "jumbo operator"],
  },
  {
    skill: "Fixed Plant Maintenance",
    cat: "Mining",
    terms: [
      "maintenance planner",
      "reliability engineer",
      "maintenance engineer",
      "fixed plant",
      "processing maintenance",
    ],
  },

  // ── Oil, gas & energy ──────────────────────────────────────────────────
  {
    skill: "Process Engineering",
    cat: "Energy",
    terms: [
      "processing engineer",
      "process engineer",
      "metallurgist",
      "metallurgy",
      "process engineer",
      "process engineering",
    ],
  },
  { skill: "Subsea Engineering", cat: "Energy", terms: ["subsea", "sub-sea"] },
  { skill: "Pipeline Engineering", cat: "Energy", terms: ["pipeline"] },
  { skill: "LNG Operations", cat: "Energy", terms: ["lng", "liquefied natural gas", "gas plant"] },
  {
    skill: "Drilling & Wells",
    cat: "Energy",
    terms: ["drilling", "well engineer", "wells", "petroleum engineer", "reservoir"],
  },
  {
    skill: "Hydrogen & Renewables",
    cat: "Energy",
    terms: ["hydrogen", "renewable", "solar", "wind farm", "electrolyser"],
  },
  {
    skill: "Decarbonisation",
    cat: "Energy",
    terms: ["decarbon", "net zero", "emissions reduction", "carbon capture"],
  },
  {
    skill: "Electrical Engineering",
    cat: "Engineering",
    terms: ["electrical engineer", "electrical engineering", "high voltage", "hv "],
  },
  {
    skill: "Mechanical Engineering",
    cat: "Engineering",
    terms: [
      "mechanical engineer",
      "mechanical engineering",
      "rotating equipment",
      "industrial, mechanical",
      "production engineer",
    ],
  },
  {
    skill: "Civil Engineering",
    cat: "Engineering",
    terms: ["civil engineer", "civil engineering", "structural engineer"],
  },
  {
    skill: "Instrumentation & Control",
    cat: "Engineering",
    terms: ["instrumentation", "control systems", "e and i", "plc", "scada"],
  },

  // ── Trades & operations ────────────────────────────────────────────────
  // Named as skills/capabilities, not occupations: the match terms still key off
  // the job titles that appear in postings (e.g. "Diesel Mechanic"), but the
  // canonical skill they map to is the underlying capability.
  {
    skill: "Heavy Diesel Maintenance",
    cat: "Trades",
    terms: ["diesel mechanic", "heavy diesel", "hd fitter", "plant mechanic"],
  },
  {
    skill: "Welding & Fabrication",
    cat: "Trades",
    terms: [
      "boilermaker",
      "welder",
      "welding",
      "fabricator",
      "sheetmetal",
      "structural steel and welding",
    ],
  },
  {
    skill: "Electrical Trade",
    cat: "Trades",
    terms: ["electrician", "electrical trade", "a grade electric", "electrical distribution"],
  },
  {
    skill: "Mechanical Fitting",
    cat: "Trades",
    terms: [
      "mechanical fitter",
      "fitter and turner",
      "maintenance fitter",
      "metal fitter",
      "machinist",
      "precision metal",
      "toolmaker",
      "metal casting",
    ],
  },
  {
    skill: "Plant & Equipment Operation",
    cat: "Trades",
    terms: [
      "plant operator",
      "haul truck",
      "dump truck",
      "excavator",
      "dozer",
      "loader",
      "earthmoving",
      "crane, hoist",
      "mobile plant",
      "stationary plant",
    ],
  },
  {
    skill: "Rigging & Scaffolding",
    cat: "Trades",
    terms: ["rigger", "scaffolder", "scaffolding", "dogman"],
  },

  // ── HSE & quality ──────────────────────────────────────────────────────
  {
    skill: "HSE / Safety",
    cat: "Safety",
    terms: [
      "hse",
      "health and safety",
      "safety advisor",
      "safety officer",
      "whs",
      "ohs",
      "safety inspector",
      "occupational and environmental health",
    ],
  },
  {
    skill: "Environmental",
    cat: "Safety",
    terms: ["environmental", "environment advisor", "rehabilitation", "tailings"],
  },
  {
    skill: "Risk & Compliance",
    cat: "Safety",
    terms: [
      "risk",
      "compliance",
      "assurance",
      "governance",
      "regulatory officer",
      "inspectors and regulatory",
    ],
  },
  {
    skill: "Quality Assurance",
    cat: "Safety",
    terms: ["quality assurance", "qa/qc", "quality control", "quality controller"],
  },
  { skill: "Radiation Safety", cat: "Safety", terms: ["radiation", "radiological"] },

  // ── Data, digital & automation ─────────────────────────────────────────
  {
    skill: "Data Analytics",
    cat: "Digital",
    terms: [
      "data analyst",
      "data analytics",
      "power bi",
      "analytics",
      "sql",
      "systems analyst",
      "business and systems",
    ],
  },
  {
    skill: "Data Science & Machine Learning",
    cat: "Digital",
    terms: ["data scien", "machine learning", "ml engineer", "ai "],
  },
  {
    // Distinct from Data Analytics (who reads the data) and Data Science (who
    // models it): this is who builds the pipelines and warehouses. Kept as its
    // own skill rather than folded into analytics because the hiring markets
    // are genuinely different, and folding would make "analytics demand" a
    // number covering three jobs.
    skill: "Data Engineering",
    cat: "Digital",
    terms: [
      "data engineer",
      "data platform",
      "data pipeline",
      "data warehouse",
      "etl developer",
      "analytics engineer",
      // ── The statistical agencies' name for this work ────────────────────
      // No official classification has an occupation called "data engineer";
      // the job is counted under the database/systems administration unit
      // group. Without these terms the skill matched job ADS only, so every
      // whole-of-market series (JSA IVI, ONS, OEWS, Eurostat, PSA) showed it
      // as no reading at all. Each term below is the literal published title
      // of that group, so it matches the release and nothing else:
      //
      //   ANZSCO 2621  Database and Systems Administrators, and ICT Security
      //                Specialists                         — AU (JSA), NZ
      //   US SOC 15-1242 Database Administrators           — US (BLS OEWS)
      //   US SOC 15-1243 Database Architects               — US (BLS OEWS)
      //   ISCO-08  252 Database and network professionals  — EU, PH (PSOC)
      //
      // ANZSCO 2621 and ISCO 252 both carry systems administrators and
      // network/security specialists alongside the database roles, so this
      // skill keeps firing on the same title as IT & Systems and
      // Cybersecurity. That is the existing convention (one occupation, every
      // skill it genuinely covers), not double counting within a skill.
      "database and systems administrator",
      "database administrator",
      "database designer",
      "database architect",
      // "database architect" was here; "data architect" was not, and the 15
      // archived rows spelling it that way went to Architecture & Planning.
      "data architect",
      "database and network",
    ],
  },
  {
    // A business analyst elicits requirements and models process; the overlap
    // with Data Analytics is real but partial, which is why "systems analyst"
    // stays there and this is separate. Both can fire on one title, and that is
    // correct — a "Business Systems Analyst" is both.
    skill: "Business Analysis",
    cat: "Corporate",
    terms: [
      "business analyst",
      "business analysis",
      "process analyst",
      // A process architect designs business processes. Six archived rows, all
      // of which were landing in Architecture & Planning.
      "process architect",
      "requirements analyst",
      "product owner",
      "business partner",
      // ── The statistical agencies' name for this work ────────────────────
      // Same problem as Data Engineering above: "business analyst" is what an
      // ad says, not what a classification calls the occupation, so the
      // official releases fell through and the skill had no whole-of-market
      // reading anywhere. The published unit-group titles:
      //
      //   ANZSCO 2611  ICT Business and Systems Analysts   — AU (JSA), NZ
      //   US SOC 15-1211 Computer Systems Analysts         — US (BLS OEWS)
      //
      // UK SOC 2020 2133 already matches on "business analyst" ("IT business
      // analysts, architects and systems designers"), so it needs no term.
      //
      // Eurostat's occupation release is ISCO 3-digit, where analysts sit
      // inside 251 "Software and applications developers and analysts"
      // alongside every software developer. Mapping that whole group here
      // would credit business analysis with the EU's entire software
      // workforce, so it is deliberately left unmapped — the granularity
      // Eurostat publishes cannot isolate the occupation.
      "business and systems analyst",
      "computer systems analyst",
      // ISCO-08 2511 "Systems analysts" is the group business analysts belong
      // to, and the Philippines (PSOC) publishes at 4-digit, so there the
      // occupation is isolatable — which is exactly what Eurostat's 3-digit
      // release is not. Data Analytics keeps the title too: a systems analyst
      // reads data and models process, and both readings are true.
      "systems analyst",
    ],
  },
  {
    skill: "Software Engineering",
    cat: "Digital",
    terms: [
      "software engineer",
      // 14 archived rows, all of which were Architecture & Planning before the
      // IT architects were untangled on 2026-09-12.
      "software architect",
      "developer",
      "full stack",
      "python",
      "java",
      "react",
      "programmer",
      "multimedia",
    ],
  },
  {
    skill: "Cloud & DevOps",
    cat: "Digital",
    terms: ["cloud", "aws", "azure", "devops", "kubernetes"],
  },
  {
    skill: "Cybersecurity",
    cat: "Digital",
    // "security architect" earns its place here rather than in IT & Systems:
    // it is the one architect form whose subject matter is a skill of its own.
    // "cyber security architect" already matched on "cyber"; the bare-security
    // spelling did not, and its 19 archived rows went to Architecture & Planning.
    terms: [
      "cyber",
      "security engineer",
      "security architect",
      // Spelled out separately because terms are prefix-anchored substrings and
      // "security architect" is not one of "security solution architect" — 10
      // archived rows. Those titles also match IT & Systems on "solution
      // architect", which is correct: they are both.
      "security solution architect",
      "infosec",
      "ict security",
    ],
  },
  {
    skill: "Automation & Robotics",
    cat: "Digital",
    terms: ["automation", "autonomous", "robotics", "remote operations"],
  },
  {
    skill: "IT & Systems",
    cat: "Digital",
    terms: [
      "it support",
      "systems administrator",
      // The singular, and the two other administrator roles that are IT and not
      // office administration. Found by re-mapping the archive against this
      // file: 62 rows lost "Administration & Office Support" — correctly, a
      // database administrator is not an office administrator — but 30 of them
      // then matched nothing at all, because only the PLURAL was listed here.
      // "System Administrator", "Database Administrator" and "Network
      // Administrator" all appear in the archive and all went unmapped.
      "system administrator",
      "database administrator",
      "network administrator",
      "sysadmin",
      "sap",
      "erp",
      "network engineer",
      "ict support",
      "ict manager",
      "computer network",
      "database and systems",
      "ict support and test",
      "telecommunications engineering",
    ],
  },

  // ── Corporate & commercial ─────────────────────────────────────────────
  {
    skill: "Project Management",
    cat: "Corporate",
    terms: [
      "cost management",
      "cost control",
      "cost controller",
      "cost engineer",
      "cost estimator",
      "project controls",
      "project delivery",
      "planning and scheduling",
      "planning & scheduling",
      "scheduler",
      "project planner",
      "project engineer",
      "project manager",
      "project management",
      "project engineer",
      "pmo",
      "program and project",
      "project administrat",
      // The public-sector spelling of the same job, and the largest single
      // unmapped shape in the archive: 202 rows on 2026-08-09 carrying no skill
      // at all ("Senior Project Officer" 31, "Project Officer" 30, "Principal
      // Project Officer" 12, then a long tail of one-offs). Every state and
      // federal agency grades this role rather than calling it a manager, so
      // "project manager" reached almost none of them.
      "project officer",
      // Both written separately because terms match at the start of a word and
      // then literally: "project officer" is not inside "projects officer"
      // (4 rows) and neither is inside "project support officer" (23) — the
      // support grade of the same function, alongside "project administrat"
      // just above.
      "projects officer",
      "project support officer",
    ],
  },
  {
    skill: "Finance & Accounting",
    cat: "Corporate",
    terms: [
      "accountant",
      "finance",
      "financial analyst",
      "cfo",
      "tax",
      "auditor",
      "company secretar",
      "treasurer",
      "economist",
      // FP&A — corporate financial planning and analysis, which is this skill
      // and not the retail wealth advice that "financial planner" names. These
      // were landing on Banking & Lending instead, because its "financial
      // plann" term catches "planning" as well as "planner": measured on the
      // archive, 86 rows match one of these spellings and all but three are the
      // corporate function ("FP&A Analyst", "Director, FP&A ANZ", "Manager,
      // Financial Planning & Analysis"). See the note on Banking & Lending.
      //
      // norm() rewrites "&" as " and " BEFORE matching, so the term for "FP&A"
      // has to be written the way the haystack will read: "fp and a".
      "financial planning",
      "fp and a",
      "fpa",
      // "audit", not just "auditor". Surfaced while adding the Audit
      // speciality below, which could not fire on titles the PARENT did not
      // recognise: measured on the archive, 477 distinct titles containing
      // "audit" but never the word "auditor" — "Audit Manager", "Internal
      // Audit Manager", "Audit Associate", "Associate Partner - Audit" — over
      // 704 rows, and most of them were carrying NO skill at all. That is 704
      // rows of audit demand the product could not see.
      //
      // The cost is an audit of something other than the accounts, taken back
      // by the except below. "auditorium" does not appear in the archive at
      // all, so the left anchor needs no help there.
      "audit",
    ],
    except: [
      // An audit of a ward, a worksite or an energy bill is not accounting
      // work, and each of these suppresses the skill for the whole title —
      // right, because none of them is partly a finance role.
      //
      // Measured before adding them: clinical, energy and environmental audits
      // map to Finance & Accounting on NO rows today, so those three are
      // purely preventive against the new "audit" term. Safety and quality
      // audits do match 8 rows today, through "auditor", and those 8 are
      // wrong for the same reason the others would be.
      //
      // "night audit" is deliberately NOT here. A hotel night auditor really
      // does reconcile the day's accounts, it maps to this skill on 19 rows
      // today, and taking that away would be a regression rather than a fix.
      // It is excepted on the Audit speciality instead, which is the narrower
      // claim it should not make.
      "clinical audit",
      "safety audit",
      "quality audit",
      "energy audit",
      "environmental audit",
    ],
  },
  // ── Finance & Accounting · specialities ────────────────────────────────
  //
  // Counts over RELEASED MARKETS on 2026-09-10 — 2,788 distinct titles / 4,704
  // rows. Children reach 20% of the parent; the rest are "Finance Manager" and
  // "Financial Accountant"-adjacent titles that name no function beyond finance.
  //
  // Not minted, for want of evidence: Treasury (23 titles) and Accounts Payable
  // & Receivable (14) — the latter is thin here because those roles resolve to
  // the broad Bookkeeping & Payroll skill instead, which is where they belong.
  {
    skill: "Taxation",
    cat: "Corporate",
    parent: "Finance & Accounting",
    // 143 titles, 7.0%. Spelled out rather than the parent's bare "tax", which
    // is also on "tax-free", "taxi" is excluded by the left anchor, and which
    // as a child term would claim every finance title mentioning tax at all.
    terms: [
      "taxation",
      "tax advisory",
      "tax manager",
      "tax accountant",
      "tax consultant",
      "corporate tax",
      "tax analyst",
      "tax specialist",
    ],
  },
  {
    skill: "Management Accounting",
    cat: "Corporate",
    parent: "Finance & Accounting",
    // 100 titles, 4.7%. The inward-facing half of the profession — planning,
    // costing and commercial analysis — against Financial Accounting's
    // outward-facing statutory reporting.
    terms: [
      "management accountant",
      "cost accountant",
      "commercial analyst",
      "fp and a",
      "financial planning and analysis",
    ],
  },
  {
    skill: "Audit",
    cat: "Corporate",
    parent: "Finance & Accounting",
    // 93 titles, 4.3%. Internal and external both: the archive does not
    // separate them often enough to carry two children.
    //
    // One term does it. "audit" anchors the start of a word so it takes
    // "auditor", "auditing" and "audit manager" alike, and the parent gate
    // plus the parent's except have already ruled out the audits that are not
    // of accounts. Listing the spellings separately only invited a gap: the
    // first draft had five and still missed "Audit Associate".
    terms: ["audit"],
    // The parent keeps its hotel night auditors — see the note there — but
    // reconciling a hotel's takings overnight is not the audit profession.
    except: ["night audit"],
  },
  {
    skill: "Financial Accounting",
    cat: "Corporate",
    parent: "Finance & Accounting",
    // 58 titles, 3.4%.
    terms: ["financial accountant", "financial reporting", "statutory report", "group accountant"],
  },
  {
    skill: "Procurement & Supply",
    cat: "Corporate",
    terms: ["procurement", "supply chain", "contracts", "logistics", "supply, distribution"],
  },
  {
    skill: "Human Resources",
    cat: "Corporate",
    terms: [
      "human resources",
      "human resource",
      "hr ",
      "people and culture",
      "recruit",
      "talent",
      "training and development",
      "learning and development",
      "workforce",
      "employee relations",
      "industrial relations",
    ],
  },
  // ── Human Resources · specialities ─────────────────────────────────────
  //
  // Children of the skill above; see `parent` on SkillDef for the rule. Each
  // one was mined from the archive's own titles rather than from an idea of
  // what HR contains, and each clears the evidence floor check-skills.ts
  // enforces. Shares and title counts below are over RELEASED MARKETS on
  // 2026-09-10, which is 3,613 distinct HR titles / 4,858 rows.
  //
  // Not minted, for want of evidence: Remuneration & Benefits (18 titles),
  // Diversity & Inclusion (7), WHS / Injury Management (3). They are real
  // specialities that Australian employers mostly do not put in a title.
  {
    skill: "Talent Acquisition",
    cat: "Corporate",
    parent: "Human Resources",
    // 491 titles, 14.3% of HR — by a distance the largest speciality.
    // "talent acquisition" spelled out rather than the parent's bare "talent",
    // which also catches "Talent Pool"/"Talent Community" registers — 6.1% of
    // the parent, and mostly advertising train drivers and process operators.
    terms: ["talent acquisition", "recruit", "resourcing", "sourcing specialist", "talent scout"],
  },
  {
    skill: "Employee Relations",
    cat: "Corporate",
    parent: "Human Resources",
    // 81 titles, 3.7%.
    terms: [
      "employee relations",
      "industrial relations",
      "workplace relations",
      "employment relations",
      "enterprise bargaining",
    ],
  },
  {
    skill: "Learning & Development",
    cat: "Corporate",
    parent: "Human Resources",
    // 76 titles, 2.4%.
    terms: [
      "learning and development",
      "training and development",
      "instructional design",
      "capability development",
      "learning designer",
      "organisational development",
      "organizational development",
    ],
  },
  {
    skill: "Workforce Planning",
    cat: "Corporate",
    parent: "Human Resources",
    // 83 titles, 2.7%. Stems, not the parent's bare "workforce", which is on
    // every "workforce services" and "workforce administration" title.
    terms: [
      "workforce plan",
      "workforce analy",
      "workforce strateg",
      "workforce management",
      "workforce insight",
    ],
  },
  {
    skill: "HR Systems",
    cat: "Corporate",
    parent: "Human Resources",
    // 63 titles, 1.8% — thin, and named here because the platforms are what
    // employers actually write. Products are listed individually because a
    // title says "Workday" or "Aurion" far more often than "HR system".
    terms: [
      "hris",
      "hrms",
      "hr system",
      "people system",
      "workday",
      "successfactors",
      "success factors",
      "chris21",
      "aurion",
      "preceda",
      "peoplesoft",
      "hr technology",
      "hr information",
      "hr data",
      "people analytics",
      "hr analytics",
      "hr operations",
    ],
  },
  // NO PAYROLL CHILD, though the evidence was there (57 titles, 1.4%). The
  // taxonomy already carries "Bookkeeping & Payroll" as a broad skill under
  // Admin, on the identical term, so minting this would have been one concept
  // under two names — and an HR payroll title already resolves through it.
  // Duplication like that is what SKILL_ALIAS exists to clean up after; better
  // not to create it.
  {
    skill: "Commercial & Legal",
    cat: "Corporate",
    terms: [
      "commercial",
      "legal",
      // "legal" cannot reach it: terms match only at the START of a word, so
      // the stem is buried inside "paralegal" and 11 archived paralegal rows
      // mapped to nothing. This is the compound cost termMatches warns about,
      // paid off one measured term at a time.
      "paralegal",
      "lawyer",
      "counsel",
      "contract administrat",
      "solicitor",
      "barrister",
      "conveyancer",
      "legal executive",
    ],
    except: [
      // "counsel" matches the start of "counsellor", so student, mental-health
      // and sexual-assault counsellors were being read as legal roles: measured
      // on released markets, 199 distinct titles over 230 rows, 8.7% of this
      // skill. None of them is partly a commercial or legal job.
      //
      // Safe to suppress outright, because these titles already carry Mental
      // Health & Counselling on its own "counsellor" term — checked before
      // adding this, so the except moves them rather than stranding them.
      "counsellor",
      "counselling",
      "counselor",
      "counseling",
    ],
  },
  // ── Commercial & Legal · specialities ──────────────────────────────────
  //
  // Counts over RELEASED MARKETS on 2026-09-12 — 2,289 distinct titles.
  // Contract Management is not minted: 28 titles, and "contract administrat"
  // is already a term on the parent.
  {
    skill: "Legal Practice",
    cat: "Corporate",
    parent: "Commercial & Legal",
    // 286 titles. Private practice and litigation, against the in-house role
    // below — the two halves of the profession employers advertise for.
    terms: ["solicitor", "lawyer", "law clerk", "litigation"],
  },
  {
    skill: "In-house Counsel",
    cat: "Corporate",
    parent: "Commercial & Legal",
    // 136 titles.
    terms: ["legal counsel", "general counsel", "in house counsel", "group counsel"],
  },
  {
    skill: "Paralegal & Support",
    cat: "Corporate",
    parent: "Commercial & Legal",
    // 86 titles.
    terms: ["paralegal", "legal assistant", "legal secretary", "legal support"],
  },
  {
    skill: "Marketing & Comms",
    cat: "Corporate",
    terms: ["marketing", "communications", "brand", "content", "advertising", "public relations"],
  },
  // ── Marketing & Comms · specialities ───────────────────────────────────
  //
  // Counts over RELEASED MARKETS on 2026-09-12 — 6,085 distinct titles, the
  // second most varied parent in the taxonomy. Marketing Automation is not
  // minted at 15 titles: employers here name the platform, not the discipline.
  {
    skill: "Communications & PR",
    cat: "Corporate",
    parent: "Marketing & Comms",
    // 466 titles. "communications" anchors the start of a word, so it cannot
    // reach inside "telecommunications" — that stays its own broad skill.
    terms: ["communications", "public relations", "media relations", "corporate affairs"],
  },
  {
    skill: "Events",
    cat: "Corporate",
    parent: "Marketing & Comms",
    // 365 titles.
    terms: ["events", "event manager", "event coordinator", "conference producer"],
  },
  {
    skill: "Brand Marketing",
    cat: "Corporate",
    parent: "Marketing & Comms",
    // 183 titles. The qualified forms, not the parent's bare "brand", which is
    // on every "brand ambassador" and in-store promotions title.
    terms: ["brand manager", "brand marketing", "brand strateg", "brand lead", "brand director"],
  },
  {
    skill: "Content & Social",
    cat: "Corporate",
    parent: "Marketing & Comms",
    // 115 titles.
    terms: [
      "content marketing",
      "social media",
      "copywriter",
      "content creator",
      "content producer",
    ],
  },
  {
    skill: "Digital Marketing",
    cat: "Corporate",
    parent: "Marketing & Comms",
    // 105 titles.
    terms: [
      "digital marketing",
      "performance marketing",
      "growth marketing",
      "seo ",
      "paid media",
      "paid search",
      "search engine market",
    ],
  },
  {
    skill: "Sales & Business Dev",
    cat: "Corporate",
    terms: [
      "business development",
      "account manager",
      "account executive",
      "sales representative",
      "sales manager",
      "technical sales",
      // 154 unmapped rows on 2026-08-09 — "Sales Executive" 56 on its own, then
      // qualified forms (B2B, Agency, Vehicle, Conference & Events, Wagering).
      // "account executive" above never reached them and "sales manager" only
      // catches the grade above.
      //
      // The TRUNCATED stem is deliberate. A term matches at a word start and
      // then literally, so "sales exec" covers "Sales Executive" AND the
      // abbreviated forms ("Sales Exec - QT Parramatta", "B2B Sales Execs")
      // that a full-word term would miss. norm() leaves punctuation alone, so
      // "Sales - Executive Admin Assistant" — an EA sitting in a sales team —
      // keeps its separator and is NOT swept in.
      //
      // What it does also catch, checked against all 79,831 distinct titles in
      // the archive rather than assumed: three "Marketing Manager Sales
      // Execution" rows. Those are commodity-marketing roles and they already
      // carry Marketing & Comms; gaining Sales & Business Dev as well is a fair
      // reading of route-to-market work, so the stem is kept. It is written
      // down because it is the one thing here that is a judgement rather than a
      // match, and the next person to widen this term should know it is already
      // reaching a word other than "executive".
      "sales exec",
    ],
  },
  {
    skill: "General Management",
    cat: "Corporate",
    terms: [
      "chief executive",
      "managing director",
      "general manager",
      "corporate services manager",
      "other specialist manager",
      "production manager",
      "engineering manager",
      "policy and planning manager",
    ],
  },
  {
    skill: "Leadership & Coordination",
    cat: "Corporate",
    terms: [
      "team leader",
      "coordinator",
      "co-ordinator",
      "director of",
      "deputy director",
      "executive director",
      "head of",
      "operations manager",
      "service manager",
      "branch manager",

      // Generic supervisory titles: 110 unmapped rows.
      "team manager",
      "assistant manager",
      "shift manager",
      "supervisor",
    ],
  },
  {
    skill: "Policy & Programs",
    cat: "Public Sector",
    terms: [
      "policy officer",
      "policy adviser",
      "policy advisor",
      "policy analyst",
      "senior policy",
      "program officer",
      "program adviser",
      "program advisor",
      "program coordinator",
      "program manager",
      "ministerial",
      "cabinet",
      "governance officer",
      "planning officer",
      "principal adviser",
      "senior program",
    ],
  },
  {
    skill: "Community & Native Title",
    cat: "Corporate",
    terms: [
      "community relations",
      "stakeholder",
      "native title",
      "indigenous engagement",
      "heritage",
    ],
  },

  // ── Administration & clerical ──────────────────────────────────────────
  {
    skill: "Administration & Office Support",
    cat: "Admin",
    terms: [
      "clerk",
      "administrator",
      "administration officer",
      "administrative officer",
      "administration assistant",
      "business support officer",
      "operational services",
      "receptionist",
      "office manager",
      "secretary",
      "personal assistant",
      "executive assistant",
      "keyboard operator",
      "information officer",
      "call or contact centre",
      "call centre",
      "switchboard",
      "mail sorter",
      "filing",
      "practice manager",
      "survey interviewer",
    ],
    // "administrator" is the office kind almost everywhere — measured on the
    // live archive, 461 of 525 in 90 days. The exceptions are all one family:
    // the ICT administrator. Without these, ANZSCO 2621 ("Database and Systems
    // Administrators, and ICT Security Specialists") and UK SOC 2020's
    // "Database administrators and web content technicians" both landed here,
    // so office-support demand in every country carried the database
    // administrators of that country.
    except: [
      "database administrator",
      "database and systems administrator",
      // PSOC/ISCO 2521 is "Database Designers and Administrators" — the same
      // occupation, a phrasing none of the lines above reach. Found in the
      // Philippine ISLE tables, where it was landing here and NOWHERE else.
      "database designer",
      "systems administrator",
      "system administrator",
      "network administrator",
      "server administrator",
    ],
  },
  {
    skill: "Bookkeeping & Payroll",
    cat: "Admin",
    terms: ["bookkeeper", "payroll", "accounting clerk", "accounts clerk"],
  },
  {
    skill: "Library & Information",
    cat: "Admin",
    terms: [
      "librarian",
      "library",
      "archivist",
      "records officer",
      "records management",
      "information management",
    ],
  },

  // ── Financial services ─────────────────────────────────────────────────
  {
    skill: "Banking & Lending",
    cat: "Financial",
    terms: [
      "banking",
      "bank worker",
      "lending",
      "credit",
      "mortgage",
      "loans",
      "financial broker",
      "financial dealer",
      "financial investment",
      "debt collector",

      // 47 unmapped "financial advisor" rows plus wealth variants.
      "financial advis",
      // "financial planNER", not "financial planN": the planner is the person
      // giving retail advice, the planning is the corporate budgeting function,
      // and the broader stem swept the second into this skill. It put
      // "Senior Financial Planning and Analysis (FP&A) Analyst" at a copper
      // miner under Banking & Lending, which is where this was noticed, and it
      // did the same to every FP&A title in the archive. Measured: 86 rows
      // match "financial plann" or an FP&A spelling and only three are wealth
      // roles — two "Financial Planner" and one "Financial Planning & Wealth
      // Management Consultant", the last of which still lands here on "wealth".
      "financial planner",
      "wealth",
    ],
  },
  // ── Banking & Lending · specialities ───────────────────────────────────
  //
  // Which side of a bank, which is how these roles are advertised and paid.
  // Counts over RELEASED MARKETS on 2026-09-12 — 2,036 distinct titles.
  {
    skill: "Wealth & Private Banking",
    cat: "Financial",
    parent: "Banking & Lending",
    // 299 titles, the largest here.
    terms: ["wealth", "private bank", "private client", "investment adviser"],
  },
  {
    skill: "Business Banking",
    cat: "Financial",
    parent: "Banking & Lending",
    // 141 titles.
    terms: ["business banking", "commercial banking", "institutional banking", "corporate banking"],
  },
  {
    skill: "Retail Banking",
    cat: "Financial",
    parent: "Banking & Lending",
    // 123 titles. "branch manager" is deliberately absent: it is already a term
    // on Leadership & Coordination, and measured on the archive it adds nothing
    // here — 125 titles with it, 125 without — so it would have been pure
    // duplication for no coverage.
    terms: ["teller", "personal banker", "customer banking", "retail banking"],
  },
  {
    skill: "Mortgage & Home Lending",
    cat: "Financial",
    parent: "Banking & Lending",
    // 99 titles.
    terms: ["mortgage", "home loan", "home lending", "lending specialist"],
  },
  {
    skill: "Credit Analysis",
    cat: "Financial",
    parent: "Banking & Lending",
    // 91 titles. The qualified forms, not the parent's bare "credit", which is
    // also on every "credit card" and "credit control" title.
    terms: ["credit analyst", "credit manager", "credit risk", "credit assessor", "credit officer"],
  },
  {
    skill: "Insurance & Actuarial",
    cat: "Financial",
    terms: [
      "insurance agent",
      "insurance clerk",
      "loss adjuster",
      "actuar",
      "insurance investigator",
      "insurance, money market",

      // 96 unmapped rows across insurance planner / wealth protection.
      "insurance planner",
      "insurance consultant",
      "wealth protection",
    ],
  },
  {
    skill: "Real Estate & Property",
    cat: "Property",
    terms: [
      "real estate",
      "property manager",
      "valuer",
      "land economist",
      "auctioneer",
      "stock and station",
    ],
  },

  // ── Health & care ──────────────────────────────────────────────────────
  {
    skill: "Nursing",
    cat: "Health",
    terms: [
      "registered nurse",
      "enrolled nurse",
      "nurse ",
      "nursing",
      "midwife",
      "midwives",
      "nurse manager",
      "nurse educator",
    ],
  },
  // ── Nursing · specialities ─────────────────────────────────────────────
  //
  // Children of the skill above. Mined over RELEASED MARKETS on 2026-09-10 —
  // 5,046 distinct titles / 6,509 rows — deliberately excluding the US, where
  // "travel nurse" agency postings are 16% of the parent and would have shaped
  // every child around a hiring mode that does not exist here.
  //
  // Not minted, for want of evidence: Community Nursing (14 titles), Mental
  // Health Nursing (30, and Mental Health & Counselling already covers it as a
  // top-level skill), Medical Imaging Nursing (21).
  {
    skill: "Midwifery",
    cat: "Health",
    parent: "Nursing",
    // 449 titles, 8.4% — the largest by some way. "midwif" is a stem so it
    // takes midwife, midwifery and midwifery-led.
    terms: ["midwif", "midwive", "birth suite", "obstetric nurse"],
  },
  {
    skill: "Perioperative Nursing",
    cat: "Health",
    parent: "Nursing",
    // 188 titles, 4.1%. Anaesthetics and recovery sit here rather than in a
    // child of their own: they are stages of the same theatre pathway, and
    // splitting them left both under the floor.
    terms: [
      "periopera",
      "theatre nurse",
      "operating theatre",
      "scrub scout",
      "anaesthe",
      "recovery nurse",
      "pacu",
    ],
  },
  {
    skill: "Critical Care Nursing",
    cat: "Health",
    parent: "Nursing",
    // 142 titles, 3.0%.
    terms: ["intensive care", "critical care", "coronary care", "high dependency", "icu"],
  },
  {
    skill: "Nurse Education",
    cat: "Health",
    parent: "Nursing",
    // 157 titles, 2.8%.
    terms: [
      "nurse educator",
      "nursing educator",
      "clinical educator",
      "clinical facilitator",
      "nurse education",
    ],
  },
  {
    skill: "Oncology & Palliative Nursing",
    cat: "Health",
    parent: "Nursing",
    // 144 titles, 2.7%. One child rather than two because palliative nursing
    // alone did not clear the floor and the two share wards and rosters here.
    terms: ["oncolog", "chemotherapy", "palliative", "haematology nurse"],
  },
  {
    skill: "Emergency Nursing",
    cat: "Health",
    parent: "Nursing",
    // 118 titles, 2.5%.
    terms: ["emergency department", "emergency nurse", "triage nurse", "emergency registered"],
  },
  {
    skill: "Aged Care Nursing",
    cat: "Health",
    parent: "Nursing",
    // 125 titles, 2.0%. "nursing home" was a term here and is deliberately
    // gone: it names the WORKPLACE, not the speciality, and was claiming an
    // "HR Generalist (nursing home)" and an "Operations Executive (nursing
    // home)" as nursing specialists.
    terms: ["aged care", "residential aged", "geriatric"],
  },
  {
    skill: "Nurse Practitioner",
    cat: "Health",
    parent: "Nursing",
    // 96 titles, 1.9%. A scope of practice rather than a ward, but employers
    // advertise it as the role, which is what this taxonomy follows.
    terms: ["nurse practitioner"],
  },
  {
    skill: "Paediatric Nursing",
    cat: "Health",
    parent: "Nursing",
    // 92 titles, 1.5%. Both spellings: the archive carries US-sourced rows.
    terms: ["paediatric", "pediatric", "neonatal", "nicu", "child health nurse"],
  },
  {
    skill: "Renal Nursing",
    cat: "Health",
    parent: "Nursing",
    // 78 titles, 1.4%.
    terms: ["renal", "dialysis", "nephrolog"],
  },
  {
    skill: "Surgical Nursing",
    cat: "Health",
    parent: "Nursing",
    // 40 titles, 0.8% — exactly on the floor, and kept for that reason rather
    // than in spite of it: the floor is where the evidence stops being enough.
    // Deliberately narrow terms, because a bare "surgical" is on most theatre
    // and ward titles and would have swallowed Perioperative.
    terms: ["surgical ward", "surgical nurse", "orthopaedic nurse", "ortho nurse"],
  },
  {
    skill: "Medical Practice",
    cat: "Health",
    terms: [
      "general practitioner",
      "medical practitioner",
      "resident medical",
      "physician",
      "surgeon",
      "anaesthetist",
      "psychiatrist",
      "medical officer",
    ],
  },
  // ── Medical Practice · specialities ────────────────────────────────────
  //
  // The smallest parent to carry children — 638 distinct titles over released
  // markets on 2026-09-12 — and the best covered, at 57%: a doctor's ad names
  // the specialty because the registration does.
  //
  // Not minted, for want of evidence: Surgery (36 titles, four short of the
  // floor), Anaesthetics (29) and Registrar & Resident (23). All three are
  // already terms on the parent, so the demand is counted, just not split out.
  {
    skill: "Visiting Medical Officer",
    cat: "Health",
    parent: "Medical Practice",
    // 170 titles, 27% of the parent on its own. An appointment type rather than
    // a specialty, and it is here because it is what these ads say: a VMO is a
    // doctor contracted to a hospital rather than employed by it, and public
    // health services advertise the arrangement in the title.
    terms: ["visiting medical"],
  },
  {
    skill: "General Practice",
    cat: "Health",
    parent: "Medical Practice",
    // 76 titles. "gp " with the trailing space is the abbreviation as a whole
    // word — without it the stem would reach into "gpo" and "gps".
    terms: ["general practitioner", "gp ", "vr gp", "general practice"],
  },
  {
    skill: "Psychiatry",
    cat: "Health",
    parent: "Medical Practice",
    // 64 titles. UNDER MEDICAL PRACTICE, not Mental Health & Counselling,
    // which was the other candidate: measured before choosing, "Psychiatrist"
    // maps only to Medical Practice, because Mental Health's terms are
    // counsellor / psycholog / mental health and none of them reaches it. A
    // psychiatrist is a doctor, and the archive words it that way.
    terms: ["psychiatr"],
  },
  {
    skill: "Allied Health",
    cat: "Health",
    terms: [
      "physiotherap",
      "occupational therap",
      "podiatr",
      "speech pathol",
      "audiolog",
      "optometr",
      "orthopt",
      "chiropract",
      "osteopath",
      "dietit",
      "nutrition",
      "massage therap",
      "diversional therap",
      "allied health",
      "health practitioner",
      "exercise physiolog",
      "sonographer",
    ],
  },
  // ── Allied Health · specialities ───────────────────────────────────────
  //
  // The best-named parent in the taxonomy: allied health professions are
  // registered titles, so employers write them exactly. Children reach 62% of
  // the parent's ads, against 26-29% for HR and Nursing.
  //
  // Counts over RELEASED MARKETS on 2026-09-10 — 1,830 distinct titles / 2,394
  // rows. The terms restate the parent's, which is normal for a child: the
  // parent needs them to recognise an allied-health title at all, and the child
  // needs them to say which profession it is.
  //
  // Not minted, for want of evidence: Podiatry (39 titles, one short of the
  // floor and left out for that reason), Exercise Physiology (37), Audiology
  // (13), Music & Art Therapy (9), Orthotics & Prosthetics (1).
  //
  // NO SOCIAL WORK CHILD, though it measured 78 titles here. "Social &
  // Community Services" already carries the term "social work" as a broad
  // skill, and a Social Worker title resolves there today — minting this would
  // have been one concept under two names, the same trap that kept Payroll out
  // from under Human Resources.
  {
    skill: "Occupational Therapy",
    cat: "Health",
    parent: "Allied Health",
    // 432 titles, 23.7% — the largest speciality anywhere in the taxonomy.
    terms: ["occupational therap"],
  },
  {
    skill: "Physiotherapy",
    cat: "Health",
    parent: "Allied Health",
    // 386 titles, 22.4%. "physio " with the trailing space is the abbreviation
    // as a whole word; without it the stem already covers physiotherapist.
    terms: ["physiotherap", "physio "],
  },
  {
    skill: "Speech Pathology",
    cat: "Health",
    parent: "Allied Health",
    // 152 titles, 8.8%. Three namings of one profession: Australia says speech
    // pathologist, other markets say speech therapist or speech-language.
    terms: ["speech patholog", "speech therap", "speech language"],
  },
  {
    skill: "Dietetics & Nutrition",
    cat: "Health",
    parent: "Allied Health",
    // 123 titles, 6.4%.
    terms: ["dietit", "dietic", "nutritionist"],
  },
  { skill: "Dental", cat: "Health", terms: ["dental", "dentist", "orthodont"] },
  { skill: "Pharmacy", cat: "Health", terms: ["pharmacist", "pharmacy"] },
  {
    skill: "Medical Imaging & Pathology",
    cat: "Health",
    terms: [
      "medical imaging",
      "radiograph",
      "sonograph",
      "medical laborator",
      "medical technician",
      "pathology",

      // 66 unmapped rows, all Sonic/pathology collectors.
      "phlebotom",
    ],
  },
  {
    skill: "Aged & Disability Care",
    cat: "Care",
    terms: [
      "aged and disabled",
      "aged care",
      "disabled carer",
      "disability",
      "personal care",
      "nursing support",
      "mothercraft",
      "care worker",
      "welfare support",
      "special care worker",
      "indigenous health",
    ],
  },
  {
    skill: "Mental Health & Counselling",
    cat: "Care",
    // "neuropsycholog" for the same buried-stem reason as "paralegal": nine
    // archived neuropsychologist rows matched nothing, because "psycholog"
    // only matches at the start of a word.
    // "counselor"/"counseling" are the US spellings, and without them this
    // skill matched nothing on 49 archived rows over 28 titles — "Licensed
    // Professional Counselor", "Licensed Mental Health Counselor". Nearly all
    // are US rows, so they are gated out of any released-market rollup either
    // way, but the archive should still know what they are: those rows carried
    // Commercial & Legal and NOTHING else, so removing that wrong mapping
    // without this would have left them with no skill at all rather than the
    // right one. Same reason Paediatric Nursing carries "pediatric".
    terms: [
      "counsellor",
      "counselor",
      "counseling",
      "psycholog",
      "neuropsycholog",
      "mental health",
    ],
  },
  // ── Mental Health & Counselling · specialities ─────────────────────────
  //
  // Counts over RELEASED MARKETS on 2026-09-12 — 1,823 distinct titles.
  //
  // No Psychiatry child here: it sits under Medical Practice, because
  // "Psychiatrist" does not match any of this skill's terms and a psychiatrist
  // is a doctor. See the note there.
  {
    skill: "Psychology",
    cat: "Care",
    parent: "Mental Health & Counselling",
    // 455 titles.
    terms: ["psychologist", "psychology", "neuropsych"],
  },
  {
    skill: "Counselling",
    cat: "Care",
    parent: "Mental Health & Counselling",
    // 179 titles. These are the same titles Commercial & Legal used to claim
    // through "counsel" matching the start of "counsellor" — see the except
    // there. This is where they belonged all along.
    terms: ["counsellor", "counselling", "counselor", "counseling"],
  },
  {
    skill: "Alcohol & Other Drugs",
    cat: "Care",
    parent: "Mental Health & Counselling",
    // 72 titles. " aod" with the leading space, because the abbreviation is
    // three letters that appear inside ordinary words otherwise.
    terms: ["alcohol and other drug", "drug and alcohol", "addiction", " aod"],
  },
  {
    skill: "Social & Community Services",
    cat: "Community",
    terms: [
      "social work",
      "welfare",
      "community arts",
      "youth work",
      "minister of religion",
      "social profession",
      "recreation and community",
      "caseworker",
      "case worker",
      "case manager",
      "child protection",
      "family services",
      "housing officer",
    ],
  },

  // ── Education ──────────────────────────────────────────────────────────
  {
    skill: "Teaching & Education",
    cat: "Education",
    terms: [
      "teacher",
      "lecturer",
      "tutor",
      "education aide",
      "vocational education",
      "education adviser",
      "teachers of english",
      "teaching",
      "educator",
      "learning specialist",
      "curriculum",
    ],
  },
  // ── Teaching & Education · specialities ────────────────────────────────
  //
  // The SECTOR a teacher works in, which is what Australian education ads
  // actually name. Counts over RELEASED MARKETS on 2026-09-10 — 4,992 distinct
  // titles / 6,260 rows.
  //
  // Education Leadership, Childcare & Early Learning and Education Support are
  // broad skills in their own right and are deliberately not restated here.
  //
  // Not minted, for want of evidence: Vocational Education (31 titles — and
  // "vocational education" is already a term on the parent) and Languages
  // Teaching (7).
  {
    skill: "Primary Teaching",
    cat: "Education",
    parent: "Teaching & Education",
    // 644 titles, 12.3%. A bare "primary" is safe ONLY because of the parent
    // gate: the title has to be a teaching title first, so "primary care" and
    // "primary industries" never reach it. The dominant Australian wording is
    // "Teacher - Primary", which is why a "primary teacher" term would have
    // found barely a tenth of these.
    terms: ["primary"],
  },
  {
    skill: "Secondary Teaching",
    cat: "Education",
    parent: "Teaching & Education",
    // 507 titles, 8.4%. Same reasoning as Primary.
    //
    // "high school" is NOT a term here. It reads as the sector but is nearly
    // always the EMPLOYER in these titles — "Vocational Education Coordinator
    // - Lowood State High School" — the same workplace-not-speciality trap that
    // kept "nursing home" out of Aged Care Nursing.
    terms: ["secondary", "high school teacher"],
  },
  {
    skill: "Higher Education",
    cat: "Education",
    parent: "Teaching & Education",
    // 343 titles, 7.8%.
    terms: ["lecturer", "associate professor", "academic ", "postdoctoral", "research fellow"],
  },
  {
    skill: "Special Education",
    cat: "Education",
    parent: "Teaching & Education",
    // 178 titles, 2.9%.
    terms: [
      "special education",
      "learning support teacher",
      "inclusion teacher",
      "special needs teacher",
      "special school",
    ],
  },
  {
    skill: "Education Leadership",
    cat: "Education",
    terms: [
      // "principal" alone is industry-gated (see INDUSTRY_GATED): outside
      // education and the public sector it is a seniority grade. The qualified
      // forms below are unambiguous and are never gated.
      "principal",
      "assistant principal",
      "deputy principal",
      "school principal",
      "vice principal",
      "school leader",
      "leading teacher",
      "head of school",
      "head teacher",
      "dean of",
      "education leader",
    ],
  },
  {
    skill: "Childcare & Early Learning",
    cat: "Education",
    terms: ["child carer", "child care", "early childhood", "kindergarten", "nanny"],
  },
  {
    skill: "Education Support",
    cat: "Education",
    terms: [
      "integration aide",
      "inclusion support",
      "education support",
      "teacher aide",
      "teacher's aide",
      "learning support",
      "student support",
      "school support",
    ],
  },

  // ── Hospitality & food ─────────────────────────────────────────────────
  {
    skill: "Hospitality & Food Service",
    cat: "Hospitality",
    terms: [
      "chef",
      "cook",
      "waiter",
      "barista",
      "bar attendant",
      "cafe worker",
      "cafe and restaurant",
      "kitchenhand",
      "hotel service",
      "gaming worker",
      "fast food",
      "hotel and motel",
      "hospitality",
      "licensed club",
    ],
  },
  {
    skill: "Food Trades",
    cat: "Hospitality",
    terms: ["baker", "pastrycook", "butcher", "smallgoods", "meat, poultry", "meat boner"],
  },

  // ── Building & construction trades ─────────────────────────────────────
  {
    skill: "Construction Management",
    cat: "Construction",
    terms: [
      "construction manager",
      "site manager",
      "superintendent",
      "foreman",
      "building and surveying",
    ],
  },
  {
    skill: "Carpentry & Joinery",
    cat: "Trades",
    terms: ["carpenter", "joiner", "cabinetmaker", "wood machinist", "wood trades"],
  },
  { skill: "Plumbing", cat: "Trades", terms: ["plumber", "plumbing", "gasfitter"] },
  {
    skill: "Bricklaying & Concreting",
    cat: "Construction",
    terms: [
      "bricklayer",
      "stonemason",
      "concreter",
      "paving",
      "structural steel construction",
      "fencer",
      "railway track",
    ],
  },
  {
    skill: "Painting & Plastering",
    cat: "Construction",
    terms: [
      "painting trades",
      "painter",
      "plasterer",
      "glazier",
      "tiler",
      "floor finisher",
      "roof tiler",
      "wall and floor",
    ],
  },
  {
    skill: "Construction Labouring",
    cat: "Construction",
    terms: [
      "building and plumbing labour",
      "construction and mining labour",
      "insulation",
      "concreters",
    ],
  },
  {
    skill: "Architecture & Planning",
    cat: "Built Environment",
    terms: ["architect", "landscape architect", "urban and regional plann", "architectural"],
    // A technology architect is not a building architect. Measured 2026-09-12:
    // 268 distinct titles over 512 rows — 18% of everything this skill claimed —
    // were solution, enterprise, data and security architects, here purely
    // because "architect" is a prefix-anchored term and those titles end in it.
    //
    // THE ORDER OF THE FIX MATTERS. Every one of these forms mapped to this
    // skill and to nothing else, so excepting them first would have moved 512
    // rows from the wrong skill to no skill at all. Each was given a home in
    // Digital before this list was written — IT & Systems for the general
    // forms, Data Engineering for "data architect", Cybersecurity for
    // "security architect", Business Analysis for "process architect" — and
    // every entry below is covered there. Do not add a form here without
    // checking skillsForText still returns something for it.
    //
    // DELIBERATELY ABSENT, all three verified against the archive:
    //   "architect" bare (11 rows) — the genuine building architect.
    //   "naval architect" (6) — already correctly Shipbuilding & Marine, and
    //     it designs ships, not software.
    //   "senior architect" (6) — ambiguous on its own; the IT ones spell out
    //     "senior solution architect" and are caught by the entries below,
    //     since an except is a plain substring test, not a prefix one.
    except: [
      "solution architect",
      "solutions architect",
      "enterprise architect",
      "technical architect",
      "domain architect",
      "integration architect",
      "application architect",
      "platform architect",
      "systems architect",
      "servicenow architect",
      "data architect",
      "security architect",
      "process architect",
      "cloud architect",
      "ai architect",
      "software architect",
    ],
  },

  // ── Automotive & other trades ──────────────────────────────────────────
  {
    skill: "Automotive Trade",
    cat: "Trades",
    terms: [
      "motor mechanic",
      "automotive",
      "panelbeater",
      "vehicle body",
      "vehicle painter",
      "motor vehicle parts",
    ],
  },
  { skill: "HVAC & Refrigeration", cat: "Trades", terms: ["airconditioning", "refrigeration"] },
  {
    skill: "Electronics & Telecoms Trade",
    cat: "Trades",
    terms: [
      "electronics trade",
      "telecommunications trade",
      "electronic engineering draft",
      "telecommunications technical",
    ],
  },

  // ── Transport, logistics & warehousing ─────────────────────────────────
  {
    skill: "Driving & Transport",
    cat: "Transport",
    terms: [
      "truck driver",
      "delivery driver",
      "bus and coach",
      "train and tram",
      "automobile driver",
      "courier",
      "chauffeur",
      "postal deliver",

      // "driver" is safe as a bare term: termMatches anchors the START of a
      // word, so it cannot match "screwdriver". 250+ unmapped rows.
      "driver",
      "locomotive",
      "dasher",
      "rideshare",
    ],
  },
  // ── Driving & Transport · specialities ─────────────────────────────────
  //
  // What is being driven, which is the distinction the licence classes and the
  // pay both turn on. Counts over RELEASED MARKETS on 2026-09-10 — 972 distinct
  // titles / 1,954 rows. Children reach 50% of the parent, the second-best
  // coverage in the taxonomy after Allied Health.
  //
  // NO RAIL OPERATIONS CHILD. It measured 45 titles over released markets and
  // looked comfortable, then came out at 39 against the floor's own window —
  // every archived title from the last year — and worse, four of those were
  // "road train", which is a TRUCK. Excluding those puts it further under. The
  // rail vocabulary that is here, "locomotive driver", belongs to Truck
  // Driving's parent well enough without a child claiming it thinly.
  //
  // NO BUS & COACH CHILD, and the reason is worth keeping. It measured 36
  // titles against a floor of 40 — genuinely short — and the obvious way to
  // make up the difference was a bare "bus" term, which cannot be used: terms
  // anchor the start of a word, so "bus" matches "BUSiness" and was picking up
  // "10ft lorry driver & business support". Loosening a term to clear a floor
  // is the wrong way round in any case.
  {
    skill: "Truck Driving",
    cat: "Transport",
    parent: "Driving & Transport",
    // 213 titles, 24.2%. The licence classes are the Australian naming: HR is
    // Heavy Rigid, HC Heavy Combination, MC Multi Combination. "hr driver" is
    // the one term in this taxonomy that means something different under two
    // parents — Human Resources also matches it, on the "hr " term — and here
    // it is unambiguously the truck licence.
    terms: [
      "truck driver",
      "lorry driver",
      "hr driver",
      "hc driver",
      "mc driver",
      "heavy vehicle driver",
      "tipper driver",
      "heavy rigid",
      "heavy combination",
      // A ROAD TRAIN IS A TRUCK — several trailers behind one prime mover, and
      // an outback Australian one at that. It reads as rail to anyone who has
      // not met the term, and it very nearly shipped inside a Rail Operations
      // speciality on the strength of "train driver".
      "road train",
    ],
  },
  {
    skill: "Delivery Driving",
    cat: "Transport",
    parent: "Driving & Transport",
    // 179 titles, 18.5%.
    terms: ["delivery driver", "courier", "van driver", "parcel delivery", "delivery rider"],
  },
  {
    skill: "Warehousing & Logistics",
    cat: "Transport",
    terms: [
      "storeperson",
      "forklift",
      "despatch",
      "freight",
      "purchasing and supply",
      "transport and despatch",
      "packer",
      "shelf filler",
      "warehouse",
    ],
  },
  // ── Warehousing & Logistics · specialities ─────────────────────────────
  //
  // Counts over RELEASED MARKETS on 2026-09-12 — 1,464 distinct titles.
  {
    skill: "Forklift Operation",
    cat: "Transport",
    parent: "Warehousing & Logistics",
    // 151 titles. A licensed skill rather than a job, which is why employers
    // put it in the title even when the role is a general warehouse one.
    terms: ["forklift", "reach truck", "high reach", "order picker", "counterbalance"],
  },
  {
    skill: "Store & Inventory",
    cat: "Transport",
    parent: "Warehousing & Logistics",
    // 108 titles.
    terms: ["storeperson", "storeman", "inventory", "stock control", "stores officer"],
  },
  {
    skill: "Freight Forwarding",
    cat: "Transport",
    parent: "Warehousing & Logistics",
    // 90 titles.
    terms: [
      "freight forward",
      "customs broker",
      "import export",
      "international freight",
      "freight coordinator",
    ],
  },
  {
    skill: "Pick & Pack",
    cat: "Transport",
    parent: "Warehousing & Logistics",
    // 73 titles.
    terms: ["picker", "packer", "pick and pack", "order picking", "pick pack"],
  },

  // ── Manufacturing & production ─────────────────────────────────────────
  {
    skill: "Manufacturing & Production",
    cat: "Manufacturing",
    terms: [
      "machine operator",
      "production worker",
      "product assembler",
      "factory",
      "process worker",
      "engineering production",
      "spraypainter",
      "sewing machinist",
      "plastics",
      "textile",
    ],
  },

  // ── Sales & retail ─────────────────────────────────────────────────────
  {
    skill: "Retail Operations",
    cat: "Sector",
    terms: ["retail manager", "store manager", "merchandis", "retail supervisor"],
  },
  {
    skill: "Retail & Customer Service",
    cat: "Sales",
    terms: [
      "sales assistant",
      "checkout",
      "service station",
      "customer service",
      "telemarketer",
      "sales demonstrator",
      "wool buyer",
      "ticket salesperson",
      "pharmacy sales",
      "vehicle parts salesperson",
      "street vendor",
      "sales support",

      // Coles/Woolworths shop-floor titles: 405 unmapped rows between them.
      "store team member",
      "retail assistant",
      "retail team member",
      "nightfill",
      "shop assistant",
    ],
  },

  // ── Creative, media & design ───────────────────────────────────────────
  // ' actor' and 'authors' are deliberately not the bare stems: 'actor' is a
  // substring of "tractor" (ANZSCO "Tractor Operators", SOC "Heavy and
  // Tractor-Trailer Truck Drivers") and 'author' of "authorizer" (SOC "Credit
  // Authorizers"), so the bare forms filed truck drivers and credit clerks
  // under the arts. The leading space / plural keeps the real titles matching.
  {
    skill: "Creative & Performing Arts",
    cat: "Creative",
    terms: [
      " actor",
      "dancer",
      "music profession",
      "entertainer",
      "artistic director",
      "photographer",
      "film, television",
      "stage director",
      "performing arts",
      "visual arts",
    ],
  },
  {
    skill: "Journalism & Media",
    cat: "Creative",
    terms: ["journalist", "authors", "book and script", "writer", "media producer", "presenter"],
  },
  {
    skill: "Design",
    cat: "Creative",
    terms: [
      "graphic",
      "web design",
      "interior design",
      "fashion",
      "industrial and jewellery",
      "illustrator",
      "signwriter",
    ],
  },

  // ── Science, agriculture & environment ─────────────────────────────────
  {
    skill: "Science & Laboratory",
    cat: "Science",
    terms: [
      "scientist",
      "chemist",
      "biolog",
      // Buried stems again, all measured in the archive: "geoscientist" and
      // "hydrochemist" bury "scientist" and "chemist", and "microbiology"
      // buries "biolog".
      "geoscientist",
      "hydrochemist",
      "geochemist",
      "microbiolog",
      "physicist",
      "laboratory",
      "veterinar",
      "life scien",
      "food and wine",
      "science technician",
    ],
  },
  {
    skill: "Agriculture & Farming",
    cat: "Agriculture",
    terms: [
      "farmer",
      "agricultur",
      "livestock",
      "crop",
      "horticultur",
      "aquaculture",
      "forestry",
      "nurseryperson",
      "shearer",
      "animal attendant",
      "greenkeeper",
      "gardener",
      "garden and nursery",
      "primary products",
    ],
  },

  // ── Public safety & personal services ──────────────────────────────────
  {
    skill: "Emergency & Public Safety",
    cat: "Safety",
    terms: [
      "police",
      "fire and emergency",
      "ambulance",
      "paramedic",
      "prison officer",
      "security officer",
      "guard",
      "emergency service",
    ],
  },
  {
    skill: "Corrections & Justice",
    cat: "Safety",
    terms: [
      "correction",
      "custodial",
      "youth justice",
      "justice officer",
      "court services",
      "probation",
      "parole",
      "community corrections",
      "detention",
    ],
  },
  {
    skill: "Personal Services & Beauty",
    cat: "Personal",
    terms: [
      "hairdress",
      "beauty therap",
      "funeral",
      "driving instructor",
      "travel adviser",
      "travel attendant",
      "tour guide",
      "personal care consultant",
    ],
  },
  {
    skill: "Sport & Recreation",
    cat: "Personal",
    terms: [
      "sports coach",
      "fitness instructor",
      "sportsperson",
      "outdoor adventure",
      "amusement, fitness",
    ],
  },
  {
    skill: "Cleaning & Facilities",
    cat: "Cleaning",
    terms: [
      "cleaner",
      "housekeeper",
      "laundry",
      "caretaker",
      "handyperson",
      "car detailer",
      "rubbish",
      "recycling",
      "vending machine",

      // Supermarket trolley crews: 281 unmapped rows.
      "trolley collect",
    ],
  },

  // ── Sector-specific ────────────────────────────────────────────────────
  {
    skill: "Telecommunications",
    cat: "Sector",
    terms: ["telecommunications", "telco", "network operations", "fibre"],
  },
  {
    skill: "Shipbuilding & Marine",
    cat: "Sector",
    terms: [
      "shipbuild",
      "marine",
      "vessel",
      "naval",
      "boat builder",
      "shipwright",
      "deck and fishing",
      "aircraft maintenance",
    ],
  },

  // ── Chinese-language terms (Zhaopin / mainland sources) ─────────────────
  // Reuse the canonical skill names above so Chinese titles land on the same
  // heatmap skills; skillsForText dedupes when both an English and a Chinese
  // def match. Two China-heavy families (Product, Operations) are added new.
  {
    skill: "Software Engineering",
    cat: "Digital",
    terms: [
      "软件工程",
      "开发工程",
      "研发工程",
      "程序员",
      "前端",
      "后端",
      "全栈",
      "算法工程",
      "java开发",
      "测试工程",
    ],
  },
  {
    skill: "Data Science & Machine Learning",
    cat: "Digital",
    terms: ["算法", "机器学习", "人工智能", "深度学习", "大模型"],
  },
  {
    skill: "Data Analytics",
    cat: "Digital",
    terms: ["数据分析", "数据挖掘", "商业分析", "bi工程"],
  },
  { skill: "Cloud & DevOps", cat: "Digital", terms: ["运维", "云计算", "云平台"] },
  { skill: "Cybersecurity", cat: "Digital", terms: ["网络安全", "安全工程", "信息安全"] },
  {
    skill: "IT & Systems",
    cat: "Digital",
    terms: ["系统工程师", "网络工程", "数据库", "技术支持"],
  },
  {
    skill: "Product Management",
    cat: "Digital",
    terms: ["产品经理", "产品运营", "product manager", "产品总监", "产品专员"],
  },
  {
    skill: "Operations",
    cat: "Corporate",
    terms: ["运营", "运营经理", "运营专员", "内容运营", "用户运营", "电商运营"],
  },
  { skill: "Project Management", cat: "Corporate", terms: ["项目经理", "项目管理", "项目主管"] },
  {
    skill: "Finance & Accounting",
    cat: "Corporate",
    terms: ["会计", "财务", "出纳", "审计", "税务", "财务分析"],
  },
  { skill: "Human Resources", cat: "Corporate", terms: ["人力资源", "招聘", "hrbp", "人事"] },
  {
    skill: "Marketing & Comms",
    cat: "Corporate",
    terms: ["市场营销", "市场推广", "品牌", "公关", "新媒体", "文案"],
  },
  {
    skill: "Sales & Business Dev",
    cat: "Corporate",
    terms: ["销售", "业务发展", "客户经理", "商务"],
  },
  { skill: "Procurement & Supply", cat: "Corporate", terms: ["采购", "供应链", "物料"] },
  { skill: "Commercial & Legal", cat: "Corporate", terms: ["法务", "律师", "合规"] },
  {
    skill: "Administration & Office Support",
    cat: "Admin",
    terms: ["行政", "文员", "前台", "助理"],
  },
  {
    skill: "Retail & Customer Service",
    cat: "Sales",
    terms: ["客服", "客户服务", "导购", "营业员"],
  },
  {
    skill: "Electrical Engineering",
    cat: "Engineering",
    terms: ["电气工程", "硬件工程", "电子工程"],
  },
  {
    skill: "Mechanical Engineering",
    cat: "Engineering",
    terms: ["机械工程", "结构工程", "机械设计"],
  },
  { skill: "Civil Engineering", cat: "Engineering", terms: ["土木工程", "建筑工程", "施工"] },
  {
    skill: "Manufacturing & Production",
    cat: "Manufacturing",
    terms: ["生产", "制造", "工艺工程", "品质", "车间", "操作工", "普工"],
  },
  { skill: "Warehousing & Logistics", cat: "Transport", terms: ["仓储", "物流", "仓库", "配送"] },
  { skill: "Driving & Transport", cat: "Transport", terms: ["司机", "驾驶员", "快递"] },
  {
    skill: "Design",
    cat: "Creative",
    terms: ["设计师", "ui设计", "视觉设计", "平面设计", "交互设计"],
  },
  { skill: "Nursing", cat: "Health", terms: ["护士", "护理"] },
  { skill: "Medical Practice", cat: "Health", terms: ["医生", "医师", "临床"] },
  { skill: "Teaching & Education", cat: "Education", terms: ["教师", "老师", "讲师", "教研"] },

  // ── US SOC vocabulary (BLS OEWS) ───────────────────────────────────────
  // The English terms above are written against ANZSCO (AU) and SOC2010/ONS
  // (UK) titles. The US Standard Occupational Classification names the same
  // jobs differently often enough that, unextended, the matcher covered only
  // 63% of employment in the mapped US metros — "Retail Salespersons",
  // "Cashiers", "Stockers and Order Fillers" and every "First-Line Supervisor
  // of …" fell through. These are the US names for skills that already exist
  // above, so they merge into the same canonical entries below and lift US
  // coverage without inventing new skills. Deliberately conservative: only
  // titles whose mapping is unambiguous are listed, so occupations like
  // "Managers, All Other" and "Business Operations Specialists, All Other"
  // stay unmatched rather than being forced into an approximate bucket.
  {
    skill: "Retail & Customer Service",
    cat: "Sales",
    terms: [
      "retail salesperson",
      "retail sales worker",
      "cashier",
      "customer service representative",
      "counter and rental clerk",
    ],
  },
  {
    skill: "Warehousing & Logistics",
    cat: "Transport",
    terms: [
      "stocker",
      "order filler",
      "material mover",
      "material moving",
      "shipping, receiving",
      "packers and packagers",
    ],
  },
  { skill: "Leadership & Coordination", cat: "Corporate", terms: ["first-line supervisor"] },
  {
    skill: "Administration & Office Support",
    cat: "Admin",
    terms: ["secretaries", "administrative assistant", "general office clerk"],
  },
  {
    skill: "Hospitality & Food Service",
    cat: "Hospitality",
    terms: [
      "bartender",
      "food preparation",
      "cafeteria attendant",
      "waiters and waitresses",
      "food servers",
      "fast food",
    ],
  },
  {
    skill: "IT & Systems",
    cat: "Digital",
    terms: [
      "information systems manager",
      "user support specialist",
      "computer support",
      "computer network support",
      // ── IT architects ──────────────────────────────────────────────────
      // An "architect" in a technology title designs systems, not buildings,
      // and the archive is full of them: measured 2026-09-12, 268 distinct
      // titles over 512 rows — 18% of Architecture & Planning — were solution,
      // enterprise, data and security architects sitting in the Built
      // Environment. Every one of those forms mapped to Architecture & Planning
      // and NOTHING ELSE, which is why they are given a home here before that
      // skill is taught to disown them: an except on its own would have moved
      // them from the wrong skill to no skill.
      //
      // The specialised ones go where they belong rather than all landing here
      // — "data architect" to Data Engineering, "security architect" to
      // Cybersecurity, "process architect" to Business Analysis — and "cloud
      // architect" and "ai architect" already had homes.
      "solution architect",
      "solutions architect",
      "enterprise architect",
      "technical architect",
      "domain architect",
      "integration architect",
      "application architect",
      "platform architect",
      "systems architect",
      "servicenow architect",
    ],
  },
  { skill: "Cybersecurity", cat: "Digital", terms: ["information security"] },
  { skill: "Finance & Accounting", cat: "Corporate", terms: ["financial manager"] },
  {
    skill: "Banking & Lending",
    cat: "Financial",
    terms: ["financial services sales", "loan officer", "tellers"],
  },
  {
    skill: "Allied Health",
    cat: "Health",
    terms: ["medical assistant", "home health", "personal care aide"],
  },
  { skill: "Construction Labouring", cat: "Construction", terms: ["construction laborer"] },
  {
    skill: "Cleaning & Facilities",
    cat: "Cleaning",
    terms: [
      "maintenance and repair worker",
      "landscaping and groundskeeping",
      "building and grounds",
    ],
  },
  {
    skill: "Driving & Transport",
    cat: "Transport",
    terms: ["heavy and tractor-trailer", "light truck driver", "delivery drivers"],
  },
];

// Merge defs that share a canonical skill name into ONE def. Some skills are
// declared twice — an English-terms def plus a Chinese-terms def for the Zhaopin
// source (e.g. 'Human Resources', 'Software Engineering'). Left un-merged they
// surfaced as duplicate entries in the app's skill list (ALL_SKILLS /
// SKILL_CATEGORY). Concatenating their terms under the first-seen def+category
// gives a single canonical skill that still matches both languages.
//
// This merge is the CONTROL that keeps duplicate skills from ever reaching the
// app: no matter how many defs above share a name, exactly one survives here, so
// ALL_SKILLS / SKILL_CATEGORY are duplicate-free by construction. Two safety
// nets back it up: `SKILL_NAME_CONFLICTS` records any same-named defs that
// disagree on category (a merge would silently drop one category — worth
// flagging), and scripts/check-skills.ts asserts the invariant in CI
// (.github/workflows/skills-check.yml) so a regression fails the build.
export const SKILL_NAME_CONFLICTS: string[] = [];
export const SKILLS: SkillDef[] = (() => {
  const byName = new Map<string, SkillDef>();
  for (const d of RAW_SKILLS) {
    const ex = byName.get(d.skill);
    if (ex) {
      if (ex.cat !== d.cat && !SKILL_NAME_CONFLICTS.includes(d.skill)) {
        SKILL_NAME_CONFLICTS.push(d.skill);
      }
      for (const t of d.terms) if (!ex.terms.includes(t)) ex.terms.push(t);
      // Excepts union too: a skill declared in two vocabularies must not claim
      // a title that either declaration disowns.
      if (d.except?.length) {
        ex.except = [...(ex.except ?? [])];
        for (const t of d.except) if (!ex.except.includes(t)) ex.except.push(t);
      }
      // A skill declared twice must not disagree about whose speciality it is.
      // Recorded rather than resolved, for the same reason category conflicts
      // are: silently picking one declaration is how the app and the
      // generators drift apart.
      if (d.parent && ex.parent !== d.parent && !SKILL_NAME_CONFLICTS.includes(d.skill)) {
        SKILL_NAME_CONFLICTS.push(d.skill);
      }
    } else {
      byName.set(d.skill, {
        ...d,
        terms: [...d.terms],
        except: d.except ? [...d.except] : undefined,
      });
    }
  }
  return [...byName.values()];
})();

// Surface category conflicts loudly in dev (never in the built worker, where a
// console.warn would just be noise) so a bad duplicate is caught at authoring.
if (
  SKILL_NAME_CONFLICTS.length &&
  typeof process !== "undefined" &&
  process.env?.NODE_ENV !== "production"
) {
  console.warn(
    `[skillsTaxonomy] duplicate skill names with mismatched categories: ${SKILL_NAME_CONFLICTS.join(", ")}`,
  );
}

// Normalise for matching: lowercase, expand "&" to "and" (so "People & Culture"
// hits the "people and culture" term, "Learning & Development" hits its term,
// etc.), and collapse whitespace. Terms are plain substrings (some are stems
// like "geolog"), so we keep substring semantics — only "&"/whitespace change.
const norm = (s: string) => (s || "").toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ");

// Return the canonical skills a job (or ANZSCO occupation) demands. We match on
// the TITLE only: titles are concise and role-defining ("Mining Engineer",
// "Registered Nurses"), whereas descriptions are boilerplate-heavy ("excellent
// communication skills") and badly inflate generic skills. The description arg
// is accepted for API stability but intentionally not matched.
/** What we know about the employer, for terms that only mean one thing inside
 *  certain industries. */
export interface SkillContext {
  /** The employer's sector, e.g. "Iron Ore & Metals", "Education". */
  sector?: string | null;
  /** Its top-level group, e.g. "Energy & Natural Resources". */
  group?: string | null;
}

/**
 * Terms that need corroborating evidence before they are read literally.
 *
 * "Principal" is the clear case, and it is a SENIORITY GRADE far more often
 * than it is a job. BHP advertises "Principal Cost Management" and "Principal
 * Geotechnical Engineer", consultancies "Principal Consultant", banks
 * "Principal Engineer", governments "Principal Policy Officer". Only in a
 * school does it name the person running the place.
 *
 * Matching it unconditionally did two kinds of damage at once: it invented
 * education demand in mining and banking — "Education Leadership" surfaced as
 * an EMERGING SKILL AT BHP, which is what exposed this — and it buried the
 * skill the title actually describes, because the word after "Principal" is
 * the informative one and nothing was reading it.
 *
 * THE EVIDENCE HAS TO COME FROM THE TITLE, NOT THE CALLER.
 * This was an industry gate keyed on the employer's sector, which only applied
 * when a caller passed one. Exactly one caller did (careerSites.ts). Every
 * other path — the archive readback in openRolesFn, every Worker fetcher, the
 * offline mapper the Python scrapers use — called skillsForText(title) with no
 * context, so the gate never fired and the mapping was wrong everywhere it
 * mattered. A control that depends on being opted into is not a control.
 *
 * So the title itself must carry education evidence. The employer's industry
 * is still accepted as a second source when a caller supplies one, but it is
 * no longer required and no longer the only route.
 *
 * The industry list also used to include the whole public sector, which is why
 * "Principal Policy Officer" at a department read as a school principal. A
 * government is not a school; only education licenses the word.
 *
 * When the gate rejects a term the term is dropped and the REST of the title
 * still maps normally, which is the point — "Principal Cost Management"
 * resolves on "cost management", "Principal Geotechnical Engineer" on
 * "geotechnical". The longer unambiguous forms ("assistant principal", "deputy
 * principal", "school principal") are separate terms and are never gated.
 */
const GATED_TERMS: Record<string, RegExp> = {
  principal:
    /educat|school|colleg|campus|academy|kindergarten|preschool|primary|secondary|teach|curriculum|student|pupil|tafe|universit|childcare|early learning/i,
  // "AWS" is Amazon Web Services in a technology title and the ANNUAL WAGE
  // SUPPLEMENT — Singapore's thirteenth-month payment — in a salary line, where
  // it is as routine a benefit as a bonus. Measured on the archive: 93 titles
  // contain it and 45 are the wage supplement, which was tagging cleaners,
  // drivers, kitchen crew, baggage handlers and an FP&A accountant as
  // Cloud & DevOps.
  //
  // Two conditions, and both are needed. The negative lookahead rejects AWS
  // sitting in a benefits list — "$4K basic+AWS+PB", "up to $8000 base + AWS +
  // PB" — which is the shape no product name ever takes and which a technology
  // word alone does not rule out: "Presales Consultant - Network & Security (up
  // to $8000 base + AWS + PB)" and "Production Supervisor (Technical Lead) …
  // Up to $4,000 + AWS" both cleared a plain technology test. The rest then
  // demands corroborating technology, so "AWS Legal" (an Amazon lawyer, not a
  // cloud engineer) stays out.
  //
  // This only ever suppresses a skill whose ONLY evidence was "aws". A title
  // that also says "cloud", "azure", "devops" or "kubernetes" is licensed by
  // that term regardless, so a genuine "AWS Cloud Engineer ($8k + AWS)" is
  // unaffected.
  aws: /^(?!.*(?:\+\s*aws|aws\s*\+)).*(?:cloud|devops|dev ops|kubernetes|azure|gcp|terraform|linux|serverless|lambda|snowflake|redshift|postgres|kafka|python|java|node|scala|spark|engineer|architect|developer|programmer|sre|site reliability|infrastructur|platform|software|system|network|database|data cent|technical|technolog|migration|solutions|security|api|full stack|backend|back end)/i,
};

/** A gated term's second route: an employer whose industry genuinely licenses it. */
const INDUSTRY_GATED: Record<string, RegExp> = {
  principal: /educat|school|universit|tafe|college|academy/i,
};

/**
 * A term has to START a word. It does not have to end one.
 *
 * Matching was a bare substring test, which let short terms land in the middle
 * of unrelated words: "erp" inside "Ent&#101;rprise", "ai " inside "Tiw&#97;i Point",
 * and — because `norm` rewrites "&" as " and " — the E&I trade term "e and i"
 * inside "Hom&#101; and Investment Lending" and "Corporat&#101; and Institutional
 * Banking", which tagged retail-banking roles as Instrumentation & Control.
 *
 * Only the left side is anchored, because the term list is deliberately made of
 * STEMS: "electrician" has to match "Electricians", "decarbon" has to match
 * "Decarbonisation", "recruit" has to match "Recruitment". Anchoring the right
 * side as well would drop all of those.
 *
 * The assertion is only added when the term itself starts with an alphanumeric:
 * ".net" must stay matchable inside "asp.net", and CJK terms have no ASCII word
 * character to anchor against. The known cost is compounds that bury a term
 * mid-word ("Polywelder" no longer reads as welding) — rare, and much cheaper
 * than the systematic false positives above.
 */
const TERM_RE = new Map<string, RegExp>();
function termMatches(hay: string, term: string): boolean {
  let re = TERM_RE.get(term);
  if (!re) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp((/^[a-z0-9]/.test(term) ? "(?<![a-z0-9])" : "") + esc);
    TERM_RE.set(term, re);
  }
  return re.test(hay);
}

/** Does this def claim this (already normalised, space-padded) title? */
function claims(def: SkillDef, hay: string, industry: string | null): boolean {
  // Checked before the terms, not after: an except is a statement about the
  // TITLE, so no amount of term evidence should override it.
  if (def.except?.some((t) => hay.includes(t))) return false;
  const hits = def.terms.filter((t) => termMatches(hay, t));
  if (!hits.length) return false;
  // Drop a skill whose ONLY evidence is a gated term nothing licenses. This
  // runs whether or not a caller supplied context — the title is the primary
  // source of evidence, so the check cannot be skipped by omitting ctx.
  const licensed = hits.filter((t) => {
    const titleGate = GATED_TERMS[t];
    if (!titleGate) return true;
    if (titleGate.test(hay)) return true;
    const industryGate = INDUSTRY_GATED[t];
    return industry !== null && industryGate ? industryGate.test(industry) : false;
  });
  return licensed.length > 0;
}

const industryOf = (ctx?: SkillContext) =>
  // No context means no gate: callers that genuinely don't know the employer
  // (free-text search) keep the old behaviour rather than silently losing
  // matches.
  ctx ? `${ctx.sector ?? ""} ${ctx.group ?? ""}` : null;

export function skillsForText(title: string, _description?: string, ctx?: SkillContext): string[] {
  const hay = " " + norm(title) + " ";
  const industry = industryOf(ctx);
  // A Set from the start, because a canonical skill can be declared by more
  // than one def (an English def plus a Chinese-terms def for the Zhaopin
  // source), so a title hitting both would otherwise list the skill twice.
  const out = new Set<string>();
  // PASS ONE — the broad skills, on their own evidence.
  for (const def of SKILLS) if (!def.parent && claims(def, hay, industry)) out.add(def.skill);
  // PASS TWO — specialities, but only inside a parent this title already
  // claimed. See `parent` on SkillDef: a child narrows its parent rather than
  // standing beside it, so "Aged Care Worker" cannot become Aged Care Nursing
  // however plainly it says "aged care". Both survive into the result, so a
  // parent's count is unchanged by children existing beneath it.
  for (const c of childSkillsForTitle(title, out, ctx)) out.add(c);
  return [...out];
}

/**
 * The specialities a title claims, GIVEN a set of parents already established.
 *
 * Pass two of skillsForText, exposed because the archive backfill needs exactly
 * this and must not re-derive the parents. Those rows were written over years
 * of taxonomy changes — gates added, terms retuned — so re-running the whole
 * matcher over an old title would silently restate its broad skills as today's
 * matcher sees them, which is a different and much larger edit than the one
 * being asked for. Handing in the parents the row already has keeps the
 * backfill purely additive.
 *
 * Sharing this with the matcher rather than reimplementing it is the point: a
 * backfill that mapped titles even slightly differently from the live pipeline
 * would leave the archive disagreeing with itself by write date.
 */
export function childSkillsForTitle(
  title: string,
  parents: Iterable<string>,
  ctx?: SkillContext,
): string[] {
  const hay = " " + norm(title) + " ";
  const industry = industryOf(ctx);
  const have = parents instanceof Set ? parents : new Set(parents);
  const out = new Set<string>();
  for (const def of SKILLS) {
    if (!def.parent || !have.has(def.parent)) continue;
    if (claims(def, hay, industry)) out.add(def.skill);
  }
  return [...out];
}

/**
 * The broad skills — every canonical skill that is not a speciality within
 * another.
 *
 * Search, the analyst charts and the heat map all enumerate this, and they mean
 * "the skills there are" rather than "every name the taxonomy knows". Adding
 * children to it would put Midwifery beside Nursing in a list that reads as a
 * partition, and would have every per-skill scan do a third more work counting
 * rows it already counted under the parent. Children are reachable through
 * SKILL_CHILDREN and are accepted everywhere a stored name is read.
 */
export const ALL_SKILLS: string[] = SKILLS.filter((s) => !s.parent).map((s) => s.skill);
/** Every canonical name including specialities — what an archived `skills`
 *  column may legitimately contain. */
export const ALL_SKILLS_AND_CHILDREN: string[] = SKILLS.map((s) => s.skill);
export const SKILL_CATEGORY: Record<string, string> = Object.fromEntries(
  SKILLS.map((s) => [s.skill, s.cat]),
);
/** Speciality → the broad skill it narrows. Absent for a broad skill. */
export const SKILL_PARENT: Record<string, string> = Object.fromEntries(
  SKILLS.filter((s) => s.parent).map((s) => [s.skill, s.parent as string]),
);
/** Broad skill → its specialities, declaration order. Only skills that have
 *  any appear as keys. */
export const SKILL_CHILDREN: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const s of SKILLS) if (s.parent) (out[s.parent] ??= []).push(s.skill);
  return out;
})();

// ── Legacy names in stored data ─────────────────────────────────────────────
// The D1 archive freezes each listing's mapped skills as JSON at the moment it
// is written, so a row keeps whatever the skill was CALLED that day. Rename a
// canonical skill and every row written before the rename still carries the old
// string — and because every reader drops names it does not recognise (they
// have to: an unknown string has no category and no heat series), that demand
// is silently lost rather than loudly wrong.
//
// Measured on the live archive: 245 rows carry "Data Science & ML", the name
// this skill had before it became "Data Science & Machine Learning". Nothing in
// the app displayed the old name — the movers pane skips unknown skills — but
// those 245 rows' worth of demand was being dropped from every skill measure.
//
// So renames are recorded here rather than being a silent data cliff. The map
// is applied by parseStoredSkills below, which every reader of an archived
// `skills` column goes through. Keep an entry forever once added: old rows are
// never rewritten in place beyond the one-off backfill.
export const SKILL_ALIAS: Record<string, string> = {
  "Data Science & ML": "Data Science & Machine Learning",
};

/**
 * Read an archived `skills` JSON column into current canonical names.
 *
 * Applies SKILL_ALIAS, drops anything still unrecognised (an unknown skill has
 * no category and cannot be charted), and de-duplicates — an alias can collide
 * with the current name when a row carries both.
 */
export function parseStoredSkills(raw: unknown): string[] {
  let arr: unknown;
  try {
    arr = JSON.parse(String(raw ?? "[]"));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const v of arr) {
    const name = SKILL_ALIAS[String(v)] ?? String(v);
    if (name in SKILL_CATEGORY && !out.includes(name)) out.push(name);
  }
  return out;
}
