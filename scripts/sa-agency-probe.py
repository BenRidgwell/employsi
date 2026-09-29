#!/usr/bin/env python3
"""Who employs the staff of ten South Australian bodies? Run this on a runner.

    python3 scripts/sa-agency-probe.py            # all of them
    python3 scripts/sa-agency-probe.py safework   # one, by key

WHY THIS IS A WORKFLOW STEP AND NOT A LOCAL SCRIPT. Ten South Australian cards
are blank, and the answer to every one of them is in a document the authoring
sandbox cannot fetch. Measured 2026-09-29 with a WARMED BROWSER, which is the
fallback that clears the Northern Territory and Tasmania:

    publicsector.sa.gov.au   still challenged after 30 s   28,768 bytes
    agd.sa.gov.au            still challenged after 30 s   28,994 bytes
    safework.sa.gov.au       still challenged after 30 s   28,756 bytes

One Cloudflare configuration, three hosts, and 180 seconds was already shown not
to help on the equivalent NSW hosts. It is a property of the exit IP rather than
of any of them, and gen-gov-workforce.py's `load_sa` already works on the runner.
So the log is the channel, exactly as it was for South Australia's 98 source rows.

WHAT IS BEING ASKED IS NOT "how many people". Nine of the ten are statutory
offices, brands or wound-up bodies whose staff, where any exist, are employed by
a department that is ALREADY FILED — so the useful output is the sentence that
says whose. That is why each probe carries its own patterns: this prints the
lines that answer the relationship question, not every line with a number in it.

Each probe prints its status and size first, because a 403 or an interstitial is
itself the finding and reads nothing like an absent sentence.
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
             '/.safeline/', 'slg-title')

# Patterns shared by most probes: who employs whom, and any head count in reach.
WHO = [r'(?i)personnel services',
       r'(?i)employ(?:s|ed|ees)?\b[^.]{0,90}(?:department|attorney|agency|branch)',
       r'(?i)(?:staff|employees) (?:are|of|provided|seconded)',
       r'(?i)attached (?:office|to)',
       r'(?i)administrative unit',
       r'(?i)(?:is|as) a (?:branch|division|directorate|unit) of']
COUNT = [r'(?i)(?:head ?count|full.time equivalent|\bFTE\b)[^.]{0,60}\d',
         r'(?i)\b\d[\d,]{1,5}\b[^.]{0,40}(?:staff|employees|people)\b']

PROBES = {
    # THE ONE DOCUMENT WORTH MOST. The Attorney-General's Department is filed at
    # 1,688, and five of the ten bodies sit in its portfolio: SafeWork SA, the
    # Commissioner for Children and Young People, the Guardian for Children and
    # Young People, the Child Death and Serious Injury Review Committee and the
    # SA Employment Tribunal. If it names them as attached offices or as
    # personnel-services clients, five cards are settled from one read.
    'agd': dict(
        url='https://www.agd.sa.gov.au/__data/assets/pdf_file/0005/1200686/'
            'Final-Annual-Report-2024-25.pdf',
        pats=WHO + COUNT + [
            r'(?i)SafeWork SA',
            r'(?i)Commissioner for Children and Young People',
            r'(?i)Guardian for Children and Young People',
            r'(?i)Child Death and Serious Injury',
            r'(?i)Employment Tribunal',
        ]),
    # Its own site publishes an annual ACTIVITY report, separate from the
    # department's. Worth asking whether it states its own staffing at all.
    'safework': dict(
        url='https://www.safework.sa.gov.au/about-us/2024-25-annual-activity-report/'
            'who-we-are',
        pats=WHO + COUNT),
    # THE SOURCE HAS EIGHT LANDSCAPE BOARDS AND NO "Landscape SA" — Murraylands
    # and Riverland 78, Hills and Fleurieu 56, Limestone Coast 43, Northern and
    # Yorke 42, Kangaroo Island 34, SA Arid Lands 29, Eyre Peninsula 26,
    # Alinytjara Wilurara 16, summing to 324. The question is whether Landscape
    # SA is a NAME for those boards collectively or a body of its own, because
    # summing eight separately-reported statutory bodies onto one card is the
    # kind of leap gen-gov-workforce.py's ALIAS table refuses without evidence.
    'landscape': dict(
        url='https://www.landscape.sa.gov.au/about-us',
        pats=WHO + [r'(?i)landscape boards?\b', r'(?i)eight (?:regional )?boards',
                    r'(?i)Landscape South Australia Act']),
    # Wound down in stages from 2016 and abolished, on the public record, but the
    # roster still carries a card. The question is whether its own site says so.
    'mac': dict(
        url='https://www.mac.sa.gov.au/',
        pats=WHO + [r'(?i)(?:wound|abolish|ceased|closed|transferred|dissolved)',
                    r'(?i)CTP Regulator']),
    # A unit inside the Department for Energy and Mining on every description of
    # it; the source reports that department at 377 and names no office.
    'hydrogen': dict(
        url='https://www.energymining.sa.gov.au/industry/hydrogen-and-renewable-energy',
        pats=WHO + [r'(?i)Office of Hydrogen Power']),
    # THE SOURCE SPLITS THE PARLIAMENTARY WORKFORCE IN TWO — "Legislature
    # (Including Members)" 220 and "Electorate Services" 284 — and the first
    # counts the MEMBERS themselves, who are elected rather than employed. So no
    # single row is "the Parliament's staff", and the question for the report is
    # whether it states a staff total of its own.
    'parliament': dict(
        url='https://www.parliament.sa.gov.au/en/About-Parliament/Parliamentary-Administration',
        pats=WHO + COUNT + [r'(?i)joint parliamentary service',
                            r'(?i)House of Assembly', r'(?i)Legislative Council']),
    # Sold to Tatts in 2012 and operated under licence since; the brand survives
    # the employer. Asking its own site who runs it.
    'lotteries': dict(
        url='https://www.salotteries.com.au/about-us',
        pats=WHO + [r'(?i)(?:licence|licensed|operated by|Tatts|Lottery Corporation)']),
    'saet': dict(
        url='https://www.saet.sa.gov.au/about-us/',
        pats=WHO + COUNT),
    'ccyp': dict(
        url='https://www.ccyp.com.au/about-us/',
        pats=WHO + COUNT),
    'gcyp': dict(
        url='https://gcyp.sa.gov.au/about-us/',
        pats=WHO + COUNT),
}


def text_of(blob):
    """PDF or HTML bytes -> plain text, or None if it is neither."""
    if blob[:4] == b'%PDF':
        import pdfplumber
        with pdfplumber.open(io.BytesIO(blob)) as pdf:
            return '\n'.join((pg.extract_text() or '') for pg in pdf.pages)
    html = blob.decode('utf-8', 'replace')
    if any(c in html for c in CHALLENGE):
        return None
    html = re.sub(r'<(script|style)\b[^>]*>.*?</\1>', ' ', html, flags=re.S | re.I)
    html = re.sub(r'<[^>]+>', '\n', html)
    html = (html.replace('&nbsp;', ' ').replace('&amp;', '&')
                .replace('&#8217;', "'").replace('&rsquo;', "'"))
    return '\n'.join(' '.join(l.split()) for l in html.split('\n') if l.strip())


def probe(key, spec):
    print(f'\n{"=" * 70}\n{key}: {spec["url"]}', flush=True)
    try:
        req = urllib.request.Request(spec['url'], headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=90) as r:
            blob, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        print(f'  HTTP {e.code} — {e.reason}', flush=True)
        return
    except Exception as e:                                        # noqa: BLE001
        print(f'  {type(e).__name__}: {e}', flush=True)
        return
    print(f'  HTTP {status}, {len(blob):,} bytes, starts {blob[:8]!r}', flush=True)

    txt = text_of(blob)
    if txt is None:
        print('  AN INTERSTITIAL, NOT THE PAGE — the runner is challenged too',
              flush=True)
        return
    lines = txt.split('\n')
    seen, hits = set(), 0
    for pat in spec['pats']:
        for n, line in enumerate(lines):
            if len(line) < 8 or n in seen or not re.search(pat, line):
                continue
            seen.add(n)
            hits += 1
            print(f'    {line[:220]}', flush=True)
            if hits > 60:
                print('    … (60 lines is enough to decide from)', flush=True)
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
