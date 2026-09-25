#!/usr/bin/env python3
"""Re-extract addresses from the already-fetched pages.

THE FIRST PASS MISSED ALMOST EVERYTHING, and the reason is worth keeping: it
turned every tag into a newline and then matched with a single-line regex, so
a footer address split across <span>s — which is how most of these sites mark
one up — could never match. Whitespace is collapsed first here, and the
street-type word is required so collapsing cannot glue two unrelated
sentences into something address-shaped.
"""
import json, os, re, sys, html as htmllib, glob

S = os.path.dirname(os.path.abspath(__file__))
ST = (r"(?:Road|Rd|Street|St|Avenue|Ave|Place|Way|Drive|Lane|Boulevard|Quay|Link|"
      r"Crescent|Terrace|Walk|Rise|View|Hill|Park|Circle|Square|Central|Bay|Praya|"
      r"Connaught|Queensway|Gloucester|Harbour|Finance|Garden|Gardens)")
SG_RE = re.compile(rf"(\d{{1,4}}[A-Za-z]?\s+[A-Z][\w'’.\-]*(?:\s+[\w'’.\-]+){{0,5}}\s+{ST}\b.{{0,80}}?Singapore\s+\d{{6}})")
# HONG KONG HAS NO POSTCODE, which is why it yielded 5 candidates to
# Singapore's 9: there is no self-validating tail to anchor on. Requiring the
# address to end in "Hong Kong" / "Kowloon" / "HKSAR" was too strict — it
# threw away "83 Des Voeux Road Central", Hang Seng's registered office, and
# left the card on a Mongkok branch that happened to be spelled out in full.
# The district names ARE the tail, so they are listed.
HK_TAIL = (r"(?:Hong\s?Kong|H\.?K\.?S\.?A\.?R|Kowloon|Central|Admiralty|Sheung\s?Wan|"
           r"Wan\s?ch?ai|Causeway\s?Bay|North\s?Point|Quarry\s?Bay|Taikoo|Tai\s?Koo|"
           r"Chai\s?Wan|Aberdeen|Kennedy\s?Town|Tsim\s?Sha\s?Tsui|Kwun\s?Tong|"
           r"Mong\s?kok|Cheung\s?Sha\s?Wan|Lai\s?Chi\s?Kok|Kowloon\s?Bay|Sha\s?Tin|"
           r"Tsuen\s?Wan|Kwai\s?Chung|Hung\s?Hom|Yau\s?Ma\s?Tei|Wong\s?Chuk\s?Hang|"
           r"Island\s?East|Pok\s?Fu\s?Lam|Sai\s?Ying\s?Pun)"
           )
HK_RE = re.compile(rf"(\d{{1,4}}[A-Za-z]?\s+[A-Z][\w'’.\-]*(?:\s+[\w'’.\-]+){{0,5}}\s+{ST}\b.{{0,45}}?{HK_TAIL})")
# HEAD-OFFICE LABELS BEAT PAGE ORDER, and that is not a refinement: Hang Seng
# Bank's contact page lists BRANCHES before its registered office, so taking
# the first address on the page put the card on a shop in Mongkok while
# "83 Des Voeux Road Central" sat further down the same file. Anything found
# under one of these labels is preferred; a bare first match is kept but
# marked, because a branch is a real address and so passes every other check.
LABEL = re.compile(r"(?:Registered\s+Office|Head\s+Office|Headquarters|Principal\s+Place\s+of\s+Business|Corporate\s+Office)[^A-Za-z0-9]{0,14}(.{10,200})", re.I)

def text_of(html):
    t = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    t = htmllib.unescape(t)
    return re.sub(r"\s+", " ", t)

def jsonld(html):
    out = []
    for m in re.finditer(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html):
        try: data = json.loads(m.group(1).strip())
        except Exception: continue
        stack = [data]
        while stack:
            n = stack.pop()
            if isinstance(n, list): stack.extend(n); continue
            if not isinstance(n, dict): continue
            a = n.get("address")
            if isinstance(a, dict):
                s = ", ".join(str(a[k]) for k in ("streetAddress","addressLocality","postalCode")
                              if a.get(k) and isinstance(a[k], str))
                if len(s) > 12: out.append("JSONLD: " + s)
            elif isinstance(a, str) and len(a) > 12: out.append("JSONLD: " + a)
            stack.extend(v for v in n.values() if isinstance(v, (dict, list)))
    return out

rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.strip()]
out = open(sys.argv[2], "w")
for city, cid, name, host in rows:
    found, labelled = [], []
    for p in sorted(glob.glob(os.path.join(S, "pages", f"{cid}_*.html"))) + \
             sorted(glob.glob(os.path.join(S, "pages", f"{cid}.html"))):
        try: h = open(p, encoding="utf-8", errors="replace").read()
        except Exception: continue
        if len(h) < 200: continue
        found += jsonld(h)
        t = text_of(h)
        rx = SG_RE if city == "singapore" else HK_RE
        found += [m.strip() for m in rx.findall(t)]
        for m in LABEL.findall(t):
            hit = (SG_RE if city == "singapore" else HK_RE).search(m)
            if hit: labelled.append("LABELLED: " + hit.group(1).strip())
    # labelled first, then json-ld, then whatever else matched
    found = labelled + [f for f in found if f.startswith("JSONLD")] + \
            [f for f in found if not f.startswith("JSONLD")]
    seen, uniq = set(), []
    for f in found:
        k = re.sub(r"\W+", "", f.lower())
        if k in seen: continue
        seen.add(k); uniq.append(re.sub(r"\s+", " ", f)[:140])
    out.write("\t".join([city, cid, name, host, " || ".join(uniq[:4])]) + "\n")
out.close()
print("wrote", sys.argv[2])
