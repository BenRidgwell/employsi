#!/usr/bin/env python3
"""Who employs the staff of the remaining South Australian bodies? Run on a runner.

    python3 scripts/sa-agency-probe.py            # all of them
    python3 scripts/sa-agency-probe.py agd        # one, by key

WHY THIS IS A WORKFLOW STEP AND NOT A LOCAL SCRIPT. South Australian cards are
blank and the answer to each is in a document the authoring sandbox cannot
fetch. Measured 2026-09-29 with a WARMED BROWSER, which is the fallback that
clears the Northern Territory and Tasmania:

    publicsector.sa.gov.au   still challenged after 30 s   28,768 bytes
    agd.sa.gov.au            still challenged after 30 s   28,994 bytes
    safework.sa.gov.au       still challenged after 30 s   28,756 bytes

One Cloudflare configuration, three hosts, and 180 seconds was already shown not
to help on the equivalent NSW hosts. It is a property of the exit IP rather than
of any of them, and gen-gov-workforce.py's `load_sa` already works on the runner.
So the log is the channel, exactly as it was for South Australia's 98 source rows.

WHAT IS BEING ASKED IS NOT "how many people". These are statutory offices whose
staff, where any exist, are employed by a department that is ALREADY FILED — so
the useful output is the sentence that says whose.

── WHAT ROUND ONE MEASURED, 2026-09-29, run 36551128127 ─────────────────────

THE RUNNER READS agd.sa.gov.au FINE: HTTP 200, 3,965,128 bytes of PDF where this
sandbox gets an interstitial. That settles the channel question for every SA
host below and is the reason this file is worth a second round rather than a
refusal.

TWO CARDS WERE SETTLED BY IT AND ARE GONE FROM PROBES:

  landscape  landscape.sa.gov.au is titled "Landscape Boards SA" and says
             "There are nine landscape boards across South Australia" — the
             eight regional boards plus Green Adelaide. It is the boards'
             shared site, not a body with its own staff.
  hydrogen   energymining.sa.gov.au answered 200 and matched NOTHING, which is
             consistent with the public record: the Office of Hydrogen Power
             ceased to function in 2025 and its responsibilities went to the
             Department for Energy and Mining.

AND TWO DNS FAILURES THAT ARE EVIDENCE RATHER THAN NOISE. mac.sa.gov.au and
salotteries.com.au both answered `Name or service not known` from a clean
runner — not a 403, not a timeout, no such host. Both cards were already
retired on the public record in the previous commit; a name that no longer
resolves is the same finding arriving from a second direction.

FOUR OF THE FIVE REMAINING BODIES 404'd ON A GUESSED PATH, which is a
measurement of my guess and not of the site. Round two asks for each host's
ROOT and prints its annual-report links, so round three can name the document
instead of guessing it.
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
    # THE ONE DOCUMENT WORTH MOST, and round one proved it reachable. The
    # Attorney-General's Department is filed at 1,688 and five blank cards sit
    # in its portfolio: SafeWork SA, the Commissioner for Children and Young
    # People, the Guardian for Children and Young People, the Child Death and
    # Serious Injury Review Committee and the SA Employment Tribunal.
    #
    # ROUND ONE SHOWED THE NAMES ARE ALL IN THERE AND DID NOT SHOW WHAT THEY
    # MEAN. "SafeWork SA which, as South Australia's workplace health and
    # safety regulator, investigates workplace incidents" says what it does;
    # "SafeWork SA prescribed fee 29 948 29 217" is a revenue line in the
    # department's own financial statements, which is suggestive of
    # consolidation and is not a statement about who employs anyone. So this
    # round prints CONTEXT — the lines either side, with the page number — and
    # asks the employment question directly rather than matching the name.
    'agd': dict(
        url='https://www.agd.sa.gov.au/__data/assets/pdf_file/0005/1200686/'
            'Final-Annual-Report-2024-25.pdf',
        ctx=2, cap=90,
        pats=WHO + [
            # The report's own scope statement, wherever it is made.
            r'(?i)this (?:annual )?report (?:covers|includes|is for)',
            r'(?i)(?:agencies|bodies|offices) (?:covered|included) (?:by|in)',
            # The five, each asked as an employment question rather than a name.
            r'(?i)SafeWork SA[^.]{0,80}(?:staff|employ|FTE|people)',
            r'(?i)(?:staff|employ|FTE)[^.]{0,80}SafeWork SA',
            r'(?i)Commissioner for Children and Young People',
            r'(?i)Guardian for Children and Young People',
            r'(?i)Child Death and Serious Injury',
            r'(?i)Employment Tribunal[^.]{0,80}(?:staff|employ|registry|FTE)',
            r'(?i)(?:staff|employ|registry)[^.]{0,80}Employment Tribunal',
            # The workforce section's own headings and totals.
            r'(?i)^\s*(?:Workforce|Employment) (?:information|statistics|data)',
            r'(?i)number of (?:employees|persons|staff)',
            r'(?i)\b1[,\s]?688\b',
        ]),
    # ── ROOTS, because round one's paths were guesses and 404'd ─────────────
    # Each of these prints its annual-report links so the next round can name a
    # document. A 404 on a path I invented says nothing about the site.
    'safework': dict(url='https://www.safework.sa.gov.au/', links=True,
                     pats=WHO + COUNT),
    'saet': dict(url='https://www.saet.sa.gov.au/', links=True, pats=WHO + COUNT),
    'gcyp': dict(url='https://gcyp.sa.gov.au/', links=True, pats=WHO + COUNT),
    'ccyp': dict(url='https://www.ccyp.com.au/', links=True, pats=WHO + COUNT),
    'cdsirc': dict(url='https://www.cdsirc.sa.gov.au/', links=True,
                   pats=WHO + COUNT),
    # THE GUARDIAN'S OWN REPORT, by a URL that is known to exist rather than
    # guessed — it is the 2022-23 edition, which is old for a head count and
    # perfectly good for an employment arrangement, since that is the kind of
    # fact that changes with legislation and not with the year.
    'gcyp-report': dict(
        url='https://gcyp.sa.gov.au/wordpress/wp-content/uploads/2023/11/'
            'Guardian-for-Children-and-Young-People-2022-23-Annual-Report.pdf',
        ctx=2, cap=40, pats=WHO + COUNT),
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
