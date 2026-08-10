import { COMPANIES } from "../data/companies";
import { CITY_LABEL, GLOBAL_HUB_LABEL, CITY_CONTINENT } from "../data/geo";
import { CITY_COUNTRY, COUNTRIES, COUNTRY_MEMBERS, REGION_HUBS } from "../data/mapboxWorldGeo";
import { cityForCompany } from "../data/mapboxGeo";
import type { AnalystScope, ScopeKind } from "./analystFn";

/**
 * Turning a scope into archive rows, and turning a SENTENCE into a scope.
 *
 * "Ask an analyst" gets its scope two ways now: the chip row, and the question
 * itself — "what about Sydney?" has to move the analysis to Sydney. Both routes
 * build the scope HERE, from one set of builders, because the two disagreeing
 * is the bug that would be hardest to see: the chip would say one place and the
 * numbers would come from another, and every figure on screen would still look
 * perfectly plausible.
 */

export interface ResolvedScope extends AnalystScope {
  /** Archive hub keys this scope covers. */
  hubs: string[];
  /** ISO country, when the scope sits in exactly one — fixes salary currency. */
  country?: string;
}

export const WORLD_SCOPE: ResolvedScope = {
  kind: "world",
  id: "",
  label: "Worldwide",
  hubs: [],
};

export function scopeForCompany(id: string, localCity?: string): ResolvedScope | null {
  const company = COMPANIES.find((c) => c.id === id);
  if (!company) return null;
  const hub = cityForCompany(company.id, localCity);
  return {
    kind: "company",
    id: company.id,
    label: company.name,
    hubs: [hub],
    country: CITY_COUNTRY[hub],
  };
}

export function scopeForCity(city: string): ResolvedScope | null {
  const label = GLOBAL_HUB_LABEL[city] || CITY_LABEL[city];
  if (!label) return null;
  return { kind: "city", id: city, label, hubs: [city], country: CITY_COUNTRY[city] };
}

export function scopeForCountry(cc: string): ResolvedScope | null {
  const info = COUNTRIES[cc];
  if (!info) return null;
  return {
    kind: "country",
    id: cc,
    label: info.label,
    // The country's own label appears as a hub on some rows, so include it.
    hubs: [...(COUNTRY_MEMBERS[cc] ?? []), info.label],
    country: cc,
  };
}

export function scopeForRegion(region: string): ResolvedScope | null {
  if (!REGION_HUBS[region]) return null;
  return {
    kind: "region",
    id: region,
    label: region.charAt(0).toUpperCase() + region.slice(1),
    hubs: REGION_HUBS[region],
  };
}

export function buildScope(kind: ScopeKind, id: string, localCity?: string): ResolvedScope | null {
  switch (kind) {
    case "company":
      return scopeForCompany(id, localCity);
    case "city":
      return scopeForCity(id);
    case "country":
      return scopeForCountry(id);
    case "region":
      return scopeForRegion(id);
    case "world":
      return WORLD_SCOPE;
  }
}

// ── Reading a scope out of a sentence ───────────────────────────────────────

/**
 * WHY THIS DOES NOT REUSE detectSkill's MATCHING.
 *
 * detectSkill asks `lower.includes(name)` — plain substring containment. That
 * is safe over 100 curated skill names and catastrophic over 1,508 company
 * names, because the roster is full of two- and three-letter ones: BP, EY, 3M,
 * AMP, IGO, Zip, AFL. Measured before this was written:
 *
 *     "What about Sydney?"  ->  company EY          (inside "Sydn-EY")
 *
 * which is the single most likely follow-up in the whole feature, silently
 * answered about an accounting firm. So matching here is on whole TOKENS.
 */
function tokens(s: string): string {
  // Collapse everything that is not a letter or digit, and pad, so a token run
  // can be tested with plain containment: " bhp " is in " what about bhp ".
  return ` ${(s || "").replace(/[^A-Za-z0-9]+/g, " ").trim()} `;
}

/**
 * Short company names are where the false positives live, and casing is the
 * only signal left once tokenisation has done its work.
 *
 * An ACRONYM (BHP, IGO, KPMG) is safe to match case-insensitively: those letter
 * strings are not ordinary words, so "what about bhp" is unambiguous. A short
 * name that IS an ordinary word is not safe that way — "Visa" would swallow
 * "which roles offer visa sponsorship", a real question about work rights, and
 * answer it about a payments company. Those require the user's own casing.
 *
 * `hmm` is listed explicitly: it is a real company (HMM, the shipping line) and
 * also the noise people type while thinking.
 */
const CASE_SENSITIVE_STOPWORDS = new Set(["hmm"]);

function companyNameMatches(name: string, question: string, lower: string): boolean {
  const t = tokens(lower);
  const nameTokens = tokens(name.toLowerCase());
  if (name.length >= 5) return t.includes(nameTokens);
  const acronym = /^[A-Z0-9&.-]+$/.test(name);
  if (acronym && !CASE_SENSITIVE_STOPWORDS.has(name.toLowerCase())) return t.includes(nameTokens);
  // Ordinary short word: demand the user's own capitalisation.
  return tokens(question).includes(tokens(name));
}

interface Candidate {
  kind: ScopeKind;
  id: string;
  /** The text that matched, for longest-wins. */
  name: string;
}

/**
 * Specificity, narrowest first. The tie-break the user asked for: when a
 * sentence names two things, the analysis moves to the NARROWER one, because
 * "BHP in Perth" is a question about BHP.
 */
const SPECIFICITY: Record<ScopeKind, number> = {
  company: 0,
  city: 1,
  country: 2,
  region: 3,
  world: 4,
};

/**
 * The scope a question names, or null when it names none.
 *
 * Null is the important half of the contract: a question that does not name a
 * place keeps whatever scope is already in play, which is what makes "and for
 * nursing?" stay in the city you were already looking at.
 *
 * Ranking is NARROWEST SCOPE first, then longest match. Both halves matter and
 * the order between them is not arbitrary: ranking by length first put "how is
 * BHP hiring in Perth?" on Perth, because "Perth" is the longer string — but
 * that is a question about BHP. Specificity decides across kinds; length only
 * breaks ties within a kind, where it keeps "New Zealand" from losing to a
 * shorter country whose name is a substring of the sentence.
 */
export function detectScope(question: string, localCity?: string): ResolvedScope | null {
  const lower = (question || "").toLowerCase().trim();
  if (!lower) return null;
  const t = tokens(lower);
  const hits: Candidate[] = [];

  for (const c of COMPANIES) {
    if (companyNameMatches(c.name, question, lower)) {
      hits.push({ kind: "company", id: c.id, name: c.name });
    }
  }
  const cityLabels: Record<string, string> = { ...CITY_LABEL, ...GLOBAL_HUB_LABEL };
  for (const [key, label] of Object.entries(cityLabels)) {
    if (t.includes(tokens(label.toLowerCase()))) hits.push({ kind: "city", id: key, name: label });
  }
  for (const [cc, info] of Object.entries(COUNTRIES)) {
    if (t.includes(tokens(info.label.toLowerCase()))) {
      hits.push({ kind: "country", id: cc, name: info.label });
    }
  }
  for (const region of Object.keys(REGION_HUBS)) {
    if (t.includes(tokens(region))) hits.push({ kind: "region", id: region, name: region });
  }
  // "Worldwide" and friends are a scope the user can ask for by name, and the
  // only way back out to everything without touching the chips.
  if (/\b(worldwide|globally|global|everywhere|all countries|world)\b/i.test(lower)) {
    hits.push({ kind: "world", id: "", name: "Worldwide" });
  }
  if (!hits.length) return null;

  hits.sort((a, b) => SPECIFICITY[a.kind] - SPECIFICITY[b.kind] || b.name.length - a.name.length);
  for (const h of hits) {
    const scope = buildScope(h.kind, h.id, localCity);
    if (scope) return scope;
  }
  return null;
}

/**
 * The region a city sits in, for building the chip row. Exported so the pane
 * does not re-derive it.
 */
export function regionForCity(city: string): string | undefined {
  return CITY_CONTINENT[city];
}
