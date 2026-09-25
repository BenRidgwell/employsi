/**
 * Hand-geocoded head offices for the Singapore and Hong Kong rosters.
 *
 * Every other pin in these two cities is a phyllotaxis position fanned around
 * a CBD anchor — deliberately approximate, and visibly so. These forty-four
 * are not: each is a published street address, geocoded and accepted only when
 * what came back named the road the address named. That is the same gate
 * scripts/geocode-au.py uses, and for the same reason it gives: a near-miss
 * looks authoritative while a fan position does not.
 *
 * The file was built in two passes with different sources, and each pass has
 * its own section below: twelve from company websites, then thirty-two Hong
 * Kong head offices from HKEX filings. Hong Kong is now 36 of 38 real.
 *
 * ONLY ADDRESSES WERE EVER LOOKED UP. Searching Nominatim for a company NAME
 * was measured in the Australian pass at 35% matched, with "Macquarie Group"
 * landing on Macquarie TECHNOLOGY Group's building — a different listed
 * company. The addresses here come from each company's own contact page,
 * preferring text under a "Registered Office" or "Head Office" label.
 *
 * WHY THE WEBSITE PASS FOUND ONLY TWELVE OF SIXTY-FOUR. Thirty-one of the
 * remaining sites return a
 * JavaScript shell with no address in the HTML at all, and nineteen more put
 * theirs somewhere the two local address shapes do not reach. Singapore's
 * six-digit postcode is self-validating and yielded eight; Hong Kong has no
 * postcode, so its addresses have to be recognised by street type and
 * district, which found four.
 *
 * THE LABEL MATTERS MORE THAN THE PAGE ORDER. Hang Seng Bank's contact page
 * lists branches before its registered office, so taking the first address
 * found put the card on a shop in Mongkok; 83 Des Voeux Road Central was in
 * the same file, under "Head Office".
 *
 * SEVERAL OF THESE ARE FAR OUTSIDE THE CBD and that is the data being right,
 * not wrong: Venture Corporation is 10.7 km out at Ang Mo Kio because it
 * builds electronics there, Link REIT 6.6 km across the harbour at Kwun Tong.
 * The city cameras still frame the business district, so those pins start off
 * screen. A bounding box that rejected them would be rejecting correct data.
 *
 * THE OTHER 32 HONG KONG ADDRESSES COME FROM THE COMPANIES' OWN HKEX FILINGS,
 * added 2026-09-24, and the route there is worth keeping because two obvious
 * routes were tried first and both produce plausible wrong answers.
 *
 * Wikidata, gated on the HKEX ticker (P414 = the exchange, P249 = the ticker,
 * which IS the roster id, so no company name enters the chain) matched 34 of
 * 34 — and gave no usable address. Fifteen name a head office outside Hong
 * Kong: London for HSBC and Swire, Shenzhen for Tencent, Beijing for China
 * Mobile, Lenovo and five more. Fourteen resolve to 114.15861/22.27833, the
 * point Wikidata uses for the territory itself. The four that name a building
 * MISS it — Cheung Kong Center's coordinate lands on the adjacent car park,
 * AIA Central's on CCB TOWER, a different company's building. Wikipedia
 * infoboxes, read through the same ticker-verified articles, carry a district
 * and never a street.
 *
 * The filings do not have that problem, because the exchange makes issuers
 * state it. Each company's latest annual report was located through
 * hkexnews.hk's title-search servlet by STOCK CODE, and the address read off
 * its corporate-information page under an explicit label — "Principal Place of
 * Business in Hong Kong", "Head Office and Principal Place of Business",
 * "Registered Office", or the "General information" note to the financial
 * statements, which states it in prose. Never the first address on the page:
 * Swire's own report mentions 979 King's Road eight times (it built it) and
 * 88 Queensway seven, and only the second sits under "Registered Office".
 *
 * THIS IS WHY THE LISTING ENTITY IS THE RIGHT ONE TO ASK. Wikidata puts China
 * Mobile, China Unicom and Lenovo in Beijing, and the group HQs are there —
 * but the LISTED companies' registered offices are 99 Queen's Road Central,
 * 99 Queen's Road Central and Lincoln House, and they filed them as such.
 * A listings roster wants the listed entity.
 *
 * EVERY COORDINATE IS CONFIRMED BY TWO INDEPENDENT SOURCES. Each address went
 * to the Hong Kong government's Address Lookup Service (als.gov.hk), the
 * territory's own gazetteer, accepted only when the street name AND building
 * number it returned were the ones the filing stated; then separately to OSM
 * by building name. The two agree within 61 m on all 32 and within 25 m on
 * most. The gazetteer answered "363 Java Road" with the building name THE
 * HONG KONG AND CHINA GAS COMPANY LIMITED, which is the filing checking
 * itself. It has no record for One Pacific Place or MTR Headquarters Building,
 * so those two take the OSM polygon, cross-checked against the gazetteer's
 * nearest record at the same street number (~100 m and 21 m away).
 *
 * FIVE BUILDINGS CARRY MORE THAN ONE COMPANY and the duplicate coordinates are
 * correct: four of the CK companies are all in Cheung Kong Center, three banks
 * in Bank of China Tower, three Cayman-incorporated issuers in Lee Garden One,
 * two in The Center, two in Three Pacific Place. Coincident pins are already
 * normal in this file — 89 points here carry more than one id, up to eight
 * Victorian agencies on one address — so nothing needed inventing to spread
 * them, and spreading them would have been fabrication.
 *
 * TWO OF THE 34 ARE STILL ON THE FAN, because their own filings put them
 * nowhere else. HSBC Holdings plc's annual report gives 8 Canada Square,
 * London and states no Hong Kong address anywhere in 377 pages; Ping An's
 * gives its registered office in Futian District, Shenzhen. Neither is a
 * gap to fill from a weaker source.
 *
 * CapitaLand Ascendas REIT is deliberately NOT here. Its published address is
 * its MANAGER's office, the same 168 Robinson Road as CapitaLand Investment,
 * and a REIT has no staff of its own; it keeps its fan position.
 */
export const ASIA_REAL_COORDS: Record<string, [number, number]> = {
  // Singapore
  "singapore-o39": [103.849077, 1.285033], // OCBC — 65 Chulia Street, Singapore 049513
  "singapore-9ci": [103.847654, 1.277681], // CapitaLand Investment — 168 Robinson Road, Singapore 068912
  "singapore-bn4": [103.818286, 1.264844], // Keppel Ltd. — 1 HarbourFront Avenue, Singapore 098632
  "singapore-u14": [103.843647, 1.317363], // UOL Group — 101 Thomson Road, Singapore 307591
  "singapore-c09": [103.85093, 1.283052], // City Developments Limited — 9 Raffles Place, Singapore 048619
  "singapore-c07": [103.802258, 1.272667], // Jardine Cycle & Carriage — 239 Alexandra Road, Singapore 159930
  "singapore-c52": [103.801271, 1.272293], // ComfortDelGro — 1 Pasir Panjang Road, Singapore 118479
  "singapore-v03": [103.84605, 1.37719], // Venture Corporation — 5006 Ang Mo Kio Avenue 5, Singapore 569873
  // Hong Kong
  "hongkong-00823": [114.213488, 22.316083], // Link REIT — 77 Hoi Bun Road, Kwun Tong, Kowloon, Hong Kong
  // Moved 123 m on 2026-09-24. The website pass took the first OSM hit for
  // "8 Finance Street", which is Two IFC's SUBWAY ENTRANCE; this is the tower
  // polygon, and the government gazetteer's own 8 Finance Street records sit
  // between the two. The IFC complex is 400 m end to end, so "the right
  // street" was not a tight enough gate here — the filings pass found it.
  "hongkong-00012": [114.159278, 22.285301], // Henderson Land Development — 72-76/F Two IFC, 8 Finance Street, Central
  "hongkong-00016": [114.176938, 22.280329], // Sun Hung Kai Properties — 30 Harbour Road, Wan Chai, Hong Kong
  "hongkong-00011": [114.156168, 22.284572], // Hang Seng Bank — 83 Des Voeux Road Central, Hong Kong
  // Hong Kong — read off each company's latest annual report on hkexnews.hk,
  // located by stock code, under the label quoted at the end of each line.
  "hongkong-00001": [114.16008, 22.27922], // CK Hutchison — 48/F Cheung Kong Center, 2 Queen's Road Central · Principal Place of Business
  "hongkong-00002": [114.19563, 22.32307], // CLP Holdings — CLP Headquarters, 43 Shing Kai Road, Kai Tak, Kowloon · Contact Us
  "hongkong-00003": [114.20956, 22.29156], // Hong Kong and China Gas — 23/F, 363 Java Road, North Point · Registered Office
  "hongkong-00006": [114.16008, 22.27922], // Power Assets — Unit 2005, 20/F Cheung Kong Center, 2 Queen's Road Central · Registered Office
  "hongkong-00019": [114.165431, 22.27772], // Swire Pacific — 31/F One Pacific Place, 88 Queensway, Admiralty · Registered Office
  "hongkong-00027": [114.15301, 22.28685], // Galaxy Entertainment — 22/F Wing On Centre, 111 Connaught Road Central · Registered Office
  "hongkong-00066": [114.213499, 22.320888], // MTR — MTR Headquarters Building, Telford Plaza, Kowloon Bay · Principal Place of Business and Registered Office
  "hongkong-00101": [114.15894, 22.28026], // Hang Lung Properties — 28/F, 4 Des Voeux Road Central · Registered Office
  "hongkong-00175": [114.17489, 22.28088], // Geely Automobile — Room 2301, Great Eagle Centre, 23 Harbour Road, Wan Chai · Head Office and Principal Place of Business
  "hongkong-00267": [114.16712, 22.28064], // CITIC — 32/F CITIC Tower, 1 Tim Mei Avenue, Central · note 1, General information
  "hongkong-00288": [114.16022, 22.30328], // WH Group — Level 76, International Commerce Centre, 1 Austin Road West, Kowloon · Principal Place of Business and Corporate Headquarters in Hong Kong
  "hongkong-00388": [114.15816, 22.28385], // HKEX — 8/F Two Exchange Square, 8 Connaught Place, Central · registered office
  "hongkong-00669": [114.13282, 22.3621], // Techtronic Industries — 29/F Tower 2, Kowloon Commerce Centre, 51 Kwai Cheong Road, Kwai Chung · registered office
  "hongkong-00688": [114.16799, 22.27694], // China Overseas Land — 10/F Three Pacific Place, 1 Queen's Road East · Registered Office
  "hongkong-00700": [114.16799, 22.27694], // Tencent — 29/F Three Pacific Place, 1 Queen's Road East, Wanchai · Principal Place of Business in Hong Kong
  "hongkong-00762": [114.15439, 22.28487], // China Unicom — 75/F The Center, 99 Queen's Road Central · Registered Office
  "hongkong-00883": [114.16149, 22.27906], // CNOOC — 65/F Bank of China Tower, 1 Garden Road · Registered Office
  "hongkong-00941": [114.15439, 22.28487], // China Mobile — 60/F The Center, 99 Queen's Road Central · Registered Office
  "hongkong-00992": [114.21223, 22.28764], // Lenovo — 23/F Lincoln House, Taikoo Place, 979 King's Road, Quarry Bay · Registered Office
  "hongkong-01038": [114.16008, 22.27922], // CK Infrastructure — 12/F Cheung Kong Center, 2 Queen's Road Central · Principal Place of Business
  "hongkong-01113": [114.16008, 22.27922], // CK Asset — 7/F Cheung Kong Center, 2 Queen's Road Central · Principal Place of Business
  "hongkong-01299": [114.16181, 22.28131], // AIA Group — 35/F AIA Central, 1 Connaught Road Central · Registered Office
  "hongkong-01810": [114.1846, 22.27845], // Xiaomi — Room 1928, Lee Garden One, 33 Hysan Avenue, Causeway Bay · Principal Place of Business in Hong Kong
  "hongkong-01928": [114.1846, 22.27845], // Sands China — Room 1916, Lee Garden One, 33 Hysan Avenue, Causeway Bay · Principal Place of Business in Hong Kong
  "hongkong-01929": [114.15727, 22.28072], // Chow Tai Fook Jewellery — 33/F New World Tower, 16-18 Queen's Road Central · registered office
  "hongkong-02020": [114.21021, 22.31968], // Anta Sports — 16/F Manhattan Place, 23 Wang Tai Road, Kowloon Bay · Report of the Directors, Principal Place of Business
  "hongkong-02388": [114.16149, 22.27906], // BOC Hong Kong — 53/F Bank of China Tower, 1 Garden Road · Registered Office
  "hongkong-02628": [114.18706, 22.30082], // China Life — 16/F Tower A, China Life Centre, 18 Hung Luen Road, Hung Hom · Hong Kong office address
  "hongkong-03690": [114.1846, 22.27845], // Meituan — Room 1912, Lee Garden One, 33 Hysan Avenue, Causeway Bay · Principal Place of Business in Hong Kong
  "hongkong-03988": [114.16149, 22.27906], // Bank of China — Bank of China Tower, 1 Garden Road, Central · Place of Business in Hong Kong SAR
  "hongkong-06862": [114.17353, 22.27479], // Haidilao International — 40/F Dah Sing Financial Centre, 248 Queen's Road East, Wanchai · Principal Place of Business in Hong Kong
  "hongkong-09988": [114.18257, 22.27821], // Alibaba Group — 26/F Tower One, Times Square, 1 Matheson Street, Causeway Bay · business address of directors and executive officers
};
