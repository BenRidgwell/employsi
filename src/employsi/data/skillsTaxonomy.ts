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
  terms: string[]; // lowercase substrings matched against title (+ description)
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
      "requirements analyst",
      "product owner",
      "business partner",
    ],
  },
  {
    skill: "Software Engineering",
    cat: "Digital",
    terms: [
      "software engineer",
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
    terms: ["cyber", "security engineer", "infosec", "ict security"],
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
    ],
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
  {
    skill: "Commercial & Legal",
    cat: "Corporate",
    terms: [
      "commercial",
      "legal",
      "lawyer",
      "counsel",
      "contract administrat",
      "solicitor",
      "barrister",
      "conveyancer",
      "legal executive",
    ],
  },
  {
    skill: "Marketing & Comms",
    cat: "Corporate",
    terms: ["marketing", "communications", "brand", "content", "advertising", "public relations"],
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
      "financial plann",
      "wealth",
    ],
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
    terms: ["counsellor", "psycholog", "mental health"],
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
    } else {
      byName.set(d.skill, { ...d, terms: [...d.terms] });
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

export function skillsForText(title: string, _description?: string, ctx?: SkillContext): string[] {
  const hay = " " + norm(title) + " ";
  // No context means no gate: callers that genuinely don't know the employer
  // (free-text search) keep the old behaviour rather than silently losing
  // matches.
  const industry = ctx ? `${ctx.sector ?? ""} ${ctx.group ?? ""}` : null;
  const out: string[] = [];
  for (const def of SKILLS) {
    const hits = def.terms.filter((t) => termMatches(hay, t));
    if (!hits.length) continue;
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
    if (!licensed.length) continue;
    out.push(def.skill);
  }
  // Dedupe: a canonical skill can be declared by more than one def (e.g. an
  // English def plus a Chinese-terms def for the Zhaopin source), so a title
  // hitting both would otherwise list the skill twice.
  return [...new Set(out)];
}

export const ALL_SKILLS: string[] = SKILLS.map((s) => s.skill);
export const SKILL_CATEGORY: Record<string, string> = Object.fromEntries(
  SKILLS.map((s) => [s.skill, s.cat]),
);

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
