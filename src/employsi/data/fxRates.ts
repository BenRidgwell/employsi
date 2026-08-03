// GENERATED — do not edit by hand. Run: python3 scripts/gen-fx-rates.py
//
// Foreign currency → AUD, used to put every advertised salary on one
// scale (see lib/salaryParse). Pinned rather than fetched live so the
// ticker moves when hiring moves and not when the dollar does; the
// capture date below is what the app shows readers.
export const FX_AS_AT = "2026-08-03";

export const FX_TO_AUD: Record<string, number> = {
  AUD: 1,
  USD: 1.420319,
  GBP: 1.91459,
  EUR: 1.638525,
  CAD: 1.013292,
  NZD: 0.837048,
  SGD: 1.108501,
  MYR: 0.348539,
  PHP: 0.023196,
  CNY: 0.21033,
  HKD: 0.181197,
  INR: 0.014882,
  JPY: 0.008981,
  KRW: 0.000986,
  AED: 0.386764,
  SAR: 0.378771,
  QAR: 0.390218,
  THB: 0.04255,
  IDR: 0.000079,
  CHF: 1.758582,
  ZAR: 0.086135,
};
