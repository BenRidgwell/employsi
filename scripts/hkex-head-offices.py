#!/usr/bin/env python3
"""Read Hong Kong head-office addresses out of HKEX annual reports.

Why this exists rather than a geocoder over company names: every cheaper route
was measured and produces plausible wrong answers. Wikidata, gated on the HKEX
ticker so no name search is involved, matches all 34 of our Hong Kong roster
companies and still gives nothing usable -- fifteen name a head office outside
Hong Kong (HSBC in London, China Mobile in Beijing), fourteen return the
territory's own centroid, and the four that name a building have coordinates
that land on the building NEXT DOOR. Wikipedia infoboxes carry a district and
never a street. The filings are the only source that has to be right, because
the exchange makes issuers state it.

The chain, and every link is gated:

  1. stock code -> stockId, from HKEXnews' own active-securities list. Our Hong
     Kong roster ids ARE the stock codes, so the company's name never enters.
  2. stockId -> latest annual report, through titleSearchServlet.do with
     t1code=40000. Note the capital S: titlesearchservlet.do 404s.
     (t1code=53000, "Company Information Sheet", is a GEM filing -- the whole
     category holds 38 documents and none of our companies file one.)
  3. the report's corporate-information page -> the address under an explicit
     label. Never the first address on the page: Swire's own report mentions
     979 King's Road eight times because it built it, and 88 Queensway seven,
     and only the second sits under "Registered Office".
  4. address -> coordinate, through als.gov.hk, the Hong Kong government's
     address gazetteer, accepted only when the street name AND building number
     it returns are the ones the filing stated.

A company whose filing states no Hong Kong address is reported as such and left
alone; HSBC Holdings gives 8 Canada Square, London across 377 pages and Ping An
gives Futian District, Shenzhen. Neither is a gap to fill from a weaker source.

WHAT IT GETS, measured over the 38-company Hong Kong roster on 2026-09-24: 26
resolved, and all 26 agreed with the hand-read values in asiaRealCoords.ts --
23 of them to within 30 m, the other three explained in that file. The rest
need the corporate-information page read by eye, because the label and the
address sit in different columns in a layout this cannot reliably pair. So
treat a miss as "go and look", not as "no address exists". It also cannot see
Hang Seng Bank: HKEXnews' active-securities list has no 00011 record, so step 1
has nothing to resolve.

Needs pymupdf. Reports are 3-46MB each and are deleted after reading.

  python3 scripts/hkex-head-offices.py 00700 00005     # named codes
  python3 scripts/hkex-head-offices.py --roster        # every Hong Kong id
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)
NEWS = "https://www1.hkexnews.hk"
STOCKS = f"{NEWS}/ncms/script/eds/activestock_sehk_e.json"
SEARCH = f"{NEWS}/search/titleSearchServlet.do"
ALS = "https://www.als.gov.hk/lookup"

# Label priority. 0 says outright that this is the Hong Kong office, so it wins
# over a registered office that may be in the Caymans.
LABELS = [
    (0, r"^(principal place of business|head office|principal office|registered office)"
        r"[^\n]{0,40}\bin hong kong\b"),
    (0, r"^(head office|principal office)\s*(and|&|/)\s*principal place of business"),
    (0, r"^(registered office)\s*(and|&|/)\s*(head office|principal place of business)"),
    (0, r"^principal place of business\s*(and|&|/)\s*registered office"),
    (0, r"^hong kong (head )?office\b"),
    (1, r"^(head office|principal place of business|principal office)\s*:?\s*$"),
    (2, r"^registered office\s*:?\s*$"),
]
LABELS = [(p, re.compile(r, re.I)) for p, r in LABELS]

# The same statement in prose, which is where HK-incorporated issuers put it --
# note 1 to the financial statements, or the Report of the Directors.
# The capture runs to the first "Hong Kong" or "Kowloon" rather than to a full
# stop, because a Hong Kong address is full of them: "29/F., Three Pacific
# Place" ends a sentence four characters in as far as a regex is concerned.
PROSE = [
    re.compile(p + r"\s*([^;]{10,200}?(?:Hong Kong|Kowloon))\b", re.I)
    for p in (
        r"address of (?:its )?registered office is(?: at)?",
        r"address of (?:its )?principal place of business is(?: at)?",
        r"registered office is(?: located)? at",
        r"registered office and principal place of business is(?: at)?",
        r"domiciled in Hong Kong[^;]{0,40}?has office at",
        r"principal place of business(?: in Hong Kong)? is(?: located)? at",
        r"Hong Kong principal place of business at",
        r"business address of our directors and executive officers is",
        r"Contact Us Address:",
    )
]

HK = re.compile(
    r"\b(hong kong|kowloon|new territories|central|admiralty|wan ?chai|causeway bay|"
    r"quarry bay|north point|kwun tong|hung hom|sha ?tin|sheung wan|tsim sha tsui|"
    r"kwai chung|kowloon bay|queensway|taikoo|tai koo)\b",
    re.I,
)
NOT_HK = re.compile(
    r"\b(cayman|bermuda|british virgin|london|new york|singapore|beijing|shanghai|"
    r"shenzhen|hangzhou|macau|macao|jinjiang|delaware)\b",
    re.I,
)
STREET = re.compile(
    r"\b(road|street|avenue|lane|drive|queensway|path|terrace|praya|centre|center|"
    r"tower|plaza|building|house|square|garden|place)\b",
    re.I,
)


def curl(url: str, out: str | None = None) -> str:
    cmd = ["curl", "-sL", "-A", UA, "-H", f"Referer: {NEWS}/search/titlesearch.xhtml",
           "--max-time", "600"]
    if out:
        subprocess.run(cmd + ["-o", out, url], check=True)
        return ""
    return subprocess.run(cmd + [url], capture_output=True, text=True).stdout


def latest_report(code: str) -> dict | None:
    """The newest annual report for a stock code, smallest file on its date."""
    if not hasattr(latest_report, "_stocks"):
        latest_report._stocks = {r["c"]: r for r in json.loads(curl(STOCKS))}
    rec = latest_report._stocks.get(code.zfill(5))
    if not rec:
        return None
    q = urllib.parse.urlencode(
        dict(sortDir="0", sortByOptions="DateTime", category="0", market="SEHK",
             documentType="-1", t2Gcode="-2", t2code="-2", rowRange="50", lang="E",
             title="", stockId=str(rec["i"]), searchType="1", t1code="40000",
             fromDate=time.strftime("%Y0101", time.localtime(time.time() - 2 * 365 * 86400)),
             toDate=time.strftime("%Y%m%d")))
    try:
        rows = json.loads(json.loads(curl(f"{SEARCH}?{q}"))["result"])
    except Exception:
        return None
    picks = [r for r in rows if "annual report" in r["TITLE"].lower()] or \
            [r for r in rows if "interim" in r["TITLE"].lower()]
    if not picks:
        return None
    day = picks[0]["DATE_TIME"][:10]
    same = [r for r in picks if r["DATE_TIME"][:10] == day]

    def mb(r: dict) -> float:
        f = r["FILE_INFO"].upper().strip()
        try:
            return float(f.rstrip("KMB").strip()) * (1 if "M" in f else 0.001)
        except ValueError:
            return 999.0

    r = min(same, key=mb)
    return dict(title=r["TITLE"], date=r["DATE_TIME"], link=NEWS + r["FILE_LINK"],
                name=r["STOCK_NAME"])


def read_address(pdf: str) -> tuple[int, str, str] | None:
    """(priority, label, address) from the corporate-information page or the
    prose statement -- whichever gives a Hong Kong street address first."""
    import pymupdf

    def flat(s: str) -> str:
        return re.sub(r"[ \t]+", " ", s.replace("’", "'")).strip()

    doc = pymupdf.open(pdf)
    found: list[tuple[int, str, str]] = []
    for pno in range(len(doc)):
        page = doc[pno]
        blocks = [b for b in page.get_text("blocks") if b[4].strip()]
        for i, b in enumerate(blocks):
            head = flat(b[4]).split("\n")[0]
            pri = next((p for p, rx in LABELS if rx.search(head)), None)
            if pri is None:
                continue
            # The address sits under the label in the same block, or -- in the
            # column layouts these pages use -- in the next block of the same
            # column. Both shapes occur, sometimes in one report.
            body = [l for l in (flat(x) for x in b[4].split("\n")[1:]) if l]
            if not body:
                for nb in blocks[i + 1:]:
                    # Below the label in the same column, or beside it: these
                    # pages use both a stacked and a label/value layout, and a
                    # few reports use one of each on facing pages.
                    below = abs(nb[0] - b[0]) <= 90 and nb[1] >= b[3] - 2
                    beside = nb[0] > b[2] - 4 and abs(nb[1] - b[1]) <= 14
                    if not (below or beside):
                        continue
                    lines = [l for l in (flat(x) for x in nb[4].split("\n")) if l]
                    if not lines or any(rx.search(lines[0]) for _, rx in LABELS):
                        break
                    body += lines
                    if HK.search(lines[-1]) or len(body) > 7:
                        break
            if body:
                found.append((pri, head, ", ".join(body[:7])))
        text = re.sub(r"\s+", " ", page.get_text())
        for rx in PROSE:
            for m in rx.finditer(text):
                found.append((1, "prose statement", m.group(1).strip(" ,;")))
    doc.close()
    good = [f for f in found
            if HK.search(f[2]) and not NOT_HK.search(f[2]) and STREET.search(f[2])]
    good.sort(key=lambda f: f[0])
    return good[0] if good else None


def geocode(address: str) -> dict | None:
    """The Hong Kong government gazetteer, gated on street name and number."""
    # The prefix is optional: "88 Queensway" is a whole street name, with no
    # word in front of the street type at all.
    m = re.search(r"\b(\d+[A-Z]?(?:-\d+)?)\s+((?:[A-Z][A-Za-z'’ ]*?)?"
                  r"(?:Road|Street|Avenue|Lane|Drive|Path|Place|Queensway|Terrace|Praya))\b",
                  address)
    if not m:
        return None
    num, street = m.group(1), m.group(2)
    want = {w for w in re.findall(r"[a-z]+", street.lower())}
    for q in (address, f"{num} {street}"):
        url = ALS + "?" + urllib.parse.urlencode({"q": q, "n": 5})
        raw = subprocess.run(["curl", "-s", "-H", "Accept: application/json",
                              "--max-time", "45", url], capture_output=True, text=True)
        time.sleep(0.6)
        try:
            hits = json.loads(raw.stdout).get("SuggestedAddress") or []
        except Exception:
            continue
        for h in hits:
            try:
                prem = h["Address"]["PremisesAddress"]
                eng = prem["EngPremisesAddress"]
                geo = prem["GeospatialInformation"]
            except KeyError:
                continue
            st = eng.get("EngStreet") or {}
            got = {w for w in re.findall(r"[a-z]+", (st.get("StreetName") or "").lower())}
            # "16-18 Queen's Road Central" is one premises to the company and
            # two numbers to the gazetteer, which records the lower one.
            nums = {n.lstrip("0") for n in num.split("-")}
            if not (want & got) or str(st.get("BuildingNoFrom") or "").lstrip("0") not in nums:
                continue
            return dict(lon=round(float(geo["Longitude"]), 6),
                        lat=round(float(geo["Latitude"]), 6),
                        gazetteer_building=eng.get("BuildingName") or "",
                        gazetteer_street=f"{st.get('BuildingNoFrom')} {st.get('StreetName')}",
                        score=h.get("ValidationInformation", {}).get("Score"))
    return None


def roster_codes() -> list[str]:
    src = os.path.join(os.path.dirname(__file__), "..",
                       "src", "employsi", "data", "cityRosters.ts")
    body = open(src, encoding="utf-8").read()
    m = re.search(r"hongkong:\s*\{.*?companies:\s*\[(.*?)\n\s*\],", body, re.S)
    if not m:
        sys.exit("could not find the hongkong roster in cityRosters.ts")
    return re.findall(r'\[\s*"(\d{4,5})"', m.group(1))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("codes", nargs="*", help="HKEX stock codes, e.g. 00700")
    ap.add_argument("--roster", action="store_true",
                    help="every code on the Hong Kong roster")
    ap.add_argument("--json", metavar="FILE", help="write the results here too")
    a = ap.parse_args()
    codes = roster_codes() if a.roster else a.codes
    if not codes:
        ap.error("give some stock codes, or --roster")

    out = []
    for code in codes:
        rep = latest_report(code)
        if not rep:
            print(f"{code}  NO REPORT FOUND")
            continue
        fd, pdf = tempfile.mkstemp(suffix=".pdf")
        os.close(fd)
        try:
            curl(rep["link"], pdf)
            hit = read_address(pdf)
        finally:
            os.remove(pdf)
        if not hit:
            print(f"{code}  {rep['name'][:26]:26} NO HONG KONG ADDRESS IN "
                  f"{rep['title'][:34]}")
            continue
        pri, label, address = hit
        geo = geocode(address)
        row = dict(code=code, name=rep["name"], report=rep["title"], date=rep["date"],
                   label=label, address=address, **(geo or {}))
        out.append(row)
        if geo:
            print(f"{code}  {rep['name'][:24]:24} {geo['lon']:.5f},{geo['lat']:.5f}  "
                  f"{geo['gazetteer_street']:26.26} | {geo['gazetteer_building'][:22]:22} "
                  f"<- {label[:34]}")
        else:
            print(f"{code}  {rep['name'][:24]:24} NOT IN GAZETTEER  {address[:60]}  "
                  f"<- {label[:30]}")
    if a.json:
        json.dump(out, open(a.json, "w", encoding="utf-8"), indent=1)
    print(f"\n{len(out)} of {len(codes)} resolved")


if __name__ == "__main__":
    main()
