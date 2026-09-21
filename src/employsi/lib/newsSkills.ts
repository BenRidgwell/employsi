import { skillsForText, SKILL_PARENT } from "../data/skillsTaxonomy";

/**
 * Skills tagged onto a NEWS ARTICLE, the way a market app tags indexes to a
 * story.
 *
 * WHY THIS IS A LAYER AND NOT A TAXONOMY EDIT. `skillsForText` is tuned for JOB
 * TITLES, where every word is there to name an occupation. News copy reuses the
 * same vocabulary for other things, and business copy especially — measured
 * against the 256 real headlines in scripts/newsSkillFixtures.ts, the plain
 * matcher scored 41.7% precision, with failures like
 *
 *     Developer seeks to raise height of Albert Street apartment building
 *     Goodman Group posts $1.2b profit and expands data centre pipeline
 *     Is Monadelphous Group (ASX:MND) A Risky Investment?
 *
 * read, correctly for the matcher's own purpose, as Software Engineering,
 * Pipeline Engineering and Risk & Compliance. Teaching GATED_TERMS that
 * "developer" means property would break the job matcher, where Developer is
 * the most common title in the archive — the senses are opposite. So the news
 * reading lives here and the repo's one-matcher rule stays intact.
 *
 * THE PIPELINE, in order, because the order is load-bearing:
 *
 *   1. drop the company's own name       — it is not evidence about the topic
 *   2. is this market copy?              — if so, emit NOTHING
 *   3. skillsForText                     — the shared matcher, unchanged
 *   4. sense blocklist                   — drop terms used in a non-work sense
 *   5. fold to broad, dedupe, cap
 *
 * Step 2 before step 3 is what makes the rest small: most collisions live in
 * share-price copy, and a story about the stock is never a story about the work.
 */

/**
 * BROAD SKILLS ONLY.
 *
 * A speciality is a fine tag on a vacancy, where the title is written to be
 * precise, and a bad one on ten words of headline: "Underground Mining" from a
 * job ad is a claim the advertiser made, while the same tag off a headline is a
 * guess at which part of mining a reporter meant.
 */
function toBroad(skill: string): string {
  return SKILL_PARENT[skill] ?? skill;
}

/**
 * How many tags a story may carry. Three: a fourth chip pushes the row taller
 * than its thumbnail, and the tail of a match list is where the weak hits live.
 */
export const MAX_NEWS_TAGS = 3;

/**
 * MARKET COPY — a story about the stock, not about the company's work.
 *
 * This is the single highest-value rule here, because the collisions cluster in
 * share-price writing: "risk" is an investment property, "returns" are a yield,
 * "contracts boom" is a revenue line, "logistics" is an asset class. None of
 * them is an occupation, and no amount of term-gating rescues a headline whose
 * subject is the share price.
 *
 * Suppressing the whole article rather than the individual term is deliberate.
 * A market story can mention real work in passing and still not be about it,
 * and a tag is a claim about what the company DOES.
 *
 * DELIBERATELY NOT HERE: "invest", "million", "billion", "$". Ansell's
 * "invests US$ 60 million in India to establish surgical glove manufacturing
 * plant" is a capital story about real work, and money is in most business
 * headlines either way. Matching on money would take the recall and leave the
 * false positives.
 */
const MARKET_COPY: RegExp[] = [
  // Tickers and exchange furniture: "(ASX:MND)", "ASX 200", "S&P/ASX 100".
  /\(\s*(ASX|NYSE|NASDAQ|LSE|TSX)\s*:/i,
  /\bASX\s?\d{2,3}\b/i,
  // Who the story is addressed to.
  /\binvestors?\b/i,
  /\bshareholders?\b/i,
  // Share-price movement and broker language.
  /\b(shares?|stock|share price)\b.*\b(jump|surge|slip|drop|tank|climb|fall|rise|rally|bounce|slid|soar|plunge|gain)/i,
  /\b(jump|surge|slip|drop|tank|climb|fall|rise|rally|bounce|soar|plunge)\w*\b.*\b(shares?|stock)\b/i,
  /\boutperform|underperform/i,
  /\bprice target\b|\bpriced in\b|\bundervalued\b|\bovervalued\b|\bvaluation\b/i,
  /\bgets? a (buy|hold|sell)\b|\bremains? a buy\b|\breiterates?\b/i,
  /\bwatchlist\b|\bpenny stocks?\b|\bmoving average\b|\bmarket cap\b/i,
  // Dividends, buybacks, rights and the rest of the filings furniture.
  /\bdividend|\bbuy-?back|\bperformance rights?\b|\bshareholding\b|\bfundamentals\b/i,
  /\bdistribution\b.*\b(announce|declare)|\btender offer\b/i,
  // Results season.
  /\b(half-?year|full-?year|H[12]|FY\d{2}|quarterly)\b.*\b(result|earnings|profit|revenue)/i,
  /\bposts?\b.*\b(profit|earnings|result|revenue)\b/i,
  /\breturns on capital\b|\brate of return\b|\breturns?\b\s*$/i,
  // Risk in its investment sense, which is where Risk & Compliance kept firing.
  /\brisk(y|-on)?\b.*\b(investment|investor|bar|appetite|reward|on for)\b/i,
  /\brisk on\b/i,
  // Stake transactions. "Pinnacle Investment Management increases Metrics
  // Credit stake in $100.5 million deal" was the last false positive standing:
  // with the company's own name stripped, "Credit" is left naming a fund and
  // reads as Banking & Lending. Buying a holding in something is an M&A story
  // whatever the something is called.
  /\b(increase|acquire|buy|boost|lift|sell|raise|cut|trim)\w*\s+(its\s+|the\s+)?(\d+%\s+)?(stake|holding|shareholding)\b/i,
  /\b(stake|shareholding)\b.*\b(deal|million|billion)\b/i,
];

function isMarketCopy(text: string): boolean {
  return MARKET_COPY.some((re) => re.test(text));
}

/**
 * SENSE BLOCKS — a term that named an occupation to the matcher, used here for
 * something else.
 *
 * Each entry drops ONE skill when its context pattern is present, and each is
 * here because a real headline in the fixture demanded it. A rule without a
 * headline behind it is a guess, and guesses are what this file exists to stop.
 */
const SENSE_BLOCK: { skill: string; when: RegExp; why: string }[] = [
  {
    skill: "Pipeline Engineering",
    when: /\b(deal|development|project|acquisition|product|drug|sales|data\s?cent(re|er))s?\s+pipeline\b|\bpipeline\s+of\s+(deals|projects|work|acquisitions)\b/i,
    why: "Goodman Group posts $1.2b profit and expands data centre pipeline",
  },
  {
    skill: "Software Engineering",
    when: /\bdevelopers?\b(?=[\s\S]*\b(apartment|building|tower|precinct|storey|stories|height|residential|housing|estate|planning|site|land|suburb)\b)|\b(apartment|building|tower|precinct|residential|housing)\b(?=[\s\S]*\bdevelopers?\b)/i,
    why: "Developer seeks to raise height of Albert Street apartment building — a PROPERTY developer",
  },
  {
    skill: "Commercial & Legal",
    when: /\bcommercial\s+(real\s+estate|property|propert)/i,
    why: "Built Expands Commercial Real Estate Product Suite for Lenders",
  },
  {
    skill: "Procurement & Supply",
    when: /\blogistics\b(?=[\s\S]*\b(returns?|sector|REIT|yield|assets?|entry discipline)\b)|\b(returns?|sector|REIT|yield)\b(?=[\s\S]*\blogistics\b)/i,
    why: "LogiSPACE, Cabot, Stockland See Entry Discipline as Key to Aussie Logistics Returns",
  },
  {
    skill: "Data Science & Machine Learning",
    when: /\bAI\b(?=[\s\S]*\b(optimism|hype|boom|rally|trade|sentiment)\b)|\b(optimism|hype|rally|sentiment)\b(?=[\s\S]*\bAI\b)/i,
    why: "Data#3 Sales Climb Amid AI Optimism — market sentiment, not AI work",
  },
  {
    skill: "Journalism & Media",
    when: /\b(exhibition|gallery|artwork|sculpture)\b/i,
    why: "Emerging Writers Review Major Exhibition 'Slow Read' — an arts review",
  },
  {
    skill: "Finance & Accounting",
    // "CEFC finance accelerates ..." is a lender acting, not a finance function.
    // The lookahead keeps the real thing: a finance TEAM, ROLE or officer.
    when: /\bfinanc(e|es|ed|ing)\b(?![\s\S]*\b(team|manager|director|function|department|officer|analyst|controller|CFO|accountant|accounting)\b)/i,
    why: "CEFC finance accelerates coal exit for manufacturing giant Manildra Group",
  },
];

/**
 * Remove the company's own name from the haystack.
 *
 * THE NAME IS NOT EVIDENCE ABOUT THE ARTICLE, and leaving it in is actively
 * wrong in both directions. "Pinnacle Investment Management" carries the market
 * vocabulary this file suppresses on, so every one of that company's stories —
 * including a genuine hiring story — would read as share-price copy. Pointing
 * the other way, "Redox" and "Built" would license Process Engineering and
 * Construction on the strength of being called that.
 */
function stripName(text: string, companyName?: string): string {
  const n = (companyName || "").trim();
  if (n.length < 3) return text;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"), " ");
}

/**
 * Tags for one article.
 *
 * `text` IS THE HEADLINE, AND SHOULD STAY THE HEADLINE.
 *
 * An earlier note here said og:description should be appended once it was
 * carried through, on the reasoning that three to five times the text would lift
 * a 24% recall. That was tested on 2026-09-21 and it is wrong, so the note is
 * replaced by the measurement rather than deleted:
 *
 *   descriptions fetched for 100 of the 256 fixture articles (44% of those
 *   still reachable; most publishers refuse the scrape)
 *
 *                          precision   recall
 *     title only              100.0%    24.4%
 *     title + description      63.2%    29.3%
 *
 * Thirty-seven points of precision to buy five of recall, and the five is two
 * tags on two BIG4 marketing stories.
 *
 * THE REASON IS STRUCTURAL, NOT A TUNING PROBLEM, which is why no blocklist
 * rescues it. A description is where a story puts its attributed quotes and its
 * about-the-company boilerplate, and both are written in JOB TITLES:
 *
 *   "Telstra group MD leaving this week"
 *     -> "Andrea Grant, group managing director, human resources"
 *        the DEPARTING PERSON'S title, tagged Human Resources
 *   "Bullish lithium signals among recent price weakness"
 *     -> "David Franklin, head of funds management at Argonaut"
 *        the QUOTED PERSON'S title, tagged Leadership & Coordination
 *   "Aussie Hansen Technologies acquires Canadian vendor"
 *     -> "billing, data management and customer care solutions provider"
 *        BOILERPLATE about the company, tagged off what it sells
 *
 * A title matcher is built to fire on exactly that text, so the richer the
 * description the worse it reads. Boilerplate is the sharpest version: it
 * describes what a company DOES, so every article for that company inherits the
 * same tags regardless of what happened.
 *
 * Recall stays low and that is the accepted trade — a missing tag costs a reader
 * nothing, a wrong one is a claim about the company. Lifting it needs a method
 * that knows what a story is ABOUT rather than which words it contains.
 *
 * `companyName` is the roster name of the company whose card this is. Optional
 * so the function stays testable on bare text, but pass it wherever it is
 * known — see stripName for why it changes the answer.
 */
export function newsSkillTags(text: string, companyName?: string): string[] {
  const hay = stripName(text, companyName);
  if (!hay.trim()) return [];
  if (isMarketCopy(hay)) return [];
  const broad: string[] = [];
  for (const s of skillsForText(hay)) {
    const b = toBroad(s);
    if (broad.includes(b)) continue;
    if (SENSE_BLOCK.some((r) => r.skill === b && r.when.test(hay))) continue;
    broad.push(b);
  }
  return broad.slice(0, MAX_NEWS_TAGS);
}
