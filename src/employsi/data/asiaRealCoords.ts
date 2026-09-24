/**
 * Hand-geocoded head offices for the Singapore and Hong Kong rosters.
 *
 * Every other pin in these two cities is a phyllotaxis position fanned around
 * a CBD anchor — deliberately approximate, and visibly so. These twelve are
 * not: each is the address the company publishes on its own site, geocoded
 * through Nominatim and accepted only when the road it resolved to was the
 * road the address named. That is the same gate scripts/geocode-au.py uses,
 * and for the same reason it gives: a near-miss looks authoritative while a
 * fan position does not.
 *
 * ONLY ADDRESSES WERE EVER LOOKED UP. Searching Nominatim for a company NAME
 * was measured in the Australian pass at 35% matched, with "Macquarie Group"
 * landing on Macquarie TECHNOLOGY Group's building — a different listed
 * company. The addresses here come from each company's own contact page,
 * preferring text under a "Registered Office" or "Head Office" label.
 *
 * WHY ONLY TWELVE OF SIXTY-FOUR. Thirty-one of the remaining sites return a
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
 * THE OTHER 34 HONG KONG COMPANIES WERE CHASED AND GIVEN UP ON, 2026-09-24,
 * and the reason is not effort. Every one was identified on Wikidata by its
 * HKEX TICKER — which is what its roster id already is, so P414/P249 pins the
 * entity without a name search ever happening — and 34 of 34 matched. What
 * came back:
 *
 *   15 HAVE NO HONG KONG HEAD OFFICE AT ALL. HSBC Holdings and Swire Pacific
 *      are headquartered in London, Tencent in Shenzhen (registered in the
 *      Caymans), Alibaba and Geely in Hangzhou, Bank of China, China Mobile,
 *      China Unicom, China Life, Meituan, Xiaomi and Lenovo in Beijing, Sands
 *      China in Macau, Anta in Jinjiang. Their Hong Kong presence is a
 *      LISTING and a regional office, and this roster is a listings roster.
 *      Pinning them at their real head office would move them off the map.
 *   14 RESOLVE TO THE CITY CENTROID, 114.15861/22.27833 — the point Wikidata
 *      uses for "Hong Kong" itself. Recording that would stack fourteen pins
 *      on one spot, which is worse than the fan it replaced.
 *    4 NAME A BUILDING, and the coordinates miss it. Cheung Kong Center's
 *      lands on the Cheung Kong Park car park; AIA Central's lands on CCB
 *      TOWER, a different company's building next door. That is the
 *      near-miss geocode-au.py warns about, arriving through a chain that
 *      looked airtight.
 *
 * Wikipedia infoboxes were tried too, through the same ticker-verified chain:
 * they carry "Hong Kong" or a district, never a street.
 *
 * WHAT WOULD ACTUALLY WORK is HKEX's own Company Information Sheet, which
 * every listed issuer files and which states the registered office and the
 * principal place of business in Hong Kong. hkexnews.hk answers; finding the
 * document endpoint is the remaining work.
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
  "hongkong-00012": [114.15892, 22.284098], // Henderson Land Development — 8 Finance Street, Central, Hong Kong
  "hongkong-00016": [114.176938, 22.280329], // Sun Hung Kai Properties — 30 Harbour Road, Wan Chai, Hong Kong
  "hongkong-00011": [114.156168, 22.284572], // Hang Seng Bank — 83 Des Voeux Road Central, Hong Kong
};
