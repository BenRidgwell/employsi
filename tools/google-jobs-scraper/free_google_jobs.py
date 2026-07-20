#!/usr/bin/env python3
"""Scrape Google Jobs with Playwright — no API credentials required.

Follows Method 1 in https://github.com/oxylabs/how-to-scrape-google-jobs. It
drives a real browser to the Google Jobs widget and reads the listing cards
directly, so it needs no paid API — but it must run from a machine/IP Google
will serve (a residential connection, not a datacenter/CI IP, which Google
blocks or shows a consent wall). It also can't see fields Google reveals only
after a click, so `salary` and exact `date` may be sparser than the API method.

Extracts, per listing: job title, company, location, posted via, listing date
and salary (whatever the card exposes without opening it).

Usage:
    pip install -r requirements.txt
    playwright install chromium
    python free_google_jobs.py "data engineer" --country au --out jobs.csv
"""
from __future__ import annotations

import argparse
import csv
import sys
from urllib.parse import quote_plus

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("Playwright is not installed. Run: pip install -r requirements.txt && playwright install chromium")

FIELDS = ["job_title", "company_name", "location", "posted_via", "date", "salary", "url"]


def build_url(query: str, country: str) -> str:
    return f"https://www.google.com/search?q={quote_plus(query)}&ibp=htl;jobs&hl=en&gl={country}"


# Read the visible listing cards from the widget. Google's class names are
# obfuscated and change periodically; these mirror the tutorial's selectors and
# are the single place to update when the markup shifts.
CARD = "div.nJXhWc ul li"
SELECTORS = {
    "job_title": "div.BjJfJf, div.tNxQIb",
    "company_name": "div.vNEEBe, div.wHYlTd",
    "location": "div.Qk80Jf:nth-of-type(1)",
    "posted_via": "div.Qk80Jf:nth-of-type(2)",
    "date": "span[aria-label*='Posted']",
    "salary": "div.I2Cbhb span[aria-hidden='true']",
}


def scrape(query: str, country: str, headless: bool) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(locale="en-US")
        page.goto(build_url(query, country), wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_selector(CARD, timeout=15000)
        except Exception:
            print("No job cards found — Google may have shown a consent/CAPTCHA wall for this IP.", file=sys.stderr)
            browser.close()
            return rows
        # Scroll the results column so Google lazy-loads more cards.
        for _ in range(6):
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(600)
        for card in page.query_selector_all(CARD):
            row = {f: "" for f in FIELDS}
            for field, sel in SELECTORS.items():
                el = card.query_selector(sel)
                if el:
                    row[field] = (el.inner_text() or "").strip()
            share = card.query_selector("div[data-share-url]")
            if share:
                row["url"] = share.get_attribute("data-share-url") or ""
            if row["job_title"]:
                rows.append(row)
        browser.close()
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description="Scrape Google Jobs with Playwright (no credentials).")
    ap.add_argument("query", help='Search phrase, e.g. "data engineer".')
    ap.add_argument("--country", default="au", help="Google gl country code. Default au.")
    ap.add_argument("--out", default="jobs.csv", help="Output CSV path (default jobs.csv).")
    ap.add_argument("--headful", action="store_true", help="Show the browser window (helps clear a consent wall).")
    args = ap.parse_args()

    rows = scrape(args.query, args.country, headless=not args.headful)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} job(s) to {args.out}")


if __name__ == "__main__":
    main()
