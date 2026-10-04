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
 * THE TWO-CARD ARRANGEMENT IS GONE. Until 2026-10-02 three global companies
 * were carried as two roster lines each, with `COMPANY_ID_ALIAS` making the
 * second line READ the first one's rows: HSBC (LSE + HKEX), Rio Tinto (its
 * dual-listed plc and Ltd) and Chevron (a hand-placed resources line beside
 * the listed one). Both cards drew, which is confusing — one employer, two
 * pins, two cards, and neither showing the whole company. For a global
 * employer the card should show total activity, because that is its scale.
 *
 * So they are folded in here like any other duplicate, and the city each
 * retired line stood for is kept as a pin through data/secondaryOffices.ts:
 * Rio Tinto still appears in London, Chevron in Houston, HSBC in Hong Kong —
 * one card each, every office still on the map. COMPANY_ID_ALIAS now holds
 * nothing but this map.
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
 * Merged 2026-10-02 — the same case, missed on 2026-09-30:
 *
 *   HSBC Holdings         `london-hsba` carries the Eightfold feed and every
 *                         aggregator row (4,535); London is the plc's head
 *                         office. 00005 is its HKEX line, which had 49
 *                         JobStreet rows of its own.
 *   Rio Tinto             `rio` carries the career-portal feed and every
 *                         aggregator row (2,501); `london-rio` had none. Rio
 *                         is dual-HQ, and HQ_OVERRIDE keeps Melbourne as the
 *                         head office with London a further pin.
 *   Chevron               `chevron` carries the careers.chevron.com feed (698
 *                         rows); `houston-cvx` had none. HQ_OVERRIDE now names
 *                         Houston, the real head office, and the geocoded
 *                         Perth building stays as its Australian office.
 *   Meituan               head office Beijing; HKEX 03690 is its only listing,
 *                         so the roster carried one listing as two lines and
 *                         the Hong Kong one had its own 41 Zhaopin ads, none of
 *                         them a duplicate of the Beijing line's 85. Those are
 *                         re-pointed rather than left under a card nothing
 *                         draws, which an alias would have done. `beijing-03690`
 *                         is the kept id: it carries the zhaopin.meituan.com
 *                         feed (2,420 rows).
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
  "hongkong-03690": "beijing-03690",
  "london-rio": "rio",
  "houston-cvx": "chevron",
  "hongkong-00005": "london-hsba",
  "sydney-clw": "sydney-chc",
  "sydney-cqr": "sydney-chc",
};

/** The roster id a (possibly retired) company id now resolves to. */
export function canonicalCompanyId(id: string): string {
  return MERGED_COMPANY_ID[id] ?? id;
}
