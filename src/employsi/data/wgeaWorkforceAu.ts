// GENERATED — do not edit by hand. Run scripts/gen-wgea-workforce.py.
// Real workforce headcount from the WGEA register (Workplace Gender
// Equality Act 2012: every non-public-sector employer with 100+ Australian
// staff reports annually), via the public data file on data.gov.au.
//
// TWO THINGS THIS FIGURE IS NOT, both explained at length in the generator:
//   - it is a HEAD COUNT INCLUDING CASUALS, not the FTE an annual report
//     usually leads with, which is much lower;
//   - it is AUSTRALIAN EMPLOYEES ONLY, so it is merged LAST in
//     filedHeadcount() and never displaces a global annual-report figure.
//     Rows are emitted even for companies that already have one; those are
//     never read, and exist so check-roster can test the merge order.
//
// `scope` in the trailing comment is which of the register's two name
// columns the roster name matched — the group total is used when the
// roster names the group, the employer total when it names an employer
// inside someone else's group. Reading either one alone is wrong: see the
// St Vincent's (563 vs 23,491) and Torrens (1,846 vs 1,019) cases.
//
// Source: WGEA 2024-25 public data file, as at Jun 2025, with
//         2023-24 as the prior year. Both per-employer; the 2022-23
//         file is excluded because it reports submission GROUPS.
// Filed: 223 of 859 Australian roster companies
//        (207 matched on the group name, 16 on the employer name).
//
// A company the register does not report is ABSENT, never zero — the card
// shows an em dash and says no figure was collected.
//
// `span: 0` and `yoy: null` mean the company appears in only one of the
// two files, so there is no prior reading to compare — the card prints
// the head count and an em dash for the change:
//   adelaide-cda
//   adelaide-tea
//   brisbane-ape
//   brisbane-boq
//   brisbane-dmp
//   brisbane-dtl
//   brisbane-sul
//   fmg
//   gmd
//   igo
//   jellinbah
//   ltr
//   mah
//   melbourne-anz
//   melbourne-col
//   melbourne-dnl
//   melbourne-gdg
//   melbourne-ifl
//   melbourne-jbh
//   melbourne-tls
//   mmi
//   nt-gov-batchelor-institute-of-indigenous-tertiary-education
//   nwh
//   perth-prn
//   perth-vau
//   priv-cmv-group
//   priv-deloitte-touche-tohmatsu
//   priv-drake-supermarkets
//   priv-hancock-prospecting
//   priv-mater
//   priv-minterellison
//   priv-perth-airport
//   priv-racv
//   priv-st-john-of-god-health-care
//   priv-swift-holdings-investments
//   priv-teys-australia
//   priv-unitingcare-queensland
//   priv-vgw-holdings
//   priv-village-roadshow
//   rms
//   s32
//   sydney-agl
//   sydney-aub
//   sydney-bga
//   sydney-cgf
//   sydney-dro
//   sydney-eos
//   sydney-evn
//   sydney-evt
//   sydney-org
//   sydney-qub
//   sydney-sdf
//   sydney-shl
//   sydney-vnt
//   sydney-wor
//   sydney-wow
//   uni-macquarie-university
//   uni-southern-cross-university
//   uni-swinburne-university-of-technology
//   uni-university-of-new-england
//   uni-university-of-wollongong
import type { Headcount } from "./companyHeadcount";
export const WGEA_HEADCOUNT: Record<string, Headcount> = {
  "adelaide-abc": { now: 1621, prev: 1596, yoy: 1.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Adbri Limited
  "adelaide-cda": { now: 299, prev: 299, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Codan Limited
  "adelaide-eld": { now: 3541, prev: 3373, yoy: 5.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Elders Limited
  "adelaide-tea": { now: 1789, prev: 1789, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Tasmea Limited
  "alk": { now: 312, prev: 306, yoy: 2.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Alkane Resources Ltd
  "aow": { now: 440, prev: 426, yoy: 3.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Arrow Energy Pty Ltd
  "asb": { now: 910, prev: 860, yoy: 5.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Austal Limited
  "beach": { now: 427, prev: 529, yoy: -19.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Beach Energy Limited
  "brisbane-alq": { now: 3411, prev: 3238, yoy: 5.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: ALS Limited
  "brisbane-ape": { now: 8246, prev: 8246, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Eagers Automotive Limited
  "brisbane-aqz": { now: 1161, prev: 1367, yoy: -15.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Alliance Aviation Services Limited
  "brisbane-boq": { now: 3844, prev: 3844, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Bank Of Queensland Limited
  "brisbane-ctd": { now: 870, prev: 958, yoy: -9.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Corporate Travel Management Limited
  "brisbane-dmp": { now: 1594, prev: 1594, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Domino's Pizza Enterprises Limited
  "brisbane-dtl": { now: 1339, prev: 1339, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Data#3 Limited.
  "brisbane-flt": { now: 5414, prev: 5272, yoy: 2.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Flight Centre Travel Group Limited
  "brisbane-nxt": { now: 348, prev: 315, yoy: 10.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Nextdc Limited
  "brisbane-smr": { now: 782, prev: 787, yoy: -0.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: STANMORE RESOURCES LIMITED
  "brisbane-sul": { now: 14955, prev: 14955, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Super Retail Group Limited
  "brisbane-sun": { now: 10790, prev: 13099, yoy: -17.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Suncorp Group Limited
  "brisbane-vgn": { now: 8133, prev: 7658, yoy: 6.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Virgin Australia Holdings Limited
  "ccv": { now: 174, prev: 179, yoy: -2.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Cash Converters Pty Ltd
  "fmg": { now: 12414, prev: 12414, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Fortescue Ltd
  "gmd": { now: 560, prev: 560, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: GENESIS MINERALS LIMITED
  "igo": { now: 395, prev: 395, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: IGO Limited
  "ilu": { now: 978, prev: 1033, yoy: -5.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Iluka Resources Limited
  "jellinbah": { now: 563, prev: 563, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Jellinbah Group Pty Ltd
  "ltr": { now: 290, prev: 290, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Liontown Resources Limited
  "mah": { now: 4122, prev: 4122, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Macmahon Holdings Limited
  "melbourne-4dx": { now: 88, prev: 115, yoy: -23.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: 4DMEDICAL LIMITED
  "melbourne-amc": { now: 805, prev: 760, yoy: 5.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Amcor Pty Ltd
  "melbourne-anz": { now: 21699, prev: 21699, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: ANZ GROUP HOLDINGS LIMITED
  "melbourne-arb": { now: 1173, prev: 1634, yoy: -28.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: ARB Corporation Limited
  "melbourne-ben": { now: 5529, prev: 5396, yoy: 2.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Bendigo And Adelaide Bank Limited
  "melbourne-col": { now: 115888, prev: 115888, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Coles Group Limited
  "melbourne-cpu": { now: 1181, prev: 1217, yoy: -3.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Computershare Limited
  "melbourne-csl": { now: 3153, prev: 3064, yoy: 2.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: CSL Limited
  "melbourne-dnl": { now: 1870, prev: 1870, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: DYNO NOBEL LIMITED
  "melbourne-gdg": { now: 267, prev: 267, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Generation Development Group Limited
  "melbourne-hsn": { now: 159, prev: 169, yoy: -5.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Hansen Technologies Limited
  "melbourne-ifl": { now: 4683, prev: 4683, yoy: null, asof: "Jun 2024", span: 0, unit: "headcount" },  // group: Insignia Financial Ltd
  "melbourne-jbh": { now: 15549, prev: 15549, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: JB Hi-Fi Limited
  "melbourne-lov": { now: 3586, prev: 1656, yoy: 116.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Lovisa Pty Limited
  "melbourne-nab": { now: 29519, prev: 29873, yoy: -1.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: National Australia Bank Limited
  "melbourne-ora": { now: 887, prev: 873, yoy: 1.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Orora Limited
  "melbourne-ori": { now: 2986, prev: 2910, yoy: 2.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Orica Limited
  "melbourne-rea": { now: 1821, prev: 1705, yoy: 6.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Rea Group Ltd
  "melbourne-reg": { now: 11938, prev: 10161, yoy: 17.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Regis Healthcare Limited
  "melbourne-sek": { now: 1596, prev: 1732, yoy: -7.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Seek Limited
  "melbourne-sig": { now: 859, prev: 809, yoy: 6.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Sigma Healthcare Limited
  "melbourne-tlc": { now: 902, prev: 840, yoy: 7.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: THE LOTTERY CORPORATION LIMITED
  "melbourne-tls": { now: 26557, prev: 26557, yoy: null, asof: "Jun 2024", span: 0, unit: "headcount" },  // group: Telstra Group Limited
  "min": { now: 6852, prev: 8061, yoy: -15.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Mineral Resources Limited
  "mmi": { now: 263, prev: 263, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Metro Mining Limited
  "mnd": { now: 6426, prev: 6124, yoy: 4.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Monadelphous Group Limited
  "nst": { now: 3860, prev: 3236, yoy: 19.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Northern Star Resources Ltd
  "nt-gov-batchelor-institute-of-indigenous-tertiary-education": { now: 210, prev: 210, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Batchelor Institute Of Indigenous Tertiary Education
  "nwh": { now: 5657, prev: 5657, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: NRW Holdings Limited
  "perth-bgl": { now: 226, prev: 194, yoy: 16.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: BELLEVUE GOLD LIMITED
  "perth-imd": { now: 298, prev: 291, yoy: 2.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Imdex Ltd
  "perth-lyc": { now: 295, prev: 274, yoy: 7.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Lynas Rare Earths Limited
  "perth-obm": { now: 229, prev: 207, yoy: 10.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Ora Banda Mining Ltd
  "perth-prn": { now: 4298, prev: 4298, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Perenti Limited
  "perth-vau": { now: 684, prev: 684, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Vault Minerals Limited
  "priv-abn-group": { now: 1980, prev: 1971, yoy: 0.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The Trustee for ABN Service Trust
  "priv-adco-constructions": { now: 610, prev: 693, yoy: -12.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Adco Constructions Pty Ltd
  "priv-aurecon": { now: 3966, prev: 4333, yoy: -8.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Aurecon Australasia Pty Ltd
  "priv-ausgrid": { now: 3109, prev: 3014, yoy: 3.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Ausgrid Management Pty Ltd
  "priv-australian-unity": { now: 7616, prev: 7641, yoy: -0.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Australian Unity Limited
  "priv-avant-mutual": { now: 1008, prev: 914, yoy: 10.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Avant Mutual Group Limited
  "priv-baiada-poultry": { now: 944, prev: 960, yoy: -1.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Baiada Poultry Pty Limited
  "priv-bmd-group": { now: 2224, prev: 2224, yoy: 0.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: B.M.D. Holdings Pty. Limited
  "priv-built": { now: 81, prev: 100, yoy: -19.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Built Pty Limited
  "priv-clayton-utz": { now: 1502, prev: 1500, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Clayton Utz
  "priv-cmv-group": { now: 2041, prev: 2041, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Commercial Motor Vehicles Pty Ltd
  "priv-defence-health": { now: 328, prev: 270, yoy: 21.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Defence Health Limited
  "priv-deloitte-touche-tohmatsu": { now: 10670, prev: 10670, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Deloitte Touche Tohmatsu
  "priv-drake-supermarkets": { now: 5809, prev: 5809, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Drake Supermarkets Pty Ltd
  "priv-epworth-healthcare": { now: 8063, prev: 8307, yoy: -2.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Epworth Foundation
  "priv-ey": { now: 8008, prev: 9000, yoy: -11.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The Trustee For Ernst & Young Services Trust
  "priv-firstmac": { now: 187, prev: 162, yoy: 15.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Firstmac Limited
  "priv-fitness-and-lifestyle": { now: 4639, prev: 4755, yoy: -2.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Fitness And Lifestyle Group Bidco Pty Ltd
  "priv-georgiou": { now: 895, prev: 914, yoy: -2.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Georgiou Group Pty Ltd
  "priv-ghd": { now: 5023, prev: 5228, yoy: -3.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: GHD Pty Ltd
  "priv-gmhba": { now: 471, prev: 449, yoy: 4.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: GMHBA Limited
  "priv-goodstart-early-learning": { now: 18164, prev: 17548, yoy: 3.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Goodstart Early Learning Ltd
  "priv-grand-motors": { now: 109, prev: 109, yoy: 0.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: GRAND MOTORS PTY. LTD.
  "priv-great-southern-bank": { now: 1066, prev: 1087, yoy: -1.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Credit Union Australia Ltd
  "priv-hammondcare": { now: 5557, prev: 5502, yoy: 1.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Hammondcare
  "priv-hancock-prospecting": { now: 5035, prev: 5035, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Hancock Prospecting Pty Limited
  "priv-hansen-yuncken": { now: 483, prev: 560, yoy: -13.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Hansen Yuncken Pty Ltd
  "priv-harris-farm": { now: 3256, prev: 3226, yoy: 0.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Harris Farm Markets Pty Ltd
  "priv-hbf": { now: 1495, prev: 1654, yoy: -9.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: HBF Health Limited
  "priv-hcf": { now: 1637, prev: 1575, yoy: 3.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The Hospitals Contribution Fund Of Australia Ltd
  "priv-herbert-smith-freehills": { now: 2968, prev: 1782, yoy: 66.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Herbert Smith Freehills
  "priv-j-j-richards-sons": { now: 3144, prev: 3051, yoy: 3.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: J.J. Richards & Sons Pty Ltd
  "priv-kane-constructions": { now: 510, prev: 472, yoy: 8.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Kane Constructions Pty Ltd
  "priv-kennards-hire": { now: 2078, prev: 1651, yoy: 25.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Kennards Hire Pty Limited
  "priv-kpmg": { now: 8785, prev: 9506, yoy: -7.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The Trustee For KPMG Australian Service Trust
  "priv-leader-computers": { now: 296, prev: 330, yoy: -10.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: LEADER COMPUTERS PTY LTD
  "priv-life-without-barriers": { now: 7810, prev: 8101, yoy: -3.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Life Without Barriers
  "priv-mater": { now: 10411, prev: 10411, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Mater Misericordiae Ltd
  "priv-mecca-brands": { now: 6540, prev: 6772, yoy: -3.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Mecca Brands Pty Ltd
  "priv-melbourne-airport": { now: 496, prev: 442, yoy: 12.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Australia Pacific Airports Corporation Limited
  "priv-minterellison": { now: 2283, prev: 2283, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: MinterEllison
  "priv-mort-co": { now: 270, prev: 262, yoy: 3.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Mort & Co Ltd
  "priv-newcastle-greater-mutual-group": { now: 1840, prev: 1818, yoy: 1.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Newcastle Greater Mutual Group Ltd
  "priv-patterson-cheney": { now: 690, prev: 656, yoy: 5.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Patterson Cheney Pty. Ltd.
  "priv-people-first-bank": { now: 2056, prev: 2110, yoy: -2.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Heritage and People's Choice Limited
  "priv-perth-airport": { now: 463, prev: 463, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // employer: Perth Airport Pty Ltd
  "priv-pwc-australia": { now: 6248, prev: 7020, yoy: -11.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The Trustee For The Pricewaterhousecoopers Services Trust
  "priv-queensland-sugar": { now: 220, prev: 230, yoy: -4.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Queensland Sugar Limited
  "priv-racv": { now: 4105, prev: 4105, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Royal Automobile Club Of Victoria (Racv) Limited
  "priv-richard-crookes-constructions": { now: 652, prev: 720, yoy: -9.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Richard Crookes Constructions Pty. Limited
  "priv-spotlight": { now: 6365, prev: 6301, yoy: 1.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: The Trustee For Spotlight Stores Trading Trust
  "priv-st-john-of-god-health-care": { now: 15564, prev: 15564, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: St John Of God Health Care Inc
  "priv-st-vincent-s-health-australia": { now: 23491, prev: 23178, yoy: 1.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: St Vincent's Health Australia Ltd
  "priv-stowe-australia": { now: 1658, prev: 1404, yoy: 18.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Stowe Australia Pty Limited
  "priv-swift-holdings-investments": { now: 1988, prev: 1988, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: SWIFT HOLDINGS INVESTMENTS PTY LTD
  "priv-team-global-express": { now: 6129, prev: 6450, yoy: -5.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Team Global Express Pty Ltd
  "priv-teys-australia": { now: 3450, prev: 3450, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Teys Australia Pty Ltd
  "priv-thomas-foods-international": { now: 124, prev: 99, yoy: 25.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Thomas Foods International Pty Limited
  "priv-turosi": { now: 1833, prev: 1958, yoy: -6.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Turosi Pty Ltd
  "priv-uniting": { now: 11710, prev: 10617, yoy: 10.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Uniting (NSW.ACT)
  "priv-unitingcare-queensland": { now: 16119, prev: 16119, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: UNITINGCARE QUEENSLAND LIMITED
  "priv-vgw-holdings": { now: 424, prev: 424, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: VGW Holdings Limited
  "priv-village-roadshow": { now: 4365, prev: 4365, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Village Roadshow Pty Ltd
  "priv-visy": { now: 6356, prev: 6201, yoy: 2.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Visy Industries Australia Pty Ltd
  "priv-winning-appliances": { now: 832, prev: 1074, yoy: -22.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Winning Appliances Pty Ltd
  "priv-winslow-constructors": { now: 475, prev: 438, yoy: 8.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Winslow Constructors Pty Ltd
  "priv-workpac": { now: 6155, prev: 6605, yoy: -6.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Workpac Pty Ltd
  "rio": { now: 26419, prev: 26023, yoy: 1.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Rio Tinto Limited
  "rms": { now: 324, prev: 324, yoy: null, asof: "Jun 2024", span: 0, unit: "headcount" },  // group: Ramelius Resources Limited
  "rrl": { now: 438, prev: 389, yoy: 12.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Regis Resources Limited
  "s32": { now: 4966, prev: 4966, yoy: null, asof: "Jun 2024", span: 0, unit: "headcount" },  // group: South32 Limited
  "sfr": { now: 113, prev: 104, yoy: 8.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Sandfire Resources Limited
  "smr": { now: 782, prev: 787, yoy: -0.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: STANMORE RESOURCES LIMITED
  "sto": { now: 2959, prev: 2973, yoy: -0.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Santos Limited
  "swm": { now: 3100, prev: 3651, yoy: -15.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Seven West Media Limited
  "sydney-agl": { now: 4448, prev: 4448, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: AGL Energy Limited
  "sydney-ald": { now: 8369, prev: 8355, yoy: 0.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Ampol Limited
  "sydney-all": { now: 979, prev: 976, yoy: 0.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Aristocrat Leisure Limited
  "sydney-amp": { now: 2057, prev: 2310, yoy: -11.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: AMP Limited
  "sydney-apa": { now: 2828, prev: 2745, yoy: 3.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: APA Group Limited
  "sydney-asx": { now: 1283, prev: 1106, yoy: 16.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: ASX Limited
  "sydney-aub": { now: 1519, prev: 1519, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: AUB Group Limited
  "sydney-bga": { now: 3595, prev: 3595, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Bega Cheese Limited
  "sydney-brg": { now: 491, prev: 441, yoy: 11.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Breville Group Limited
  "sydney-bxb": { now: 1200, prev: 1119, yoy: 7.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Brambles Limited
  "sydney-cba": { now: 40907, prev: 39694, yoy: 3.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Commonwealth Bank Of Australia
  "sydney-cgf": { now: 733, prev: 733, yoy: null, asof: "Jun 2024", span: 0, unit: "headcount" },  // group: Challenger Limited
  "sydney-chc": { now: 589, prev: 603, yoy: -2.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Charter Hall Limited
  "sydney-coh": { now: 2521, prev: 2281, yoy: 10.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Cochlear Limited
  "sydney-dro": { now: 302, prev: 302, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: DRONESHIELD LIMITED
  "sydney-edv": { now: 29479, prev: 28970, yoy: 1.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Endeavour Group Limited
  "sydney-eos": { now: 295, prev: 295, yoy: null, asof: "Jun 2024", span: 0, unit: "headcount" },  // group: Electro Optic Systems Holdings Limited
  "sydney-evn": { now: 2529, prev: 2529, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Evolution Mining Limited
  "sydney-evt": { now: 5349, prev: 5349, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: EVT Limited
  "sydney-iag": { now: 9156, prev: 9804, yoy: -6.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Insurance Australia Group Limited
  "sydney-lnw": { now: 292, prev: 316, yoy: -7.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Light & Wonder, Inc
  "sydney-mfg": { now: 109, prev: 124, yoy: -12.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Magellan Financial Group Ltd
  "sydney-mgr": { now: 1647, prev: 1735, yoy: -5.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Mirvac Limited
  "sydney-mqg": { now: 9376, prev: 9954, yoy: -5.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Macquarie Group Limited
  "sydney-org": { now: 5540, prev: 5540, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Origin Energy Limited
  "sydney-qan": { now: 25017, prev: 23247, yoy: 7.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Qantas Airways Limited
  "sydney-qub": { now: 7759, prev: 7759, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Qube Holdings Limited
  "sydney-rdx": { now: 389, prev: 360, yoy: 8.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Redox Limited
  "sydney-rmd": { now: 1573, prev: 1576, yoy: -0.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Resmed Inc.
  "sydney-rwc": { now: 320, prev: 348, yoy: -8.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Reliance Worldwide Corporation Limited
  "sydney-scg": { now: 2473, prev: 2501, yoy: -1.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Scentre Group Limited
  "sydney-sdf": { now: 1828, prev: 1828, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Steadfast Group Ltd
  "sydney-sgh": { now: 11003, prev: 11054, yoy: -0.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: SGH Limited
  "sydney-shl": { now: 19580, prev: 19580, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Sonic Healthcare Limited
  "sydney-tpg": { now: 3234, prev: 3372, yoy: -4.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: TPG Telecom Limited
  "sydney-vnt": { now: 13073, prev: 13073, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Ventia Services Group Limited
  "sydney-wbc": { now: 29951, prev: 29216, yoy: 2.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Westpac Banking Corporation
  "sydney-whc": { now: 3359, prev: 1498, yoy: 124.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Whitehaven Coal Limited
  "sydney-wor": { now: 2950, prev: 2950, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Worley Limited
  "sydney-wow": { now: 180963, prev: 180963, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Woolworths Group Limited
  "sydney-wtc": { now: 1429, prev: 1220, yoy: 17.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Wisetech Global Limited
  "sydney-yal": { now: 254, prev: 248, yoy: 2.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Yancoal Australia Ltd
  "uni-australian-catholic-university": { now: 3691, prev: 3772, yoy: -2.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Australian Catholic University Limited
  "uni-australian-national-university": { now: 5780, prev: 6576, yoy: -12.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Australian National University
  "uni-bond-university": { now: 1483, prev: 1399, yoy: 6.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Bond University Limited
  "uni-charles-darwin-university": { now: 2340, prev: 1986, yoy: 17.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Charles Darwin University
  "uni-charles-sturt-university": { now: 4035, prev: 3857, yoy: 4.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Charles Sturt University
  "uni-cquniversity": { now: 3460, prev: 3275, yoy: 5.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Central Queensland University
  "uni-curtin-university": { now: 7450, prev: 7450, yoy: 0.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Curtin University
  "uni-deakin-university": { now: 8596, prev: 7797, yoy: 10.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Deakin University
  "uni-edith-cowan-university": { now: 4467, prev: 3845, yoy: 16.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Edith Cowan University
  "uni-federation-university-australia": { now: 1938, prev: 1959, yoy: -1.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Federation University Australia
  "uni-flinders-university": { now: 3474, prev: 3469, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Flinders University
  "uni-griffith-university": { now: 6994, prev: 7063, yoy: -1.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Griffith University
  "uni-james-cook-university": { now: 2609, prev: 2700, yoy: -3.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: James Cook University
  "uni-la-trobe-university": { now: 5763, prev: 5759, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: La Trobe University
  "uni-macquarie-university": { now: 8227, prev: 8227, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Macquarie University
  "uni-monash-university": { now: 14925, prev: 15482, yoy: -3.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Monash University
  "uni-murdoch-university": { now: 3139, prev: 2902, yoy: 8.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Murdoch University
  "uni-queensland-university-of-technology": { now: 7002, prev: 7429, yoy: -5.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Queensland University Of Technology
  "uni-rmit-university": { now: 10033, prev: 9465, yoy: 6.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Royal Melbourne Institute Of Technology
  "uni-southern-cross-university": { now: 2318, prev: 2318, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Southern Cross University
  "uni-swinburne-university-of-technology": { now: 2846, prev: 2846, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: Swinburne University Of Technology
  "uni-torrens-university-australia": { now: 1019, prev: 1018, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Torrens University Australia Limited
  "uni-university-of-adelaide": { now: 4739, prev: 4544, yoy: 4.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The University Of Adelaide
  "uni-university-of-canberra": { now: 3270, prev: 2531, yoy: 29.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of Canberra
  "uni-university-of-melbourne": { now: 15313, prev: 15305, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of Melbourne
  "uni-university-of-new-england": { now: 2226, prev: 2226, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: The University Of New England
  "uni-university-of-new-south-wales": { now: 18091, prev: 16327, yoy: 10.8, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of New South Wales
  "uni-university-of-newcastle": { now: 6301, prev: 6332, yoy: -0.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The University Of Newcastle
  "uni-university-of-notre-dame-australia": { now: 1650, prev: 1652, yoy: -0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The University Of Notre Dame Australia
  "uni-university-of-queensland": { now: 13571, prev: 13446, yoy: 0.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: The University Of Queensland
  "uni-university-of-south-australia": { now: 4531, prev: 4384, yoy: 3.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of South Australia
  "uni-university-of-southern-queensland": { now: 3015, prev: 2569, yoy: 17.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of Southern Queensland
  "uni-university-of-sydney": { now: 18198, prev: 17663, yoy: 3.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of Sydney
  "uni-university-of-tasmania": { now: 5689, prev: 6402, yoy: -11.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of Tasmania
  "uni-university-of-the-sunshine-coast": { now: 2856, prev: 2385, yoy: 19.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of The Sunshine Coast
  "uni-university-of-western-australia": { now: 7157, prev: 6597, yoy: 8.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: University Of Western Australia
  "uni-university-of-wollongong": { now: 5723, prev: 5723, yoy: null, asof: "Jun 2025", span: 0, unit: "headcount" },  // group: The University Of Wollongong
  "uni-victoria-university": { now: 3199, prev: 2642, yoy: 21.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Victoria University
  "uni-western-sydney-university": { now: 6727, prev: 6749, yoy: -0.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Western Sydney University
  "wds": { now: 3555, prev: 3517, yoy: 1.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // employer: Woodside Energy Ltd.
  "wes": { now: 122405, prev: 118991, yoy: 2.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Wesfarmers Limited
  "wgx": { now: 1546, prev: 997, yoy: 55.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // group: Westgold Resources Limited
};
