#!/usr/bin/env python3
"""Who employs the staff of the remaining South Australian bodies? CLOSED.

    python3 scripts/sa-agency-probe.py            # re-check every citation
    python3 scripts/sa-agency-probe.py agd        # one, by key

ALL FIVE CARDS THIS EXISTED FOR ARE SETTLED, 2026-09-29, and NOT_IN_SOURCE in
gen-gov-workforce.py carries the reasons. This file is kept as the re-check: the
documents below are the ones those reasons quote, so a run that stops matching
is a run telling you a citation has gone stale.

IT IS NOT IN gov-workforce.yml ANY MORE, because it has no question left to ask
and 45 s of log nobody reads is not free. Run it by hand — same treatment as
check-company-live.ts.

── WHAT THE THREE ROUNDS COST AND WHAT EACH BOUGHT ─────────────────────────

WHY A RUNNER AT ALL. Measured with a WARMED BROWSER, the fallback that clears
the Northern Territory and Tasmania:

    publicsector.sa.gov.au   still challenged after 30 s   28,768 bytes
    agd.sa.gov.au            still challenged after 30 s   28,994 bytes
    safework.sa.gov.au       still challenged after 30 s   28,756 bytes

One Cloudflare configuration, three hosts, and 180 s was already shown not to
help on the equivalent NSW hosts. The runner reads all of them.

ROUND ONE matched NAMES and proved the channel: agd.sa.gov.au served 3,965,128
bytes of PDF. Every one of the five bodies is named in it, and a name is not an
answer — "SafeWork SA prescribed fee 29 948 29 217" is a revenue line. It also
settled two cards outright and killed two more from a direction nobody expected:
mac.sa.gov.au and salotteries.com.au do not RESOLVE from a clean runner.

ROUND TWO asked the employment question directly, with context and page numbers,
and got AGD talking about its own staff — correctly and uselessly. Its real
value was negative: four of round one's five paths had 404'd, which measured my
guesses, so round two asked each host for its ROOT and printed its report links.
Every SA host serves the runner.

ROUND THREE STOPPED MATCHING AND STARTED READING. `pages` dumps a range whole,
and AGD p9 turned out to carry a list no pattern would have been written for —
"The following areas of AGD submit their own annual reports", nine names, one of
them the Employment Tribunal. That one line settled SAET. SafeWork SA fell to a
sentence on its own site ("SafeWork SA is a branch of the Attorney General's
Department"), and the other three to one paragraph each in their own reports,
all of which this sandbox can fetch directly — they are WordPress hosts, not the
challenged *.sa.gov.au ones.

THE LESSON IS THE SHAPE OF ROUND THREE. A pattern written in advance can only
find an answer phrased the way you already expected. When the question is "what
is this body", the sentence that answers it is in a section you have to read.
"""
import io
import re
import sys
import urllib.error
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')

# A challenge answered with HTTP 200 is the failure this whole file exists for,
# so it is named rather than left to look like a page with no sentences in it.
CHALLENGE = ('Just a moment', 'Security Checkpoint', 'Checking your browser',
             'Attention Required!', 'challenge-platform', 'Client Challenge',
             '/.safeline/', 'slg-title', 'Radware Captcha Page',
             'made us think that you are a bot')

# THE RELATIONSHIP QUESTION, not the head-count one. Each of these asks who the
# employer is; a number without one of these beside it settles nothing, because
# the whole difficulty is that these bodies sit inside somebody else's total.
WHO = [r'(?i)personnel services',
       r'(?i)employ(?:s|ed|ees)?\b[^.]{0,90}(?:department|attorney|agency|branch)',
       r'(?i)(?:staff|employees) (?:are|of|provided|seconded|engaged)',
       r'(?i)attached office',
       r'(?i)administrative unit',
       r'(?i)(?:is|as) an? (?:branch|division|directorate|unit|office) of',
       r'(?i)no (?:staff|employees)']
COUNT = [r'(?i)(?:head ?count|full.time equivalent|\bFTE\b)[^.]{0,60}\d',
         r'(?i)\b\d[\d,]{1,5}\b[^.]{0,40}(?:staff|employees|people)\b']

PROBES = {
    # THE FIVE CITATIONS, one per settled card. Each `proof` pattern is the
    # sentence the reason in NOT_IN_SOURCE quotes, so a probe that prints nothing
    # is a citation that has gone stale rather than a body that has changed.
    #
    # AGD p9's list is what settled the Employment Tribunal, and it is asked for
    # as a PAGE RANGE rather than a pattern on purpose — see the note at the top.
    'agd-structure': dict(
        url='https://www.agd.sa.gov.au/__data/assets/pdf_file/0005/1200686/'
            'Final-Annual-Report-2024-25.pdf',
        pages=(9, 9), pats=[]),
    # "SafeWork SA is a branch of the Attorney General's Department."
    # THE ONLY ONE OF THE SIX THAT STILL NEEDS THE RUNNER: safework.sa.gov.au
    # answers 403 to this sandbox. The other five are WordPress or plain hosts
    # and read fine from here, which is itself worth knowing — the Cloudflare
    # configuration is on the *.sa.gov.au government hosts, not on the statutory
    # offices' own sites.
    'safework-who': dict(
        url='https://www.safework.sa.gov.au/about-us/annual-activity-report/who-we-are',
        ctx=1, pats=[r'(?i)branch of the Attorney'] + COUNT),  # runner only
    # "Staff assigned to SAET pursuant to s 74 of the SAET Act." — and no count.
    'saet-report': dict(
        url='https://www.saet.sa.gov.au/app/uploads/2025/11/'
            'Annual_Report_2024-2025_SAET-FINAL.pdf',
        ctx=1, pats=[r'(?i)Staff assigned to SAET'] + COUNT),
    # "…funded and supported by the Government of South Australia through the
    # Department for Education", in both of these, almost word for word.
    'ccyp-report': dict(
        url='https://www.ccyp.com.au/wp-content/uploads/2024/11/'
            '202409-Annual-Report-2023-24_FINAL.pdf',
        ctx=2, pats=[r'(?i)through the Department for Education',
                     r'(?i)Service Level Agreement'] + COUNT),
    'gcyp-report': dict(
        url='https://gcyp.sa.gov.au/wp-content/uploads/2024/04/'
            'GYCP_TCV_CYPV_YTOV_Annual-Report-2023-24.pdf',
        ctx=2, pats=[r'(?i)administratively funded and supported'] + COUNT),
    # The strongest of the three: HUMAN RESOURCE management, not just funding.
    # THE PATTERN STOPS AT "management" BECAUSE THE LINE DOES: the sentence
    # wraps as "Financial and human resource management" / "support is provided
    # by the Department for Education", and a pattern spanning the break matched
    # nothing while the sentence was sitting right there. Same trap as `after`
    # needing to match a WORD and a LINE in gen-gov-workforce.py.
    'cdsirc-report': dict(
        url='https://cdsirc.sa.gov.au/wp-content/uploads/2024/11/'
            'CDSIRC-Annual-Report-2023-24.pdf',
        ctx=2, pats=[r'(?i)human resource management'] + COUNT),
}


def text_of(blob):
    """PDF or HTML bytes -> (plain text, page index per line) or (None, None)."""
    if blob[:4] == b'%PDF':
        import pdfplumber
        lines, pages = [], []
        with pdfplumber.open(io.BytesIO(blob)) as pdf:
            for n, pg in enumerate(pdf.pages, 1):
                for line in (pg.extract_text() or '').split('\n'):
                    lines.append(line)
                    pages.append(n)
        return lines, pages
    html = blob.decode('utf-8', 'replace')
    if any(c in html for c in CHALLENGE):
        return None, None
    html = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', ' ', html, flags=re.S | re.I)
    html = re.sub(r'<[^>]+>', '\n', html)
    html = (html.replace('&nbsp;', ' ').replace('&amp;', '&')
                .replace('&#8217;', "'").replace('&rsquo;', "'"))
    lines = [' '.join(l.split()) for l in html.split('\n') if l.strip()]
    return lines, [0] * len(lines)


def report_links(blob):
    """Annual-report hrefs, so the next round names a document rather than guessing."""
    html = blob.decode('utf-8', 'replace')
    out = []
    for href, label in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
                                  html, flags=re.S | re.I):
        text = ' '.join(re.sub(r'<[^>]+>', ' ', label).split())
        if re.search(r'(?i)annual|report|about us|who we are', href + ' ' + text):
            out.append((href, text[:60]))
    seen, uniq = set(), []
    for href, text in out:
        if href not in seen:
            seen.add(href)
            uniq.append((href, text))
    return uniq


def probe(key, spec):
    print(f'\n{"=" * 70}\n{key}: {spec["url"]}', flush=True)
    try:
        req = urllib.request.Request(spec['url'], headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            blob, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        print(f'  HTTP {e.code} — {e.reason}', flush=True)
        return
    except Exception as e:                                        # noqa: BLE001
        print(f'  {type(e).__name__}: {e}', flush=True)
        return
    print(f'  HTTP {status}, {len(blob):,} bytes, starts {blob[:8]!r}', flush=True)

    lines, pages = text_of(blob)
    if lines is None:
        print('  AN INTERSTITIAL, NOT THE PAGE — the runner is challenged too',
              flush=True)
        return

    if spec.get('links') and blob[:4] != b'%PDF':
        links = report_links(blob)
        print(f'  -- {len(links)} report-ish links --', flush=True)
        for href, text in links[:25]:
            print(f'     {href[:110]}   |{text}|', flush=True)

    # ── `pages`: DUMP A RANGE WHOLE ─────────────────────────────────────────
    # Matching one line at a time answers a question you already know how to
    # ask. A list of machinery-of-government changes is not that: what settles
    # five cards is whichever bullet happens to name them, and no pattern
    # written in advance knows which words that bullet uses.
    if spec.get('pages'):
        lo, hi = spec['pages']
        for n in range(lo, hi + 1):
            want = [l for l, pg in zip(lines, pages) if pg == n]
            if not want:
                continue
            print(f'    ---- page {n} ----', flush=True)
            for line in want:
                print(f'      {line[:200]}', flush=True)
        return

    ctx, cap = spec.get('ctx', 0), spec.get('cap', 60)
    shown, hits = set(), 0
    for pat in spec['pats']:
        for n, line in enumerate(lines):
            if len(line) < 8 or n in shown or not re.search(pat, line):
                continue
            lo, hi = max(0, n - ctx), min(len(lines), n + ctx + 1)
            if any(i in shown for i in range(lo, hi)) and ctx:
                continue
            hits += 1
            tag = f'p{pages[n]}' if pages[n] else '--'
            for i in range(lo, hi):
                shown.add(i)
                mark = '>' if i == n else ' '
                print(f'    {tag:>5} {mark} {lines[i][:200]}', flush=True)
            if ctx:
                print(flush=True)
            if hits >= cap:
                print(f'    … capped at {cap} matches', flush=True)
                return
    if not hits:
        print(f'  {len(lines):,} lines and NOT ONE matches any pattern — which is '
              f'a finding about the page, not about the body', flush=True)


def main():
    want = [a for a in sys.argv[1:] if not a.startswith('-')]
    for key, spec in PROBES.items():
        if want and key not in want:
            continue
        probe(key, spec)


if __name__ == '__main__':
    main()
