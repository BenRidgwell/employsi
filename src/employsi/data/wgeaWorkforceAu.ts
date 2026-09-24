// GENERATED — do not edit by hand. Run scripts/gen-wgea-workforce.py.
// Real workforce headcount for Australian universities, from the WGEA
// public data file on data.gov.au (Workplace Gender Equality Act 2012:
// every non-public-sector employer with 100+ staff reports annually).
//
// TWO THINGS THIS FIGURE IS NOT, both of which the generator's header
// explains at length:
//   - it is a HEAD COUNT INCLUDING CASUALS, not the FTE a university
//     annual report usually leads with, which is much lower;
//   - it is AUSTRALIAN EMPLOYEES ONLY, so it is merged LAST in
//     filedHeadcount() and never displaces a global annual-report figure.
//
// Source: WGEA 2024-25 public data file, as at Jun 2025, with
//         2023-24 as the prior year. Both per-employer; the 2022-23
//         file is excluded because it reports submission GROUPS.
// Filed: 40 of 41 universities on the roster.
//
// A university WGEA does not report is ABSENT, never zero — the card
// shows an em dash and says no figure was collected.
//
// `span: 0` and `yoy: null` mean the university appears in only one of
// the two files, so there is no prior reading to compare — the card
// prints the head count and an em dash for the change:
//   uni-university-of-technology-sydney
import type { Headcount } from "./companyHeadcount";
export const WGEA_HEADCOUNT: Record<string, Headcount> = {
  "uni-australian-catholic-university": { now: 3691, prev: 3772, yoy: -2.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // Australian Catholic University Limited
  "uni-australian-national-university": { now: 5762, prev: 6556, yoy: -12.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // Australian National University
  "uni-bond-university": { now: 1483, prev: 1399, yoy: 6.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // Bond University Limited
  "uni-charles-darwin-university": { now: 1968, prev: 1634, yoy: 20.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // Charles Darwin University
  "uni-charles-sturt-university": { now: 4035, prev: 3857, yoy: 4.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // Charles Sturt University
  "uni-cquniversity": { now: 3460, prev: 3275, yoy: 5.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // Central Queensland University
  "uni-curtin-university": { now: 7450, prev: 7450, yoy: 0.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // Curtin University
  "uni-deakin-university": { now: 8596, prev: 7797, yoy: 10.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // Deakin University
  "uni-edith-cowan-university": { now: 4467, prev: 3845, yoy: 16.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // Edith Cowan University
  "uni-federation-university-australia": { now: 1938, prev: 1959, yoy: -1.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // Federation University Australia
  "uni-flinders-university": { now: 3474, prev: 3469, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // Flinders University
  "uni-griffith-university": { now: 6994, prev: 7063, yoy: -1.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // Griffith University
  "uni-james-cook-university": { now: 2609, prev: 2700, yoy: -3.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // James Cook University
  "uni-la-trobe-university": { now: 5763, prev: 5759, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // La Trobe University
  "uni-macquarie-university": { now: 6465, prev: 6571, yoy: -1.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // Macquarie University
  "uni-monash-university": { now: 14387, prev: 14895, yoy: -3.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // Monash University
  "uni-murdoch-university": { now: 3139, prev: 2902, yoy: 8.2, asof: "Jun 2025", span: 1, unit: "headcount" },  // Murdoch University
  "uni-queensland-university-of-technology": { now: 7002, prev: 7429, yoy: -5.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // Queensland University Of Technology
  "uni-rmit-university": { now: 9588, prev: 8967, yoy: 6.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // Royal Melbourne Institute Of Technology
  "uni-southern-cross-university": { now: 2090, prev: 1911, yoy: 9.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // Southern Cross University
  "uni-swinburne-university-of-technology": { now: 2846, prev: 2894, yoy: -1.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // Swinburne University Of Technology
  "uni-torrens-university-australia": { now: 1019, prev: 1018, yoy: 0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // Torrens University Australia Limited
  "uni-university-of-adelaide": { now: 4739, prev: 4544, yoy: 4.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // The University Of Adelaide
  "uni-university-of-canberra": { now: 3123, prev: 2396, yoy: 30.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of Canberra
  "uni-university-of-melbourne": { now: 14921, prev: 14968, yoy: -0.3, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of Melbourne
  "uni-university-of-new-england": { now: 1989, prev: 2305, yoy: -13.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // The University Of New England
  "uni-university-of-new-south-wales": { now: 17232, prev: 15589, yoy: 10.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of New South Wales
  "uni-university-of-newcastle": { now: 6301, prev: 6332, yoy: -0.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // The University Of Newcastle
  "uni-university-of-notre-dame-australia": { now: 1650, prev: 1652, yoy: -0.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // The University Of Notre Dame Australia
  "uni-university-of-queensland": { now: 13571, prev: 13446, yoy: 0.9, asof: "Jun 2025", span: 1, unit: "headcount" },  // The University Of Queensland
  "uni-university-of-south-australia": { now: 4531, prev: 4384, yoy: 3.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of South Australia
  "uni-university-of-southern-queensland": { now: 3015, prev: 2569, yoy: 17.4, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of Southern Queensland
  "uni-university-of-sydney": { now: 18198, prev: 17663, yoy: 3.0, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of Sydney
  "uni-university-of-tasmania": { now: 5689, prev: 6402, yoy: -11.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of Tasmania
  "uni-university-of-technology-sydney": { now: 5727, prev: 5727, yoy: null, asof: "Jun 2024", span: 0, unit: "headcount" },  // University Of Technology Sydney
  "uni-university-of-the-sunshine-coast": { now: 2856, prev: 2385, yoy: 19.7, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of The Sunshine Coast
  "uni-university-of-western-australia": { now: 7157, prev: 6597, yoy: 8.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // University Of Western Australia
  "uni-university-of-wollongong": { now: 5056, prev: 5531, yoy: -8.6, asof: "Jun 2025", span: 1, unit: "headcount" },  // The University Of Wollongong
  "uni-victoria-university": { now: 3199, prev: 2642, yoy: 21.1, asof: "Jun 2025", span: 1, unit: "headcount" },  // Victoria University
  "uni-western-sydney-university": { now: 6226, prev: 6258, yoy: -0.5, asof: "Jun 2025", span: 1, unit: "headcount" },  // Western Sydney University
};
