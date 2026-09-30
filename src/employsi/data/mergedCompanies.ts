/**
 * Company ids that USED to be on the roster and were folded into another one.
 *
 * A retired id is not simply deleted, because it outlives the roster line: it
 * is on archive rows (`jobs.company_id`), talent flows, follows in D1 and in
 * browsers' localStorage, and it is what an older scrape or a stale generated
 * file may still write tomorrow. Each entry here says where such a reference
 * now belongs, so every reader can resolve it to the company that is actually
 * drawn rather than to a card that no longer exists.
 *
 * This is NOT the HSBC case. `COMPANY_ID_ALIAS` in lib/openRolesFn.ts also
 * carries `hongkong-00005 -> london-hsba`, where BOTH lines stay on the roster
 * and one reads the other's rows. The ids below are gone from the roster; the
 * alias map spreads this one in so the archive readers honour both kinds, and
 * the follow paths use `canonicalCompanyId` (which does NOT apply the HSBC
 * pair, because following Hong Kong's HSBC line is a real, distinct choice).
 *
 * Merged 2026-09-30 — the same employer on the roster twice. The kept id is the
 * one wired as a scraper feed or plotted at the company's real head office:
 *
 *   Stanmore Resources    `smr` is the Stanmore career-portal feed
 *                         (careerSites.ts); the Brisbane roster line was a
 *                         second copy of it.
 *   Tencent               head office Shenzhen; the Hong Kong line is its HKEX
 *                         listing only.
 *   Lenovo                `hongkong-00992` carries the four Lenovo portal
 *                         feeds; the Beijing line was a second copy.
 *   Xiaomi                head office Beijing.
 *   China Life Insurance  head office Beijing (SSE 601628); 02628 is its H share.
 *
 * Removed 2026-09-30 — Charter Hall Long WALE REIT and Charter Hall Retail
 * REIT are externally managed by Charter Hall Group (`sydney-chc`) and employ
 * nobody of their own: every ad the archive held under them names "Charter
 * Hall" as the advertiser. So what they did hold belongs to the manager.
 */
export const MERGED_COMPANY_ID: Record<string, string> = {
  "brisbane-smr": "smr",
  "hongkong-00700": "shenzhen-00700",
  "beijing-00992": "hongkong-00992",
  "hongkong-01810": "beijing-01810",
  "hongkong-02628": "beijing-601628",
  "sydney-clw": "sydney-chc",
  "sydney-cqr": "sydney-chc",
};

/** The roster id a (possibly retired) company id now resolves to. */
export function canonicalCompanyId(id: string): string {
  return MERGED_COMPANY_ID[id] ?? id;
}
