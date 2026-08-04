#!/usr/bin/env python3
"""
Does linkedin.com/company/<slug>/ keep answering a datacentre address across a
ROSTER-SIZED walk, or only for the first handful of requests?

WHY THIS EXISTS
scripts/linkedin-posts-to-d1.py goes through Oxylabs. Unlike the other LinkedIn
feed it reads company POST pages, not the jobs API, and four consecutive slugs
(BHP, Rio Tinto, Woodside, Fortescue) answered a plain datacentre request on
2026-08-04 with 60 post cards each and zero authwall markers.

Four requests is not evidence. The scraper walks the whole roster with several
slug candidates apiece — several hundred requests a night — and LinkedIn's
throttling is exactly the kind that lets a few through and then stops. So the
only question worth measuring is whether the success rate DEGRADES WITH VOLUME,
which means bucketing outcomes by request number rather than reporting a total.

WHAT IT MEASURES
Every request is classified and counted into buckets of 25:

    posts     the real parser found post cards        — the outcome we need
    no-posts  200, a page, but no cards in it         — wrong slug, or gated
    authwall  LinkedIn asked us to sign in            — soft block
    blocked   999 / 429 / 403                         — hard block
    error     transport failure

A healthy result is a flat `posts` rate across buckets. A cliff — high early,
zero later — is the answer that says this stays on the proxy, and it is the
result four requests could never have found.

It uses the SCRAPER'S OWN slug_candidates and parse_posts, so "success" means
what the scraper would call success, not something adjacent to it. Requests go
through scripts/http_fetch.py, so the pacing is the same policy the direct
feeds already use.

Writes nothing. Stops early after a long enough run of consecutive hard blocks
that continuing would just be rude.

Run: python3 scripts/probe-linkedin-volume.py [--limit N] [--bucket N] [--json out]
"""
from __future__ import annotations
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import http_fetch  # noqa: E402

# Reuse the scraper's own logic rather than reimplementing it — a probe that
# disagrees with the scraper about what a good page looks like measures nothing.
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    'lp', os.path.join(HERE, 'linkedin-posts-to-d1.py'))
_lp = importlib.util.module_from_spec(_spec)
# Safe to import: the scraper parses its arguments inside main() and only
# demands a D1 token inside d1(), so nothing runs or exits on import. Loaded by
# hand only because the filename has hyphens in it.
_spec.loader.exec_module(_lp)

PAGE = 'https://www.linkedin.com/company/{slug}/'

args = sys.argv[1:]


def _opt(name, default):
    return args[args.index(name) + 1] if name in args else default


LIMIT = int(_opt('--limit', 120))
BUCKET = int(_opt('--bucket', 25))
OUT = _opt('--json', None)
# Consecutive hard blocks before giving up. Generous, because one 999 in the
# middle of a healthy walk is noise; twelve in a row is a decision.
BLOCK_RUN_STOP = 12

# LinkedIn's own refusal code is 999 — not a standard status, and easy to miss
# if you only check for 403/429.
HARD = {999, 429, 403}


def classify(text: str | None, status: int | None) -> str:
    if status in HARD:
        return 'blocked'
    if text is None:
        return 'error'
    low = text.lower()
    if 'authwall' in low or 'sign in to see' in low or '/uas/login' in low:
        return 'authwall'
    _actor, posts = _lp.parse_posts(text)
    return 'posts' if posts else 'no-posts'


def main() -> int:
    companies = _lp.load_companies()[:LIMIT]
    sys.stderr.write(
        f'LinkedIn company-page volume trial: {len(companies)} companies, '
        f'buckets of {BUCKET} REQUESTS (not companies).\n'
        f'Pacing via http_fetch (MIN_INTERVAL={http_fetch.MIN_INTERVAL}s '
        f'+ jitter {http_fetch.JITTER}s).\n\n')

    rows: list[dict] = []
    n = 0
    block_run = 0
    for c in companies:
        got_posts = False
        for slug in _lp.slug_candidates(c['name'], c.get('domain') or ''):
            if got_posts:
                break
            n += 1
            text, status = http_fetch.get(PAGE.format(slug=slug), timeout=45,
                                          retries=1, quiet=True)
            verdict = classify(text, status)
            rows.append({'n': n, 'id': c['id'], 'slug': slug,
                         'status': status, 'verdict': verdict,
                         'bytes': len(text or '')})
            if verdict == 'blocked':
                block_run += 1
            else:
                block_run = 0
            if verdict == 'posts':
                got_posts = True
            if n % BUCKET == 0:
                seg = rows[-BUCKET:]
                tally = {}
                for r in seg:
                    tally[r['verdict']] = tally.get(r['verdict'], 0) + 1
                hit = tally.get('posts', 0)
                sys.stderr.write(
                    f'  requests {n - BUCKET + 1:4}-{n:<4} '
                    f'posts {hit:3}/{BUCKET}  '
                    + '  '.join(f'{k}={v}' for k, v in sorted(tally.items())
                                if k != 'posts') + '\n')
            if block_run >= BLOCK_RUN_STOP:
                sys.stderr.write(
                    f'\n{block_run} consecutive hard blocks — stopping at request {n}.\n')
                break
        if block_run >= BLOCK_RUN_STOP:
            break

    # The headline number: does the posts rate hold up across the walk?
    sys.stderr.write(f'\n{n} requests over {len(rows)} slug attempts.\n')
    buckets = []
    for i in range(0, len(rows), BUCKET):
        seg = rows[i:i + BUCKET]
        hit = sum(1 for r in seg if r['verdict'] == 'posts')
        buckets.append((i + 1, i + len(seg), hit, len(seg)))
    if buckets:
        sys.stderr.write('posts-rate by bucket: ' + '  '.join(
            f'{a}-{b}:{h}/{t}' for a, b, h, t in buckets) + '\n')
        first, last = buckets[0], buckets[-1]
        f_rate = first[2] / max(1, first[3])
        l_rate = last[2] / max(1, last[3])
        sys.stderr.write(f'first bucket {f_rate:.0%}, last bucket {l_rate:.0%}\n')
        if l_rate >= f_rate * 0.7 and l_rate > 0:
            sys.stderr.write(
                '=> No degradation with volume. This feed can come off the proxy.\n')
        else:
            sys.stderr.write(
                '=> Degrades with volume — the early successes were not the whole '
                'story. Stays on the proxy.\n')

    total = {}
    for r in rows:
        total[r['verdict']] = total.get(r['verdict'], 0) + 1
    sys.stderr.write('totals: ' + '  '.join(f'{k}={v}' for k, v in sorted(total.items())) + '\n')

    if OUT:
        with open(OUT, 'w') as f:
            json.dump({'requests': n, 'buckets': buckets, 'totals': total,
                       'rows': rows}, f, indent=2)
        sys.stderr.write(f'wrote {OUT}\n')
    # Always 0: "they block us" is a result, not a failure of the probe.
    return 0


if __name__ == '__main__':
    sys.exit(main())
