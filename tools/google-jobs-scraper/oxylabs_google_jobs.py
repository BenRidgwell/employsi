#!/usr/bin/env python3
"""Scrape Google Jobs via the Oxylabs Web Scraper API.

Follows the approach in https://github.com/oxylabs/how-to-scrape-google-jobs
(Method 2 — production scale). Google renders its jobs widget with JavaScript
and blocks datacenter IPs, so a plain request can't reach the listings. The
Oxylabs API renders the page for us and parses it server-side with the XPath
rules below, returning structured JSON we write to CSV.

Extracts, per listing:
    * Job title
    * Company name
    * Job location
    * Job posted via [platform]
    * Job listing date
    * Salary
  (+ the listing's share URL, handy for de-duping and linking)

Credentials: create a free Oxylabs Web Scraper API trial and export
    OXYLABS_USERNAME / OXYLABS_PASSWORD
before running. Nothing is hard-coded.

Usage:
    export OXYLABS_USERNAME=... OXYLABS_PASSWORD=...
    python oxylabs_google_jobs.py "data engineer" --country au \
        --geo "Perth,Western Australia,Australia" --out jobs.csv
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from typing import Any
from urllib.parse import quote_plus

import requests

REALTIME_ENDPOINT = "https://realtime.oxylabs.io/v1/queries"

# The six fields the app cares about, expressed as XPath against Google's
# rendered jobs widget. These mirror the selectors in the Oxylabs tutorial; if
# Google reshuffles its markup, only these need updating.
PARSING_INSTRUCTIONS: dict[str, Any] = {
    "jobs": {
        "_fns": [{"_fn": "xpath", "_args": ["//div[@class='nJXhWc']//ul/li"]}],
        "_items": {
            "job_title": {"_fns": [{"_fn": "xpath_one", "_args": [".//div[@class='BjJfJf PUpOsf']/text()"]}]},
            "company_name": {"_fns": [{"_fn": "xpath_one", "_args": [".//div[@class='vNEEBe']/text()"]}]},
            "location": {"_fns": [{"_fn": "xpath_one", "_args": [".//div[@class='Qk80Jf'][1]/text()"]}]},
            "posted_via": {"_fns": [{"_fn": "xpath_one", "_args": [".//div[@class='Qk80Jf'][2]/text()"]}]},
            "date": {"_fns": [{"_fn": "xpath_one", "_args": [".//div[@class='PuiEXc']//span[@class='LL4CDc' and contains(@aria-label, 'Posted')]/span/text()"]}]},
            "salary": {"_fns": [{"_fn": "xpath_one", "_args": [".//div[@class='PuiEXc']//div[@class='I2Cbhb bSuYSc']//span[@aria-hidden='true']/text()"]}]},
            "url": {"_fns": [{"_fn": "xpath_one", "_args": [".//div[@data-share-url]/@data-share-url"]}]},
        },
    }
}

FIELDS = ["job_title", "company_name", "location", "posted_via", "date", "salary", "url"]


def build_url(query: str, country: str) -> str:
    # ibp=htl;jobs opens the Google Jobs widget; hl/gl localise it.
    return f"https://www.google.com/search?q={quote_plus(query)}&ibp=htl;jobs&hl=en&gl={country}"


def scrape(query: str, country: str, geo: str, user: str, password: str) -> list[dict[str, str]]:
    payload = {
        "source": "google",
        "url": build_url(query, country),
        "render": "html",
        "parse": True,
        "parsing_instructions": PARSING_INSTRUCTIONS,
    }
    if geo:
        payload["geo_location"] = geo

    resp = requests.post(REALTIME_ENDPOINT, auth=(user, password), json=payload, timeout=180)
    if resp.status_code == 401:
        sys.exit("Oxylabs rejected the credentials (401). Check OXYLABS_USERNAME / OXYLABS_PASSWORD.")
    resp.raise_for_status()
    data = resp.json()

    rows: list[dict[str, str]] = []
    for result in data.get("results", []):
        content = result.get("content") or {}
        for job in content.get("jobs", []) or []:
            rows.append({f: (job.get(f) or "").strip() if isinstance(job.get(f), str) else (job.get(f) or "") for f in FIELDS})
    return rows


def write_csv(rows: list[dict[str, str]], out: str) -> None:
    with open(out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description="Scrape Google Jobs via the Oxylabs API.")
    ap.add_argument("query", help='Search phrase, e.g. "data engineer" or "BHP".')
    ap.add_argument("--country", default="au", help="Google gl country code (au, us, gb, ...). Default au.")
    ap.add_argument("--geo", default="", help='Oxylabs geo_location, e.g. "Perth,Western Australia,Australia".')
    ap.add_argument("--out", default="jobs.csv", help="Output CSV path (default jobs.csv).")
    args = ap.parse_args()

    user = os.environ.get("OXYLABS_USERNAME")
    password = os.environ.get("OXYLABS_PASSWORD")
    if not user or not password:
        sys.exit("Set OXYLABS_USERNAME and OXYLABS_PASSWORD in the environment first.")

    t0 = time.time()
    rows = scrape(args.query, args.country, args.geo, user, password)
    write_csv(rows, args.out)
    print(f"Wrote {len(rows)} job(s) to {args.out} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
