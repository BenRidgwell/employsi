import { CITY_COUNTRY } from "../data/mapboxWorldGeo";
import { CITY_COMPANIES } from "../data/mapboxGeo";
import { COMPANIES } from "../data/companies";
import type { Role } from "./roles";

/**
 * Which markets are RELEASED to end users.
 *
 * READ THIS BEFORE CHANGING ANYTHING ELSE ABOUT IT.
 *
 * This is a release gate, not a statement about coverage, and the difference
 * decides what you should do when you touch a neighbouring system.
 *
 * The unreleased markets are NOT unsupported. They are collected, archived,
 * deduped, skill-mapped and rendered by exactly the same code as the released
 * ones. They are hidden only because the work on them is not finished, and
 * they are expected to go live one at a time as it is.
 *
 * WHAT THAT MEANS IN PRACTICE
 *   - A new scraper covers every market it can reach. Never scope a feed to
 *     this list. A market that goes live having collected nothing for six
 *     months is a market that goes live empty.
 *   - A UI change applies everywhere. There is no second code path for an
 *     unreleased market and there should never be one; the difference is a
 *     visual STATE on the same components, so a fix to a marker or a card is
 *     inherited automatically.
 *   - Releasing a market is adding two letters here, and nothing else.
 *
 * So the wrong instinct — "these markets are out of scope, skip them" — is
 * exactly the one that makes the gate expensive to remove later.
 *
 * WHY BOTH SERVER AND CLIENT
 * The client fades the markers so an end user sees where the product does and
 * does not go yet. The server withholds the underlying vacancy data so that
 * view is not merely cosmetic. Both read this list; only the server one is a
 * boundary.
 */
export const RELEASED_MARKETS: ReadonlySet<string> = new Set([
  "au", // Australia — the full listed + private + state/federal government roster
  "nz", // New Zealand — government agencies
  "sg", // Singapore — MyCareersFuture
  "ph", // Philippines — JobStreet PH
  "hk", // Hong Kong — JobsDB
  "my", // Malaysia — JobStreet MY
]);

/** An administrator sees every market, released or not. */
export function seesAllMarkets(role: Role): boolean {
  return role === "admin";
}

export function isReleasedCountry(cc: string | undefined | null): boolean {
  return !!cc && RELEASED_MARKETS.has(cc);
}

/**
 * A place id — either a country code (global layer) or a city (domestic).
 *
 * Anything resolving to neither, such as a regional cluster or an EU country
 * carrying only Eurostat aggregates, is unreleased, which is the right answer
 * for all of them.
 */
export function isReleasedPlace(id: string): boolean {
  return isReleasedCountry(id) || isReleasedCountry(CITY_COUNTRY[id]);
}

/**
 * Is this company plotted in ANY released market?
 *
 * Any, not "its" market, because a company is routinely plotted in several.
 * HSBC sits in London, Kuala Lumpur and Manila; BHP in six cities across three
 * countries. Resolving to a single city — as cityForCompany does, returning
 * whichever it finds first — refused HSBC for an end user who could see and
 * click its pin in Kuala Lumpur, because the lookup happened to answer London.
 * A pin the product shows must be a pin the product will answer for.
 *
 * An id that is plotted nowhere returns false, so an unknown company is
 * withheld rather than let through. This gate fails closed.
 */
export function isReleasedCompany(companyId: string): boolean {
  for (const [city, list] of Object.entries(CITY_COMPANIES)) {
    if (!isReleasedPlace(city)) continue;
    if (list.some((c) => c.id === companyId)) return true;
  }
  return false;
}

/** The gate a server function applies before returning market data. */
export function marketVisible(role: Role, placeOrCompany: string, isCompany = false): boolean {
  if (seesAllMarkets(role)) return true;
  return isCompany ? isReleasedCompany(placeOrCompany) : isReleasedPlace(placeOrCompany);
}

/**
 * Is any company trading under this ticker in a released market?
 *
 * A ticker is not unique across exchanges, so this accepts if ANY match is
 * released — the same "any, not its" rule isReleasedCompany uses, for the same
 * reason: refusing a symbol the product is willing to plot would be a gate
 * disagreeing with the map.
 */
export function isReleasedTicker(ticker: string): boolean {
  const t = (ticker || "").trim().toUpperCase();
  if (!t) return false;
  return COMPANIES.some((c) => (c.ticker || "").toUpperCase() === t && isReleasedCompany(c.id));
}

/**
 * Is an archive ROW in a released market?
 *
 * Rows carry a hub (the city a vacancy was matched to) and a company_id, and
 * neither alone covers the table: about a fifth have no hub — jora, indeed and
 * the career portals do not set one — while every one of those does carry a
 * company_id. Checking hub first and falling back to the company leaves no row
 * unclassified, which was verified against the live archive rather than
 * assumed.
 *
 * A row with neither is excluded, so an unattributable row is withheld rather
 * than counted.
 */
export function isReleasedRow(
  hub: string | null | undefined,
  companyId: string | null | undefined,
): boolean {
  const h = (hub || "").trim();
  // "Australia" appears as a hub value on ~1,100 rows alongside the city ids.
  if (h && (isReleasedPlace(h) || h.toLowerCase() === "australia")) return true;
  const c = (companyId || "").trim();
  return !!c && isReleasedCompany(c);
}
