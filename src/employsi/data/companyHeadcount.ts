// GENERATED — do not edit by hand. Run scripts/gen-headcount.py.
// Real workforce headcount for the current + prior reporting year, sourced
// from each company's annual report (via stockanalysis.com, which refreshes
// once per year after each filing). Static by design — there is no live HRIS/
// LinkedIn feed — with the year-on-year growth % computed from now vs prev.
//
// `span` is the YEARS BETWEEN the two readings, and it is not always 1.
// The aggregator skips years for some companies — Qantas runs Jun 2026,
// Jun 2023, Jun 2022 — so its two newest rows are three years apart and
// calling their difference year-on-year reported +60.0%. `yoy` is null
// where the span could not be established at all; where it is known the
// card names it rather than assuming a year.
export interface Headcount {
  now: number;
  /**
   * The earlier reading. OPTIONAL, because some sources have no
   * comparator to give: Western Australia restructured its
   * departments in 2025, so the 2025-26 workforce bulletin reports a
   * Department of Transport and Major Infrastructure that the 2024-25
   * edition has never heard of — it was assembled that year out of
   * parts of two others. Absent means "no prior reading exists",
   * which is why it is absent rather than 0: a 0 would be a reading
   * of nobody, and every consumer here treats 0 as unknown already.
   * `yoy` is null alongside it and the card shows no delta.
   */
  prev?: number;
  /** Change from `prev` to `now`, over `span` years. Null when unknown. */
  yoy: number | null;
  asof: string;
  /** Years between the two readings. 0 when the source did not say. */
  span: number;
  /**
   * What the figure COUNTS. Listed companies and most public-sector
   * bulletins report people; Queensland publishes only full-time
   * equivalents at agency level, and FTE is systematically lower than a
   * head count because a part-timer is a fraction of one. The card
   * labels the tile from this rather than calling both "Headcount".
   */
  unit?: "headcount" | "fte";
}
export const COMPANY_HEADCOUNT: Record<string, Headcount> = {
  'adelaide-age': { now: 41, prev: 32, yoy: 28.1, asof: 'Jun 2024', span: 1 },
  'adelaide-c79': { now: 236, prev: 207, yoy: 14.0, asof: 'Jun 2026', span: 1 },
  'adelaide-coe': { now: 140, prev: 133, yoy: 5.3, asof: 'Jun 2026', span: 1 },
  'adelaide-tea': { now: 8000, prev: 1800, yoy: 344.4, asof: 'Jun 2026', span: 1 },
  'asb': { now: 5316, prev: 4479, yoy: 18.7, asof: 'Jun 2026', span: 1 },
  'bhp': { now: 40238, prev: 40648, yoy: -1.0, asof: 'Jun 2026', span: 1 },
  'boe': { now: 140, prev: 125, yoy: 12.0, asof: 'Jun 2026', span: 1 },
  'brisbane-alq': { now: 23342, prev: 20515, yoy: 13.8, asof: 'Mar 2026', span: 1 },
  'brisbane-aqz': { now: 1350, prev: 1452, yoy: -7.0, asof: 'Jun 2026', span: 1 },
  'brisbane-azj': { now: 5997, prev: 5988, yoy: 0.2, asof: 'Jun 2026', span: 1 },
  'brisbane-boq': { now: 3394, prev: 3558, yoy: -4.6, asof: 'Feb 2026', span: 1 },
  'brisbane-crn': { now: 1951, prev: 1878, yoy: 3.9, asof: 'Dec 2024', span: 1 },
  'brisbane-ctd': { now: 3192, prev: 3206, yoy: -0.4, asof: 'Jun 2024', span: 1 },
  'brisbane-dtl': { now: 1427, prev: 1446, yoy: -1.3, asof: 'Jun 2026', span: 1 },
  'brisbane-elv': { now: 246, prev: 230, yoy: 7.0, asof: 'Jun 2026', span: 1 },
  'brisbane-flt': { now: 12365, prev: 12411, yoy: -0.4, asof: 'Jun 2026', span: 1 },
  'brisbane-mp1': { now: 663, prev: 350, yoy: 89.4, asof: 'Jun 2026', span: 1 },
  'brisbane-nsr': { now: 679, prev: 670, yoy: 1.3, asof: 'Jun 2025', span: 1 },
  'brisbane-sul': { now: 15643, prev: 15981, yoy: -2.1, asof: 'Jun 2026', span: 1 },
  'brisbane-sun': { now: 11500, prev: 11500, yoy: 0.0, asof: 'Jun 2026', span: 1 },
  'brisbane-tne': { now: 1500, prev: 1300, yoy: 15.4, asof: 'Sep 2025', span: 1 },
  'brisbane-vgn': { now: 8000, prev: 8000, yoy: 0.0, asof: 'Jun 2026', span: 1 },
  'chevron': { now: 43039, prev: 45298, yoy: -5.0, asof: 'Dec 2025', span: 1 },
  'cmm': { now: 171, prev: 12, yoy: 1325.0, asof: 'Jun 2026', span: 7 },
  'fmg': { now: 15745, prev: 16000, yoy: null, asof: 'Dec 2025', span: 0 },
  'gmd': { now: 799, prev: 603, yoy: 32.5, asof: 'Jun 2026', span: 1 },
  'igo': { now: 358, prev: 288, yoy: 24.3, asof: 'Jun 2026', span: 7 },
  'ilu': { now: 1000, prev: 1000, yoy: 0.0, asof: 'Dec 2025', span: 1 },
  'ltr': { now: 302, prev: 289, yoy: 4.5, asof: 'Jun 2026', span: 1 },
  'mah': { now: 8796, prev: 10220, yoy: -13.9, asof: 'Jun 2026', span: 1 },
  'melbourne-4dx': { now: 124, prev: 145, yoy: -14.5, asof: 'Jun 2025', span: 1 },
  'melbourne-ann': { now: 15000, prev: 15000, yoy: 0.0, asof: 'Jun 2026', span: 1 },
  'melbourne-anz': { now: 40072, prev: 42698, yoy: -6.2, asof: 'Mar 2026', span: 1 },
  'melbourne-ben': { now: 4601, prev: 4762, yoy: -3.4, asof: 'Jun 2026', span: 1 },
  'melbourne-car': { now: 2900, prev: 2500, yoy: 16.0, asof: 'Jun 2026', span: 1 },
  'melbourne-col': { now: 115000, prev: 115000, yoy: 0.0, asof: 'Jun 2026', span: 1 },
  'melbourne-cpu': { now: 11625, prev: 12891, yoy: -9.8, asof: 'Jun 2026', span: 1 },
  'melbourne-csl': { now: 29000, prev: 29904, yoy: -3.0, asof: 'Jun 2026', span: 1 },
  'melbourne-cwy': { now: 9700, prev: 10000, yoy: -3.0, asof: 'Jun 2026', span: 1 },
  'melbourne-dnl': { now: 5500, prev: 5600, yoy: -1.8, asof: 'Sep 2025', span: 1 },
  'melbourne-hsn': { now: 1516, prev: 1643, yoy: -7.7, asof: 'Jun 2026', span: 1 },
  'melbourne-jbh': { now: 17000, prev: 16000, yoy: 6.2, asof: 'Jun 2026', span: 1 },
  'melbourne-mpl': { now: 5001, prev: 3604, yoy: 38.8, asof: 'Jun 2026', span: 1 },
  'melbourne-msb': { now: 108, prev: 81, yoy: 33.3, asof: 'Jun 2026', span: 1 },
  'melbourne-nab': { now: 42471, prev: 41880, yoy: 1.4, asof: 'Mar 2026', span: 1 },
  'melbourne-nwl': { now: 790, prev: 636, yoy: 24.2, asof: 'Jun 2026', span: 1 },
  'melbourne-ora': { now: 4512, prev: 4371, yoy: 3.2, asof: 'Jun 2026', span: 1 },
  'melbourne-ori': { now: 14000, prev: 14000, yoy: 0.0, asof: 'Sep 2025', span: 1 },
  'melbourne-pme': { now: 153, prev: 132, yoy: 15.9, asof: 'Jun 2026', span: 1 },
  'melbourne-pxa': { now: 825, prev: 900, yoy: -8.3, asof: 'Jun 2026', span: 1 },
  'melbourne-rea': { now: 1921, prev: 3418, yoy: -43.8, asof: 'Jun 2026', span: 1 },
  'melbourne-reg': { now: 13000, prev: 12000, yoy: 8.3, asof: 'Jun 2026', span: 1 },
  'melbourne-reh': { now: 9000, prev: 9001, yoy: -0.0, asof: 'Jun 2026', span: 1 },
  'melbourne-sek': { now: 3091, prev: 3245, yoy: -4.7, asof: 'Jun 2026', span: 1 },
  'melbourne-tcl': { now: 3957, prev: 4100, yoy: -3.5, asof: 'Jun 2026', span: 1 },
  'melbourne-tlc': { now: 900, prev: 800, yoy: 12.5, asof: 'Jun 2025', span: 1 },
  'melbourne-tls': { now: 29334, prev: 30553, yoy: -4.0, asof: 'Jun 2026', span: 1 },
  'melbourne-tlx': { now: 1184, prev: 431, yoy: 174.7, asof: 'Dec 2025', span: 1 },
  'melbourne-twe': { now: 2700, prev: 2500, yoy: 8.0, asof: 'Jun 2026', span: 1 },
  'melbourne-vcx': { now: 1246, prev: 1257, yoy: -0.9, asof: 'Jun 2025', span: 1 },
  'melbourne-vea': { now: 15174, prev: 15201, yoy: -0.2, asof: 'Dec 2025', span: 1 },
  'min': { now: 7266, prev: 8456, yoy: -14.1, asof: 'Jun 2026', span: 2 },
  'mnd': { now: 7482, prev: 7375, yoy: 1.5, asof: 'Jun 2026', span: 1 },
  'nhc': { now: 1575, prev: 1084, yoy: 45.3, asof: 'Jul 2025', span: 1 },
  'nst': { now: 10062, prev: 3383, yoy: 197.4, asof: 'Jun 2026', span: 5 },
  'nwh': { now: 13300, prev: 8800, yoy: 51.1, asof: 'Jun 2026', span: 1 },
  'pdn': { now: 549, prev: 500, yoy: 9.8, asof: 'Jun 2026', span: 1 },
  'perth-aa': { now: 14900, prev: 13900, yoy: 7.2, asof: 'Dec 2025', span: 1 },
  'perth-drr': { now: 11, prev: 8, yoy: 37.5, asof: 'Jun 2024', span: 1 },
  'perth-emr': { now: 398, prev: 363, yoy: 9.6, asof: 'Jun 2026', span: 1 },
  'perth-ggp': { now: 560, prev: 32, yoy: 1650.0, asof: 'Jun 2026', span: 2 },
  'perth-imd': { now: 1057, prev: 816, yoy: 29.5, asof: 'Jun 2026', span: 1 },
  'perth-lyc': { now: 1156, prev: 1127, yoy: 2.6, asof: 'Jun 2026', span: 1 },
  'perth-prn': { now: 10000, prev: 10290, yoy: -2.8, asof: 'Jun 2026', span: 1 },
  'pls': { now: 1175, prev: 950, yoy: 23.7, asof: 'Jun 2026', span: 1 },
  'rio': { now: 56865, prev: 55561, yoy: 2.3, asof: 'Dec 2025', span: 1 },
  'rms': { now: 380, prev: 250, yoy: 52.0, asof: 'Jun 2026', span: 1 },
  'rrl': { now: 460, prev: 419, yoy: 9.8, asof: 'Jun 2026', span: 1 },
  's32': { now: 6867, prev: 8892, yoy: -22.8, asof: 'Jun 2026', span: 1 },
  'sfr': { now: 1503, prev: 1355, yoy: 10.9, asof: 'Jun 2026', span: 1 },
  'shell': { now: 85000, prev: 96000, yoy: -11.5, asof: 'Dec 2025', span: 1 },
  'sto': { now: 4028, prev: 3958, yoy: 1.8, asof: 'Dec 2025', span: 1 },
  'sydney-ald': { now: 13500, prev: 9500, yoy: 42.1, asof: 'Jun 2026', span: 1 },
  'sydney-all': { now: 7300, prev: 7400, yoy: -1.4, asof: 'Mar 2026', span: 1 },
  'sydney-amp': { now: 2275, prev: 2366, yoy: -3.8, asof: 'Dec 2025', span: 1 },
  'sydney-apa': { now: 2700, prev: 2000, yoy: 35.0, asof: 'Jun 2024', span: 3 },
  'sydney-asx': { now: 1453, prev: 1331, yoy: 9.2, asof: 'Jun 2026', span: 1 },
  'sydney-aub': { now: 2697, prev: 2859, yoy: -5.7, asof: 'Jun 2026', span: 1 },
  'sydney-brg': { now: 1239, prev: 1119, yoy: 10.7, asof: 'Jun 2026', span: 1 },
  'sydney-bsl': { now: 15800, prev: 16500, yoy: -4.2, asof: 'Jun 2026', span: 1 },
  'sydney-bxb': { now: 12000, prev: 12058, yoy: -0.5, asof: 'Jun 2026', span: 1 },
  'sydney-cba': { now: 55009, prev: 55024, yoy: -0.0, asof: 'Jun 2026', span: 1 },
  'sydney-cgf': { now: 522, prev: 545, yoy: -4.2, asof: 'Jun 2026', span: 1 },
  'sydney-coh': { now: 5400, prev: 5500, yoy: -1.8, asof: 'Jun 2026', span: 1 },
  'sydney-dow': { now: 22800, prev: 26000, yoy: -12.3, asof: 'Jun 2026', span: 1 },
  'sydney-dro': { now: 535, prev: 450, yoy: 18.9, asof: 'Jun 2026', span: 1 },
  'sydney-dxs': { now: 836, prev: 900, yoy: -7.1, asof: 'Jun 2026', span: 1 },
  'sydney-edv': { now: 30000, prev: 30000, yoy: 0.0, asof: 'Jun 2026', span: 1 },
  'sydney-eos': { now: 436, prev: 496, yoy: -12.1, asof: 'Dec 2025', span: 1 },
  'sydney-gmg': { now: 1061, prev: 1030, yoy: 3.0, asof: 'Jun 2026', span: 1 },
  'sydney-gqg': { now: 239, prev: 236, yoy: 1.3, asof: 'Dec 2025', span: 1 },
  'sydney-gyg': { now: 16000, prev: 13000, yoy: 23.1, asof: 'Jun 2026', span: 1 },
  'sydney-hub': { now: 1096, prev: 962, yoy: 13.9, asof: 'Jun 2026', span: 1 },
  'sydney-hvn': { now: 6500, prev: 6500, yoy: 0.0, asof: 'Jun 2024', span: 1 },
  'sydney-iag': { now: 12763, prev: 15000, yoy: -14.9, asof: 'Jun 2026', span: 10 },
  'sydney-jhx': { now: 7500, prev: 5860, yoy: 28.0, asof: 'Mar 2026', span: 1 },
  'sydney-lnw': { now: 6800, prev: 6800, yoy: 0.0, asof: 'Dec 2025', span: 1 },
  'sydney-mff': { now: 17, prev: 1, yoy: null, asof: 'Dec 2025', span: 0 },
  'sydney-mfg': { now: 113, prev: 111, yoy: 1.8, asof: 'Jun 2026', span: 1 },
  'sydney-mgr': { now: 1643, prev: 1651, yoy: -0.5, asof: 'Jun 2026', span: 1 },
  'sydney-mqg': { now: 19124, prev: 19735, yoy: -3.1, asof: 'Mar 2026', span: 1 },
  'sydney-mts': { now: 14000, prev: 11500, yoy: 21.7, asof: 'Apr 2026', span: 1 },
  'sydney-org': { now: 5369, prev: 5420, yoy: -0.9, asof: 'Jun 2026', span: 1 },
  'sydney-ppt': { now: 1764, prev: 1789, yoy: -1.4, asof: 'Jun 2026', span: 1 },
  'sydney-qan': { now: 32000, prev: 20000, yoy: 60.0, asof: 'Jun 2026', span: 3 },
  'sydney-qbe': { now: 13196, prev: 13275, yoy: -0.6, asof: 'Dec 2025', span: 1 },
  'sydney-qub': { now: 10000, prev: 10000, yoy: 0.0, asof: 'Jun 2025', span: 1 },
  'sydney-rdx': { now: 488, prev: 476, yoy: 2.5, asof: 'Jun 2026', span: 1 },
  'sydney-rhc': { now: 92400, prev: 90000, yoy: 2.7, asof: 'Jun 2026', span: 1 },
  'sydney-rwc': { now: 2554, prev: 2900, yoy: -11.9, asof: 'Jun 2025', span: 1 },
  'sydney-scg': { now: 2799, prev: 2860, yoy: -2.1, asof: 'Dec 2025', span: 1 },
  'sydney-sgh': { now: 10607, prev: 11006, yoy: -3.6, asof: 'Jun 2026', span: 1 },
  'sydney-sgm': { now: 4015, prev: 3916, yoy: 2.5, asof: 'Jun 2026', span: 1 },
  'sydney-shl': { now: 45000, prev: 42000, yoy: 7.1, asof: 'Jun 2025', span: 1 },
  'sydney-sol': { now: 56, prev: 51, yoy: 9.8, asof: 'Jul 2024', span: 1 },
  'sydney-tpg': { now: 2784, prev: 2745, yoy: 1.4, asof: 'Jun 2026', span: 1 },
  'sydney-vnt': { now: 15000, prev: 15000, yoy: 0.0, asof: 'Jun 2026', span: 1 },
  'sydney-wbc': { now: 33305, prev: 35236, yoy: -5.5, asof: 'Mar 2026', span: 1 },
  'sydney-whc': { now: 6317, prev: 4221, yoy: 49.7, asof: 'Jun 2026', span: 1 },
  'sydney-wor': { now: 33936, prev: 38224, yoy: -11.2, asof: 'Jun 2026', span: 1 },
  'sydney-wow': { now: 209026, prev: 202846, yoy: 3.0, asof: 'Jun 2026', span: 1 },
  'sydney-wtc': { now: 5500, prev: 3600, yoy: 52.8, asof: 'Jun 2026', span: 1 },
  'sydney-yal': { now: 3900, prev: 3828, yoy: 1.9, asof: 'Jun 2026', span: 1 },
  'sydney-zip': { now: 877, prev: 1040, yoy: -15.7, asof: 'Jun 2026', span: 3 },
  'wds': { now: 4693, prev: 4718, yoy: -0.5, asof: 'Dec 2025', span: 1 },
  'wes': { now: 100000, prev: 118000, yoy: -15.3, asof: 'Jun 2026', span: 1 },
  'wgx': { now: 1744, prev: 1572, yoy: 10.9, asof: 'Jun 2026', span: 1 },
};
