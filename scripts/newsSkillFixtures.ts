/**
 * GENERATED-ONCE, THEN HAND-LABELLED — do not regenerate over the labels.
 *
 * 256 real headlines pulled from the live `news:<slug>` KV feeds on 2026-09-20,
 * across 43 companies, with the skills a reader would expect on each.
 *
 * WHY A FIXTURE AND NOT A SPOT CHECK. Tagging skills onto news is a precision
 * problem, and precision is invisible without labels: the matcher was written
 * for JOB TITLES, and business copy uses the same words for other things —
 * "developer" (property), "pipeline" (deals), "risk" (investment), "finance"
 * (a verb), "logistics" (a property sector). Every one of those is in here,
 * carrying the headline that proves it.
 *
 * THREE BUCKETS, because a flat expected-set would be dishonest about
 * judgement calls:
 *   expect  a tag that SHOULD fire. Missing it costs recall.
 *   ok      a defensible tag. Neither required nor penalised.
 *   (else)  anything not in either list is a FALSE POSITIVE.
 *
 * Headlines with neither list are pure negatives: market copy, results, ticker
 * rows, and — worth knowing — articles that are not about the company at all.
 * The feed carries Sri Lanka's president under AKD, a child actor under Ansell,
 * built-in ovens under Built and the Competition Commission of India under CCI.
 * Those are a company-matching problem rather than a tagging one, but they are
 * kept because the tagger will meet them in production and must stay silent.
 */

export interface NewsSkillFixture {
  /** Company slug the feed filed it under. */
  co: string;
  title: string;
  /** Tags that must fire. */
  expect: string[];
  /** Tags that are acceptable but not required. */
  ok: string[];
  /** Why this one is labelled the way it is, where that is not obvious. */
  note?: string;
}

export const NEWS_SKILL_FIXTURES: NewsSkillFixture[] = [
  {
    co: "4dmedical",
    title: "4DMedical Shares Bounce, To Reclaim Key Moving Average",
    expect: [],
    ok: [],
  },
  { co: "4dmedical", title: "4DMedical reports full year revenue of $7.2M", expect: [], ok: [] },
  {
    co: "4dmedical",
    title: "4DMedical’s Lung Imaging Technology Proposed for US Veterans Affairs Pilot Program",
    expect: ["Medical Imaging & Pathology"],
    ok: [],
  },
  {
    co: "4dmedical",
    title: "4DMedical’s ASX 200 Momentum: Is Growth Already Priced In?",
    expect: [],
    ok: [],
  },
  { co: "4dmedical", title: "4DMedical signs GSK deal and joins ASX 200", expect: [], ok: [] },
  {
    co: "4dmedical",
    title: "4DMedical’s Next Chapter: Can Innovation Reshape Market Confidence?",
    expect: [],
    ok: [],
  },
  { co: "4dmedical", title: "Why 4DMedical shares are jumping 14% today", expect: [], ok: [] },
  {
    co: "4dmedical",
    title:
      "4DMedical's CT:VQ™ receives FDA 510(k) clearance; First-and-only CT-based VQ technology",
    expect: ["Medical Imaging & Pathology"],
    ok: [],
    note: "FDA clearance for CT-based VQ imaging",
  },
  {
    co: "akd",
    title: "AKD’s Jaffna visit sparks controversy",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Sri Lankan president AKD, not AKD the timber group",
  },
  {
    co: "akd",
    title: "AKD closes Yarram sawmill, 73 jobs lost amid housing market slowdown",
    expect: [],
    ok: ["Manufacturing & Production"],
    note: "sawmill closure: a jobs story, not a story about the work",
  },
  {
    co: "akd",
    title: "AKD’s neo-liberal Budget 2026: Will it resolve slow growth issues quickly?",
    expect: [],
    ok: [],
  },
  {
    co: "akd",
    title: "First year of AKD Government: Is it RW in driving seat with a difference?",
    expect: [],
    ok: [],
  },
  {
    co: "akd",
    title: "President AKD’s U-turn: Pre-poll Propaganda and Post-Election Performance",
    expect: [],
    ok: [],
  },
  {
    co: "akd",
    title: "AKD Budget Blues: There Are Prospects, But Challenges Are More",
    expect: [],
    ok: [],
  },
  { co: "akd", title: "AKD Composition Now Complete, DPR Ready to Work", expect: [], ok: [] },
  {
    co: "akd",
    title: "AKD’s party has already snatched 2/3rd of 160 electorates -Zuhair",
    expect: [],
    ok: [],
  },
  {
    co: "ansell",
    title:
      "Ansell invests US$ 60 million in India to establish surgical glove manufacturing plant at Coimbatore",
    expect: ["Manufacturing & Production"],
    ok: [],
  },
  {
    co: "ansell",
    title: "Ansell Opens 17-Acre Surgical Glove Plant in Coimbatore",
    expect: ["Manufacturing & Production"],
    ok: [],
  },
  {
    co: "ansell",
    title: "Ansell Streamlines Capital Structure With Cessation of Incentive Securities",
    expect: [],
    ok: [],
  },
  {
    co: "ansell",
    title: "Dexter Sol Ansell Finally Meets Zendaya at 2026 Emmys After Viral Clip",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Dexter Sol Ansell, a child actor",
  },
  {
    co: "ansell",
    title:
      "“A Knight of the Seven Kingdoms ”child star Dexter Sol Ansell meets his favorite stars, Zendaya and Tom Holland, at the Emmys",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Dexter Sol Ansell, a child actor",
  },
  {
    co: "ansell",
    title: "Ansell Confirms FY26 Final Dividend Exchange Rate and DRP Price",
    expect: [],
    ok: [],
  },
  { co: "ansell", title: "Ansell Ltd Share Price and Fundamentals (ANN)", expect: [], ok: [] },
  {
    co: "ansell",
    title: "Ansell appoints Finnish homewares boss as new CEO",
    expect: [],
    ok: [],
    note: "a CEO appointment is not a skill signal; General Management would fire on every one",
  },
  {
    co: "arrow-energy",
    title:
      "Arrow Energy’s Queensland gas project preparing to drill hundreds of new wells to lift production",
    expect: ["Drilling & Wells"],
    ok: [],
  },
  {
    co: "arrow-energy",
    title:
      "Arrow Energy lodges environmental authority amendment application for 55 coal seam gas wells at Hopeland",
    expect: ["Drilling & Wells", "Environmental"],
    ok: [],
  },
  { co: "arrow-energy", title: "Arrow Energy confirms job cuts are imminent", expect: [], ok: [] },
  {
    co: "arrow-energy",
    title: "Arrow Energy prepares real-time control centre",
    expect: [],
    ok: ["Instrumentation & Control", "Operations"],
    note: "'real-time control centre' is too thin to commit to",
  },
  {
    co: "arrow-energy",
    title: "Arrow Energy rolls in Shell SAP blueprint",
    expect: ["IT & Systems"],
    ok: [],
    note: "SAP would map to the ERP speciality on a vacancy; on a headline it folds up to IT & Systems",
  },
  {
    co: "austal",
    title: "Austal USA Dry Docks USS Oakland for Navy Generator Replacement",
    expect: ["Shipbuilding & Marine"],
    ok: [],
  },
  {
    co: "austal",
    title: "US Navy selects Austal USA for USS Oakland maintenance",
    expect: ["Shipbuilding & Marine"],
    ok: [],
  },
  {
    co: "austal",
    title: "Wildcat Infrastructure submits competing bid for Austal USA",
    expect: [],
    ok: [],
  },
  {
    co: "austal",
    title:
      "Video Summary: First Mogami for Australia in Production, NASAMS FOC, & WildCat bid for Austal USA",
    expect: ["Shipbuilding & Marine"],
    ok: [],
    note: "'First Mogami for Australia in Production'",
  },
  {
    co: "austal",
    title: "Austal Receives US$1.25-1.35 Billion Takeover Interest for US Operations",
    expect: [],
    ok: [],
  },
  {
    co: "austal",
    title: "Austal’s $1.9b suitor says ‘American capital’ should own US shipyards",
    expect: [],
    ok: [],
  },
  {
    co: "austal",
    title: "Austal confirms counterbid talks for its US arm by mystery Florida firm",
    expect: [],
    ok: [],
  },
  {
    co: "bank-of-queensland",
    title: "Bank of Queensland stock holds firm after latest ASX move",
    expect: [],
    ok: [],
  },
  {
    co: "bank-of-queensland",
    title: "Bank of Queensland boss Patrick Allaway to retire, new CEO announced",
    expect: [],
    ok: [],
  },
  {
    co: "bank-of-queensland",
    title: "Bank of Queensland returns to Brisbane CBD in major Queen Street tower deal",
    expect: ["Real Estate & Property"],
    ok: [],
  },
  {
    co: "bank-of-queensland",
    title: "Hundreds of Bank of Queensland jobs to be lost to outsourcing",
    expect: [],
    ok: [],
  },
  {
    co: "bank-of-queensland",
    title:
      "Bank of Queensland boss confronted over not passing on RBA rate cut to thousands: 'That's not relevant'",
    expect: [],
    ok: ["Banking & Lending"],
  },
  {
    co: "bank-of-queensland",
    title: "Bank of Queensland to close 16 branches in February",
    expect: [],
    ok: ["Banking & Lending", "Retail Operations"],
  },
  {
    co: "bank-of-queensland",
    title: "Bank of Queensland to close 16 branches in February",
    expect: [],
    ok: ["Banking & Lending", "Retail Operations"],
  },
  {
    co: "bank-of-queensland",
    title: "‘Death by a thousand cuts’: Bank of Queensland slashes up to 400 jobs",
    expect: [],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title: "Tide Wins Big4 Holiday Parks PR Account",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title: "BIG4 Holiday Parks' campaign stay local this summer via Pangea",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title:
      "Aussies can pay small to GO BIG this summer in new BIG4 Holiday Parks campaign via Pangea",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title: "BIG4 Holiday Parks announces new campaign",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title: "BIG4 Holiday Parks' latest chapter in 'GO BIG' platform via Pangea",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title:
      "BIG4 Holiday Parks encourages Aussie travellers to ‘Go Big’ in new campaign via The Pangea Agency",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title: "Big4 Holiday Parks Appoints Untangld And Pangea As Partners",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "big4-holiday-parks",
    title: "BIG4 Holiday Parks appoint Untangld and Pangea as strategy and creative partners",
    expect: ["Marketing & Comms"],
    ok: [],
  },
  {
    co: "built",
    title: "Best built-in ovens 2026: integrated ovens for baking, roasting and grilling",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: built-in ovens",
  },
  {
    co: "built",
    title: "Do Built protein bars actually taste like dessert?",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: protein bars",
  },
  {
    co: "built",
    title: "20 Built-In Storage Solutions To Maximize Your Space",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: built-in storage",
  },
  {
    co: "built",
    title: "BUILT adds to its protein-packed lineup",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: protein bars",
  },
  {
    co: "built",
    title:
      "Built Expands Commercial Real Estate Product Suite for Lenders With Acquisition of Nativ",
    expect: [],
    ok: ["Real Estate & Property"],
    note: "'Commercial Real Estate' must not license Commercial & Legal",
  },
  {
    co: "built",
    title: "Built Technologies Introduces the Future of Construction Payments: Built Pay",
    expect: [],
    ok: [],
  },
  {
    co: "built",
    title: "Built Robotics Raises $33M to Transform Construction Equipment into Autonomous Robots",
    expect: ["Automation & Robotics"],
    ok: [],
  },
  {
    co: "cci",
    title: "Google’s Real-Money Gaming Case Ends: CCI Closes Probe After New Law Changes Rules",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Competition Commission of India",
  },
  {
    co: "cci",
    title: "India’s CCI closes antitrust case against Google over real-money gaming",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Competition Commission of India",
  },
  {
    co: "cci",
    title: "CCI closes antitrust inquiry against Google over real-money gaming apps",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Competition Commission of India",
  },
  {
    co: "cci",
    title: "CCI closes real money games-related case against Google",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Competition Commission of India",
  },
  {
    co: "cci",
    title: "CCI closes Google gaming case after new online-gaming law changes the rules",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Competition Commission of India",
  },
  {
    co: "cci",
    title:
      "CCI set to tweak commitment rules by giving companies extra time to take corrective steps",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Competition Commission of India",
  },
  {
    co: "cci",
    title:
      "NAB, MLC to compensate CCI customers after settling class action over credit card, loan repayment insurance",
    expect: ["Insurance & Actuarial"],
    ok: ["Banking & Lending"],
    note: "consumer credit insurance mis-selling",
  },
  {
    co: "chevron",
    title:
      "Scott Bessent lauds $7B Chevron Venezuela deal as a salve to red-hot gas prices, but will it really work?",
    expect: [],
    ok: [],
  },
  {
    co: "chevron",
    title: "Chevron vs. Exxon: Which Dividend Survives the Downturn",
    expect: [],
    ok: [],
  },
  {
    co: "chevron",
    title:
      "Why Chevron, Exxon and ConocoPhillips Are on Every Energy Investor’s Radar This September",
    expect: [],
    ok: [],
  },
  {
    co: "chevron",
    title: "Chevron Stock Gets a Boost in Price Target by Goldman Sachs on Production Expansion",
    expect: [],
    ok: [],
  },
  {
    co: "chevron",
    title: "Chevron Doesn’t Need Oil to Hit New Highs. Here’s What Could Drive the Stock Instead",
    expect: [],
    ok: [],
  },
  {
    co: "chevron",
    title:
      "Chevron’s CEO Thinks the World Is Out of Spare Oil. He Is Betting $7 Billion on Being Right.",
    expect: [],
    ok: [],
  },
  {
    co: "chevron",
    title: "Chevron expects LNG prices to remain elevated amid supply disruptions",
    expect: [],
    ok: ["LNG Operations"],
    note: "about LNG PRICES; the market sense, not the work",
  },
  {
    co: "chevron",
    title: "Chevron eyes Argentina, Mediterranean for global LNG growth, deal with India",
    expect: [],
    ok: ["LNG Operations"],
  },
  {
    co: "codan",
    title: "Codan CEO Alf Ianniello lands 50 per cent lift in max pay to $7.65m",
    expect: [],
    ok: [],
  },
  {
    co: "codan",
    title:
      "Codan Shares Surge 7.51% to Fresh Record Highs as Defence and Gold Detection Businesses Fire on All Cylinders",
    expect: [],
    ok: [],
  },
  {
    co: "codan",
    title: "Codan Shares Close At Session High, As Bulls Eye A$50",
    expect: [],
    ok: [],
  },
  {
    co: "codan",
    title: "Is Codan Steady While Other Technology Names Slip (ASX:CDA)?",
    expect: [],
    ok: [],
  },
  {
    co: "codan",
    title: "Codan to join the S&P/ASX 100 Index later this month",
    expect: [],
    ok: [],
  },
  { co: "codan", title: "Codan Ltd Share Price and Fundamentals (CDA)", expect: [], ok: [] },
  {
    co: "codan",
    title: "Codan shares drop 14% from their peak: Here's what to expect for the rest of 2026",
    expect: [],
    ok: [],
  },
  {
    co: "codan",
    title: "Be Wary Of Codan (ASX:CDA) And Its Returns On Capital",
    expect: [],
    ok: [],
  },
  {
    co: "core-lithium",
    title:
      "Core Lithium restarts spodumene concentrate production at Finniss after two-year hiatus",
    expect: [],
    ok: ["Mining Engineering", "Metallurgy", "Process Engineering"],
  },
  {
    co: "core-lithium",
    title: "Core Lithium produces first spodumene concentrate at Finniss",
    expect: [],
    ok: ["Mining Engineering", "Metallurgy", "Process Engineering"],
  },
  {
    co: "core-lithium",
    title: "Core Lithium reaches key milestone in Finniss restart",
    expect: [],
    ok: [],
  },
  { co: "core-lithium", title: "Core sells final lithium fines to Glencore", expect: [], ok: [] },
  {
    co: "core-lithium",
    title: "Glencore snaps up the rest of Core Lithium's fines stockpile",
    expect: [],
    ok: [],
  },
  {
    co: "core-lithium",
    title: "Core Lithium Spins Out Gold Assets as Axiant Lists on ASX",
    expect: [],
    ok: [],
  },
  {
    co: "core-lithium",
    title: "Axiant hits ASX after Core Lithium completes spinout",
    expect: [],
    ok: [],
  },
  {
    co: "core-lithium",
    title:
      "Core Lithium to start mining and ore production next month at Grants deposit near Finniss",
    expect: ["Mining Engineering"],
    ok: ["Metallurgy"],
  },
  { co: "data-3", title: "Data#3 Unveils Comprehensive 2026 Annual Report", expect: [], ok: [] },
  {
    co: "data-3",
    title:
      "Data#3 Limited Submits Appendix 4G Confirming Corporate Governance Compliance for FY2026",
    expect: [],
    ok: ["Risk & Compliance"],
    note: "an ASX governance filing, not governance work",
  },
  { co: "data-3", title: "Data#3 Ltd (DTL)", expect: [], ok: [] },
  {
    co: "data-3",
    title: "Data#3 Sales Climb Amid AI Optimism",
    expect: [],
    ok: [],
    note: "'AI Optimism' is market sentiment; Data Science must not fire",
  },
  { co: "data-3", title: "Data#3 Shares Jump on Profit Guidance", expect: [], ok: [] },
  { co: "data-3", title: "Data#3 half yearly profit ticks up to $22.4M", expect: [], ok: [] },
  {
    co: "data-3",
    title: "Data#3 unveils new Brisbane headquarters",
    expect: [],
    ok: ["Real Estate & Property"],
  },
  {
    co: "dexus",
    title: "Dexus leads $400m suburban office sell-off across Parramatta and north shore",
    expect: ["Real Estate & Property"],
    ok: [],
  },
  {
    co: "dexus",
    title: "Anthropic signs first Australian data centre deal",
    expect: [],
    ok: ["Real Estate & Property"],
  },
  {
    co: "dexus",
    title: "Dexus Convenience Retail REIT Updates On-Market Security Buy-Back Activity",
    expect: [],
    ok: [],
  },
  {
    co: "dexus",
    title: "Dexus-Boral JV targets 2.5 million sqm Ravenhall precinct",
    expect: ["Real Estate & Property"],
    ok: ["Construction Management"],
  },
  {
    co: "dexus",
    title:
      "Dexus Fund Manager Brad Collier to Talk Core Opportunities at Mingtiandi Australia Forum",
    expect: [],
    ok: [],
  },
  {
    co: "dexus",
    title: "Dexus Confirms Unchanged Sustainability Assurance Conclusion in 2026 Annual Report",
    expect: [],
    ok: ["Risk & Compliance"],
  },
  {
    co: "dexus",
    title: "Macquarie, Westpac, Dexus, Optus cast doubt over 'integrity' of KPMG at inquiry",
    expect: [],
    ok: ["Finance & Accounting", "Risk & Compliance"],
    note: "audit integrity inquiry",
  },
  {
    co: "dexus",
    title: "Dexus strikes Brisbane’s largest ever office deal in $700m tower sale",
    expect: ["Real Estate & Property"],
    ok: [],
  },
  { co: "employers-mutual", title: "Employers Mutual Ltd", expect: [], ok: [] },
  {
    co: "employers-mutual",
    title: "Employers Mutual Limited Insures Risk Management with SentinelOne",
    expect: ["Cybersecurity"],
    ok: ["Risk & Compliance"],
    note: "SentinelOne is endpoint security; Cybersecurity is the right tag",
  },
  { co: "flight-centre-travel-group", title: "Flight Centre Travel Group", expect: [], ok: [] },
  { co: "flight-centre-travel-group", title: "Flight Centre Travel Group", expect: [], ok: [] },
  {
    co: "goodman-group",
    title: "Goodman Group raises $455m for Goodman Hong Kong Data Centre Partnership",
    expect: [],
    ok: ["Real Estate & Property"],
  },
  {
    co: "goodman-group",
    title: "Morgans Remains a Buy on Goodman Group (GMGSF)",
    expect: [],
    ok: [],
  },
  {
    co: "goodman-group",
    title: "Goodman Group announces June 2026 distribution",
    expect: [],
    ok: [],
  },
  {
    co: "goodman-group",
    title:
      "Goodman Group Announces Results of Cash Tender Offer for its 3.700% Guaranteed Senior Notes due 2028",
    expect: [],
    ok: [],
  },
  {
    co: "goodman-group",
    title: "Is Goodman Group (ASX:GMG) Pricing In Too Much Optimism After Recent Data Center News",
    expect: [],
    ok: [],
  },
  {
    co: "goodman-group",
    title: "Goodman Group posts $1.2b profit and expands data centre pipeline",
    expect: [],
    ok: ["Real Estate & Property"],
    note: "'data centre pipeline' is a development pipeline, NOT Pipeline Engineering",
  },
  {
    co: "goodman-group",
    title: "Sandstone Analysis: Goodman Group's growth driven by rising Data Centre investment",
    expect: [],
    ok: [],
  },
  {
    co: "goodman-group",
    title: "Goodman Group backs switch to electric vehicles for staff",
    expect: [],
    ok: ["Decarbonisation"],
  },
  {
    co: "hansen-technologies",
    title: "Hansen Technologies Reports Lapse of 152,137 Employee Rights",
    expect: [],
    ok: [],
  },
  {
    co: "hansen-technologies",
    title:
      "Hansen Technologies Receives Frost & Sullivan's 2026 European Customer Value Leadership Recognition for Excellence in Meter Data Management Innovation",
    expect: [],
    ok: ["IT & Systems", "Data Engineering"],
  },
  {
    co: "hansen-technologies",
    title:
      "Is Hansen Technologies' (ASX:HSN) M&A Tilt and Buyback Focus Quietly Redefining Its Investment Story?",
    expect: [],
    ok: [],
  },
  {
    co: "hansen-technologies",
    title: "Hansen Technologies Director Adjusts Shareholding",
    expect: [],
    ok: [],
  },
  {
    co: "hansen-technologies",
    title: "Hansen Technologies' (ASX:HSN) Returns On Capital Are Heading Higher",
    expect: [],
    ok: [],
  },
  {
    co: "hansen-technologies",
    title: "Aussie Hansen Technologies acquires Canadian vendor for $166.2M",
    expect: [],
    ok: [],
  },
  {
    co: "hansen-technologies",
    title: "Hansen Technologies: A growing business that's flying under the radar",
    expect: [],
    ok: [],
  },
  {
    co: "hub24",
    title:
      "The Growth In Wealth Management Platforms Have Reaped Dividends for Hub24, Praemium & NetWealth Investors! But Will It Continue?",
    expect: [],
    ok: ["Banking & Lending"],
    note: "an investor piece about platform growth",
  },
  { co: "hub24", title: "Citi Remains a Buy on HUB24 Limited (FSB)", expect: [], ok: [] },
  {
    co: "hub24",
    title: "Higher rates, budget changes weigh on Hub24 fund forecasts",
    expect: [],
    ok: [],
  },
  {
    co: "hub24",
    title: "Is HUB24 Entering a New Growth Chapter After Its Board Refresh?",
    expect: [],
    ok: [],
  },
  { co: "hub24", title: "HUB24 reports record $136bn FUA", expect: [], ok: [] },
  {
    co: "hub24",
    title: "HUB24 (ASX:HUB): Profitable Growth Story from the ASX 100 Worth Watching",
    expect: [],
    ok: [],
  },
  {
    co: "hub24",
    title: "‘It’s risk on for investors’, says HUB24",
    expect: [],
    ok: [],
    note: "'risk on for investors' is trading jargon; Risk & Compliance must not fire",
  },
  {
    co: "hub24",
    title: "HUB24's $2m move for Paragem make it even more attractive",
    expect: [],
    ok: [],
  },
  {
    co: "john-hughes-group",
    title: "John Hughes Group targets under 30s",
    expect: [],
    ok: ["Marketing & Comms"],
  },
  {
    co: "la-trobe-university",
    title: "La Trobe Lands $7m For Future-focused Research",
    expect: [],
    ok: ["Science & Laboratory"],
  },
  {
    co: "la-trobe-university",
    title: "First Wurruwila Wutja Research Fellow Appointed",
    expect: ["Science & Laboratory"],
    ok: [],
  },
  {
    co: "la-trobe-university",
    title:
      "Robot 'parent' trained by AI preparing teachers for conflict amid exodus from profession",
    expect: ["Teaching & Education"],
    ok: ["Data Science & Machine Learning"],
  },
  {
    co: "la-trobe-university",
    title:
      "La Trobe University Launches Regional Campaign To Redefine What A ‘Uni Person’ Looks Like",
    expect: [],
    ok: ["Marketing & Comms"],
  },
  { co: "la-trobe-university", title: "La Trobe University", expect: [], ok: [] },
  {
    co: "la-trobe-university",
    title: "Galleries: All the pictures from the La Trobe University graduations 2024",
    expect: [],
    ok: [],
  },
  {
    co: "la-trobe-university",
    title: "La Trobe Uni’s Nexus program is transforming teacher education",
    expect: ["Teaching & Education"],
    ok: [],
  },
  {
    co: "la-trobe-university",
    title:
      "Students worry courses will shift online, as they await details of La Trobe University's restructure",
    expect: [],
    ok: ["Teaching & Education"],
  },
  { co: "liontown-resources", title: "Liontown Resources Ltd (LTR)", expect: [], ok: [] },
  {
    co: "liontown-resources",
    title: "Bullish lithium signals among recent price weakness",
    expect: [],
    ok: [],
  },
  {
    co: "liontown-resources",
    title: "Liontown Resources Limited (LIS) Gets a Hold from Citi",
    expect: [],
    ok: [],
  },
  {
    co: "liontown-resources",
    title: "Rinehart-backed Liontown Resources to send lithium direct to Tesla refinery in Texas",
    expect: [],
    ok: ["Metallurgy"],
  },
  {
    co: "liontown-resources",
    title: "Liontown Resources ‘weaponised’ by short sellers, CEO says",
    expect: [],
    ok: [],
  },
  {
    co: "liontown-resources",
    title: "Hancock Prospecting has boosted its stake in Liontown resources again",
    expect: [],
    ok: [],
  },
  {
    co: "liontown-resources",
    title: "Liontown opens the door to a lithium mega-deal",
    expect: [],
    ok: [],
  },
  {
    co: "liontown-resources",
    title: "Mineral Resources rules out Liontown Resources bid, US listing off the agenda",
    expect: [],
    ok: [],
  },
  {
    co: "manildra-group",
    title:
      "Air Liquide partners with Manildra Group to build Australia's largest biogenic CO₂ plant, strengthening national supply",
    expect: [],
    ok: ["Process Engineering", "Decarbonisation", "Manufacturing & Production"],
  },
  {
    co: "manildra-group",
    title: "GE aeroderivative tech helps Manildra Group cut emissions",
    expect: [],
    ok: ["Decarbonisation"],
  },
  {
    co: "manildra-group",
    title: "Investment accelerates Manildra’s coal exit",
    expect: [],
    ok: ["Decarbonisation"],
  },
  {
    co: "manildra-group",
    title: "CEFC finance accelerates coal exit for manufacturing giant Manildra Group",
    expect: [],
    ok: ["Decarbonisation"],
    note: "'CEFC finance' is a lender acting; Finance & Accounting must not fire",
  },
  {
    co: "manildra-group",
    title: "Coles collaborates with Manildra Group for new bread recipe",
    expect: [],
    ok: ["Food Trades", "Manufacturing & Production"],
  },
  {
    co: "manildra-group",
    title:
      "Major corporations and political donors awarded grants under $200m regional jobs program",
    expect: [],
    ok: [],
  },
  {
    co: "manildra-group",
    title: "Manildra Group buys Shoalhaven Paper Mill site",
    expect: [],
    ok: [],
  },
  {
    co: "manildra-group",
    title: "Grain processor Manildra buys Riverina meatworks",
    expect: [],
    ok: [],
  },
  {
    co: "metcash",
    title: "Metcash Issues New Unquoted Performance Rights Under Incentive Scheme",
    expect: [],
    ok: [],
  },
  { co: "metcash", title: "Metcash Reports Lapse of Performance Rights", expect: [], ok: [] },
  {
    co: "metcash",
    title: "Metcash CEO Douglas Jones Awarded 886,986 Performance Rights in FY27 LTI Program",
    expect: [],
    ok: [],
  },
  {
    co: "metcash",
    title: "Undervalued supermarket share sees sales improvement",
    expect: [],
    ok: [],
  },
  { co: "metcash", title: "Metcash group revenue rises as food keeps growing", expect: [], ok: [] },
  {
    co: "metcash",
    title: "Strong start at Metcash could be dented by food inflation",
    expect: [],
    ok: [],
  },
  {
    co: "metcash",
    title: "Metcash Secures Ivan Curic To Lead LocalEyes Retail Media Sales",
    expect: ["Sales & Business Dev"],
    ok: ["Marketing & Comms", "Retail Operations"],
  },
  {
    co: "metcash",
    title: "Metcash shares tank after 7-Eleven walks away from $800m supply deal",
    expect: [],
    ok: ["Procurement & Supply"],
  },
  { co: "monadelphous-group", title: "Monadelphous Group Limited", expect: [], ok: [] },
  { co: "monadelphous-group", title: "Monadelphous Group Limited", expect: [], ok: [] },
  {
    co: "monadelphous-group",
    title: "Australian Shares Flat; Monadelphous Group Posts Higher Fiscal H1 Earnings, Revenue",
    expect: [],
    ok: [],
  },
  {
    co: "monadelphous-group",
    title: "Monadelphous Group posts record half-year result as new contracts boom",
    expect: [],
    ok: [],
    note: "'contracts boom' is a financial result; Procurement & Supply must not fire",
  },
  {
    co: "monadelphous-group",
    title:
      "Monadelphous Group Limited Unveils 2025 Annual Report with a Focus on Sustainability and Core Values",
    expect: [],
    ok: [],
  },
  {
    co: "monadelphous-group",
    title: "Monadelphous Group Limited Reaffirms Commitment to Corporate Governance",
    expect: [],
    ok: ["Risk & Compliance"],
  },
  {
    co: "monadelphous-group",
    title: "Monadelphous Group (ASX:MND) Is Reinvesting At Lower Rates Of Return",
    expect: [],
    ok: [],
  },
  {
    co: "monadelphous-group",
    title: "Is Monadelphous Group (ASX:MND) A Risky Investment?",
    expect: [],
    ok: [],
    note: "'A Risky Investment?' is market copy; Risk & Compliance must not fire",
  },
  {
    co: "newcastle-greater-mutual-group",
    title: "Newcastle Greater Mutual Group taps AI to overhaul its customer and staff experience",
    expect: ["Data Science & Machine Learning"],
    ok: ["IT & Systems"],
  },
  {
    co: "ora-banda-mining",
    title:
      "Ora Banda Mining Shares Slip 3.78% as Gold Prices Retreat Following Recent Third Mine Groundbreaking Rally",
    expect: [],
    ok: [],
  },
  {
    co: "ora-banda-mining",
    title: "Ora Banda Mining Shares Move Green YTD: Here’s The Latest",
    expect: [],
    ok: [],
  },
  {
    co: "ora-banda-mining",
    title:
      "Ora Banda Mining starts underground development at Waihi as high-grade Midnight drilling adds growth potential",
    expect: ["Underground Mining"],
    ok: ["Drilling & Wells", "Mining Engineering"],
  },
  {
    co: "ora-banda-mining",
    title: "Ora Banda chalks up three mines in three years at growing WA gold hub",
    expect: [],
    ok: ["Mining Engineering", "Underground Mining"],
  },
  {
    co: "ora-banda-mining",
    title: "Ora Banda Mining kicks off third underground mine at Waihi",
    expect: ["Underground Mining"],
    ok: ["Mining Engineering"],
  },
  {
    co: "ora-banda-mining",
    title: "Ora Banda Mining Heads 3 Australian Penny Stocks To Watch",
    expect: [],
    ok: [],
  },
  {
    co: "ora-banda-mining",
    title: "Ora Banda Mining expands high-grade gold footprint at Little Gem",
    expect: [],
    ok: ["Geology", "Mining Engineering"],
  },
  {
    co: "ora-banda-mining",
    title: "Ora Banda Mining (OBM) Gets a Buy from Canaccord Genuity",
    expect: [],
    ok: [],
  },
  {
    co: "perenti",
    title: "Perenti Updates ASX on Progress of On-Market Share Buy-Back",
    expect: [],
    ok: [],
  },
  {
    co: "perenti",
    title: "Perenti Updates Daily On‑Market Share Buy‑Back Activity",
    expect: [],
    ok: [],
  },
  {
    co: "perenti",
    title: "Perenti to sell mining equipment business to Beetle for $71m",
    expect: [],
    ok: ["Plant & Equipment Operation"],
  },
  {
    co: "perenti",
    title: "Perenti posts record first-half earnings, eyes stronger second half",
    expect: [],
    ok: [],
  },
  {
    co: "perenti",
    title: "Perenti delivers strong H1 FY26 results, dividends",
    expect: [],
    ok: [],
  },
  {
    co: "perenti",
    title:
      "Perenti Limited Positioned Across ASX 300 A Detailed Look at Its Materials-Services Structure",
    expect: [],
    ok: [],
  },
  {
    co: "perenti",
    title: "Perenti’s True Value: What Makes (ASX:PRN) Stand Out in the ASX 200",
    expect: [],
    ok: [],
  },
  {
    co: "perenti",
    title:
      "Perenti secures $1.1 billion services contract with Endeavour Mining, adding to deal spree",
    expect: [],
    ok: ["Mining Engineering"],
  },
  {
    co: "pinnacle-investment-management",
    title: "Pinnacle Investment Management: Great Flows, but the Risk Bar Is Higher",
    expect: [],
    ok: [],
    note: "'Risk Bar Is Higher' is market copy; Risk & Compliance must not fire",
  },
  {
    co: "pinnacle-investment-management",
    title: "Pinnacle Investment Management increases Metrics Credit stake in $100.5 million deal",
    expect: [],
    ok: [],
    note: "an investment stake purchase, not lending work",
  },
  {
    co: "pinnacle-investment-management",
    title: "Pinnacle Investment Management profit dips as revenue climbs, dividend steady",
    expect: [],
    ok: [],
  },
  {
    co: "pinnacle-investment-management",
    title: "Pinnacle Investment Management",
    expect: [],
    ok: [],
  },
  {
    co: "qube-holdings",
    title: "Qube Holdings Declares Special Dividend for July 2026",
    expect: [],
    ok: [],
  },
  {
    co: "qube-holdings",
    title: "Qube Holdings is trading below its takeover price. Here is what investors need to know",
    expect: [],
    ok: [],
  },
  {
    co: "qube-holdings",
    title: "Qube Holdings: The Aussie Logistics Giant US Investors Are Sleeping On",
    expect: [],
    ok: ["Warehousing & Logistics"],
    note: "an investor piece; Procurement & Supply must not fire on 'Logistics Giant'",
  },
  {
    co: "qube-holdings",
    title: "Qube Holdings holds AGM after hitting record earnings in FY25",
    expect: [],
    ok: [],
  },
  {
    co: "qube-holdings",
    title: "Qube Holdings Reports Successful 2025 AGM Resolutions",
    expect: [],
    ok: [],
  },
  {
    co: "qube-holdings",
    title: "Should You Be Adding Qube Holdings (ASX:QUB) To Your Watchlist Today?",
    expect: [],
    ok: [],
  },
  {
    co: "qube-holdings",
    title: "Qube Holdings' (ASX:QUB) Dividend Will Be A$0.041",
    expect: [],
    ok: [],
  },
  {
    co: "qube-holdings",
    title: "Is Qube Holdings Limited (ASX:QUB) Potentially Undervalued?",
    expect: [],
    ok: [],
  },
  {
    co: "redox",
    title: "Redox Limited Cancels 500,000 Lapsed Performance Rights",
    expect: [],
    ok: [],
  },
  {
    co: "redox",
    title:
      "Redox (ASX:RDX): Investors feared Australia’s largest chemicals importer was going the way of DGL, but it turned things around!",
    expect: [],
    ok: [],
  },
  {
    co: "redox",
    title:
      "Redox-switchable dyes offer tunable fluorescence for advanced bioimaging and optical applications",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: redox chemistry paper",
  },
  {
    co: "redox",
    title:
      "Redox OS is the fastest Linux distro I’ve tested, and you should try it despite what it’s missing",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: Redox OS, a Linux distro",
  },
  {
    co: "redox",
    title: "Redox eyes ‘multiple’ buyout targets after this year’s largest IPO",
    expect: [],
    ok: [],
  },
  {
    co: "redox",
    title: "This CEO’s grandfather fled Egypt to build a $1.2b firm",
    expect: [],
    ok: [],
  },
  {
    co: "redox",
    title:
      "The Relationship of Redox With Hallmarks of Cancer: The Importance of Homeostasis and Context",
    expect: [],
    ok: [],
    note: "NOT THE COMPANY: redox biology paper",
  },
  {
    co: "rio-tinto",
    title: "Prysmian, Rio Tinto partner to bring low-carbon aluminum to Amazon data center",
    expect: [],
    ok: ["Metallurgy", "Decarbonisation"],
  },
  {
    co: "rio-tinto",
    title: "Inside the plan to rebuild Juukan Gorge rock shelter destroyed by Rio Tinto",
    expect: ["Community & Native Title"],
    ok: [],
    note: "Juukan Gorge heritage",
  },
  {
    co: "rio-tinto",
    title: "Arrow Minerals Applies for 415sqkm Pilbara Tenement Next to Rio Tinto’s Robe Mine",
    expect: [],
    ok: ["Geology", "Mining Engineering"],
  },
  {
    co: "rio-tinto",
    title: "Rio Tinto wins Aboriginal consent for Winu copper mine",
    expect: ["Community & Native Title"],
    ok: ["Mining Engineering"],
  },
  { co: "rio-tinto", title: "Rio Tinto to buy Glencore bauxite project", expect: [], ok: [] },
  { co: "rio-tinto", title: "Rio Tinto navigates bauxite deal, ore pause", expect: [], ok: [] },
  {
    co: "rio-tinto",
    title: "Rio Tinto commissions $1.5 billion AP60 smelter expansion in Quebec",
    expect: ["Metallurgy"],
    ok: ["Process Engineering", "Manufacturing & Production"],
  },
  {
    co: "scentre-group",
    title: "Scentre Group CEO sees 'great opportunity' in Australia's housing shortage",
    expect: [],
    ok: ["Real Estate & Property"],
  },
  {
    co: "scentre-group",
    title: "Scentre Group outperforms the Real Estate sector despite losses on the day",
    expect: [],
    ok: [],
    note: "'outperforms the Real Estate sector' is a share-price line",
  },
  {
    co: "scentre-group",
    title: "Glasson family buys $308 million stake in Westfield Albany",
    expect: [],
    ok: ["Real Estate & Property"],
  },
  {
    co: "scentre-group",
    title: "Scentre Group sells 50% stake in Westfield Mt Gravatt to ART",
    expect: [],
    ok: ["Real Estate & Property"],
  },
  { co: "scentre-group", title: "Scentre Group (59S.MU)", expect: [], ok: [] },
  { co: "scentre-group", title: "Scentre Group (STGPF)", expect: [], ok: [] },
  { co: "scentre-group", title: "Scentre Group (59S.BE)", expect: [], ok: [] },
  { co: "south32", title: "South32 Ltd's Dividend Analysis", expect: [], ok: [] },
  { co: "south32", title: "South32 Shares Reclaim A$5, As Buyers Step In", expect: [], ok: [] },
  { co: "south32", title: "South32 (S32) Gets a Buy from RBC Capital", expect: [], ok: [] },
  {
    co: "south32",
    title: "South32 Eyes Higher Operating Margin After Alcoa Deal Slims Portfolio",
    expect: [],
    ok: [],
  },
  {
    co: "south32",
    title: "South32 Ltd lower Tuesday, outperforms the Materials sector",
    expect: [],
    ok: [],
  },
  {
    co: "south32",
    title: "Alcoa announces $3.6 billion debt offering for South32 acquisition",
    expect: [],
    ok: [],
  },
  {
    co: "south32",
    title: "South32 Shares Push To Record High: Can The Rally Continue?",
    expect: [],
    ok: [],
  },
  {
    co: "south32",
    title: "South32 breaks dividend shackles in hunt for copper growth",
    expect: [],
    ok: ["Mining Engineering"],
  },
  {
    co: "stockland",
    title: "Developer seeks to raise height of Albert Street apartment building",
    expect: [],
    ok: ["Architecture & Planning", "Construction Management", "Real Estate & Property"],
    note: "'Developer' is a PROPERTY developer; Software Engineering must not fire",
  },
  {
    co: "stockland",
    title: "LogiSPACE, Cabot, Stockland See Entry Discipline as Key to Aussie Logistics Returns",
    expect: [],
    ok: ["Real Estate & Property"],
    note: "logistics PROPERTY returns; Procurement & Supply must not fire",
  },
  {
    co: "stockland",
    title: "Walkways Face Axe as Stockland Reworks Brunswick Scheme",
    expect: [],
    ok: ["Architecture & Planning", "Construction Management"],
  },
  {
    co: "stockland",
    title: "Stockland turning Jetstar’s Collingwood HQ into 500 units",
    expect: [],
    ok: ["Real Estate & Property", "Construction Management"],
  },
  {
    co: "stockland",
    title: "How Is Stockland (ASX:SGP) Navigating Its Sector?",
    expect: [],
    ok: [],
  },
  {
    co: "stockland",
    title: "Stockland Forms 50/50 Venture With EdgeConneX to Build Australian Data Centres",
    expect: [],
    ok: ["Construction Management", "Real Estate & Property"],
  },
  {
    co: "stockland",
    title: "Stockland H1 profit jumps as residential settlements surge",
    expect: [],
    ok: [],
  },
  {
    co: "stockland",
    title: "Everything you need to know about Stockland centre opening",
    expect: [],
    ok: [],
  },
  {
    co: "swinburne-university-of-technology",
    title:
      "Swinburne University of Technology announces Women in Engineering Leadership Scholarship",
    expect: [],
    ok: ["Teaching & Education", "Education Leadership"],
  },
  {
    co: "swinburne-university-of-technology",
    title: "Emerging Writers Review Major Exhibition 'Slow Read'",
    expect: [],
    ok: ["Creative & Performing Arts"],
    note: "an arts exhibition review; Journalism & Media must not fire",
  },
  {
    co: "swinburne-university-of-technology",
    title: "Swinburne University of Technology opens applications for Bachelor of Business",
    expect: [],
    ok: ["Teaching & Education"],
  },
  {
    co: "swinburne-university-of-technology",
    title: "Swinburne University of Technology",
    expect: [],
    ok: [],
  },
  {
    co: "swinburne-university-of-technology",
    title: "Swinburne University of Technology",
    expect: [],
    ok: [],
  },
  {
    co: "swinburne-university-of-technology",
    title: "Swinburne University of Technology seeks new CIO",
    expect: ["IT & Systems"],
    ok: ["General Management"],
    note: "a CIO vacancy",
  },
  {
    co: "swinburne-university-of-technology",
    title:
      "Swinburne University Of Technology And FourthRev Help Students Gain Hands On Digital Skills",
    expect: [],
    ok: ["Teaching & Education"],
  },
  {
    co: "swinburne-university-of-technology",
    title: "Deloitte Digital Leads Rebrand For Swinburne University Of Technology",
    expect: ["Marketing & Comms"],
    ok: ["Design"],
  },
  {
    co: "telstra-group",
    title: "If I invest $15,000 in Telstra shares, how much passive income will I receive in 2027?",
    expect: [],
    ok: [],
  },
  { co: "telstra-group", title: "Telstra group MD leaving this week", expect: [], ok: [] },
  { co: "turosi", title: "Australia’s Cordina Group to merge with Turosi", expect: [], ok: [] },
  {
    co: "turosi",
    title: "Turosi Foods Pty Ltd lodge application to expand Anakie breeder farm",
    expect: ["Agriculture & Farming"],
    ok: [],
  },
  {
    co: "turosi",
    title: "Turosi Foods Pty Ltd lodge application to expand Anakie breeder farm",
    expect: ["Agriculture & Farming"],
    ok: [],
  },
  {
    co: "university-of-newcastle",
    title: "Former Boeing executive Bill Lyons appointed to University of Newcastle role",
    expect: [],
    ok: [],
  },
  { co: "university-of-newcastle", title: "University of Newcastle", expect: [], ok: [] },
  {
    co: "university-of-newcastle",
    title: "University of Newcastle celebrate 50 year anniversary of its Open Foundation program",
    expect: [],
    ok: ["Teaching & Education"],
  },
  {
    co: "university-of-western-australia",
    title:
      "University of Western Australia launches 2025 Global Excellence Scholarship for international students; check details and direct link here",
    expect: [],
    ok: ["Teaching & Education"],
  },
];
