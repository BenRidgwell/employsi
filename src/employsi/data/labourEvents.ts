/**
 * Labour-market timeline events, from `Employsi Skill Detail.html`.
 *
 * These are editorial context, not measurements: the vacancy series says WHAT
 * demand did, and these say what was happening in the world when it did it. The
 * card labels them as such, and no figure on the card is derived from them.
 *
 * Dates are the month the event actually landed, checked rather than copied —
 * the design's mock dated Australia's mining investment peak to mid-2011, which
 * is when the terms of trade peaked; ABS capital-expenditure data puts the
 * investment peak itself in 2012-13, so that one is corrected here.
 *
 * `month` is 0-indexed (0 = January), matching Date.getMonth().
 */

export interface LabourEvent {
  year: number;
  month: number;
  title: string;
  note: string;
}

export const LABOUR_EVENTS: LabourEvent[] = [
  {
    year: 2007,
    month: 7,
    title: "Credit crunch begins",
    note: "Wholesale funding freezes; finance and property hiring stalls first.",
  },
  {
    year: 2008,
    month: 8,
    title: "Global financial crisis",
    note: "Lehman collapses. Hiring contracts across banking, construction and retail.",
  },
  {
    year: 2009,
    month: 0,
    title: "Bitcoin launched",
    note: "The genesis block ships — the first thin demand for cryptography and distributed-systems skills.",
  },
  {
    year: 2012,
    month: 8,
    title: "Mining investment peaks",
    note: "Resources capex tops out; Perth and Brisbane compete hardest for trades, engineers and machinists.",
  },
  {
    year: 2014,
    month: 10,
    title: "Commodity price crash",
    note: "Iron ore and oil slide. Mining construction roles fall away; maintenance work holds.",
  },
  {
    year: 2016,
    month: 5,
    title: "Brexit referendum",
    note: "UK and EU hiring plans pause; relocation and right-to-work questions dominate.",
  },
  {
    year: 2017,
    month: 11,
    title: "Crypto and cloud boom",
    note: "Cloud migration budgets and speculative crypto teams pull engineers out of enterprise IT.",
  },
  {
    year: 2020,
    month: 2,
    title: "COVID-19 pandemic",
    note: "Hiring freezes overnight, then a nursing and logistics surge. Remote work becomes default.",
  },
  {
    year: 2021,
    month: 5,
    title: "The Great Resignation",
    note: "Record voluntary turnover. Time-to-fill blows out; salaries reprice fast.",
  },
  {
    year: 2022,
    month: 10,
    title: "ChatGPT launches",
    note: "Generative AI moves from research to product. Prompt and LLM skills appear in job ads.",
  },
  {
    year: 2023,
    month: 2,
    title: "Tech layoffs and rate hikes",
    note: "Big tech sheds staff; capital discipline returns. Applicants per role double.",
  },
  {
    year: 2024,
    month: 5,
    title: "AI capex boom",
    note: "Data-centre and platform build-out lifts demand for cloud, security and data engineering.",
  },
  {
    year: 2026,
    month: 4,
    title: "Present day",
    note: "AI-adjacent and healthcare skills lead the index; generalist tech roles remain competitive.",
  },
];
