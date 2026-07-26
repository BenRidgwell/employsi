// GENERATED — do not edit by hand. Run scripts/fetch-private-facts.py.
// Source-attributed public facts for the Top-150 private companies.
//
// glassdoorRating is the employer's real Glassdoor overall rating (out of 5).
// employeeBand is Glassdoor's self-reported company-size BAND — deliberately
// NOT treated as a headcount: a band cannot yield a year-on-year figure, and
// these companies file no public accounts, so an audited headcount/YoY is not
// automatable for them. Anything absent stays "not disclosed" on the card
// rather than being estimated.
//
// Empty until the fetch workflow has run (it needs the Oxylabs credentials,
// which only exist as GitHub secrets — Glassdoor 403s datacenter IPs).

export interface PrivateFacts {
  glassdoorRating?: number;
  employeeBand?: string;
}

export const PRIVATE_COMPANY_FACTS: Record<string, PrivateFacts> = {};
