#!/usr/bin/env python3
"""
Company logos from LinkedIn, for companies whose slug we have already confirmed.

WHY LINKEDIN AND NOT THE FAVICON
The badge's last resort is Google's favicon service on the company's domain,
which returns whatever sits in that site's <link rel=icon>. Measured across the
145 Perth badges on 2026-08-08: 19 returned nothing at all, several returned a
16x16 image upscaled to a 24px pin, and the ones that ARE a real brand file are
often a wide wordmark that `object-fit: cover` crops into an illegible slice of
a letter.

LinkedIn's company avatar has none of those problems, and the measurements that
matter were checked rather than assumed:

  * it is ALWAYS 200x200 and square, which is the shape the round pin needs
  * it hotlinks — 200, image/jpeg, no cookie, no referer, no auth
  * the URL does not expire in any useful sense. The signed URL carries
    e=2147483647, the 32-bit maximum: 19 January 2038

WHY THIS IS CHEAP
scripts/linkedin-posts-to-d1.py already fetches these exact pages every night
and already sees this image — it explicitly discards it as "not post media".
And the hard part, knowing a company's vanity slug, is already solved: that
script resolves slugs through its attribution gate and writes the confirmed ones
to the `company_slugs` table. This reads that table; it never guesses a slug.

WHY IT MERGES
LinkedIn rate-limits hard — the volume probe was blocked at the fourth request
from a plain CI address. A run that gets throttled must not delete the logos an
earlier run found, so this ADDS and UPDATES and never drops an entry it simply
could not fetch today. Same reason gen-seek-advertisers.py merges.

Every logo is verified before it is written: it must decode, be at least 128px
on the short side, and have ink in it — a white-on-transparent mark renders as
an empty circle on the white badge, which is indistinguishable from a broken
one and is why five supplied logos had to be removed on 2026-08-08.

Needs: CLOUDFLARE_API_TOKEN (D1 read), pillow, and a host LinkedIn will serve.

Run:  python scripts/gen-linkedin-logos.py [--only id1,id2] [--limit N]
Then: npx eslint src/employsi/data/linkedinLogos.ts --fix
"""
from __future__ import annotations
import io
import json
import os
import re
import sys
import time
import urllib.request

try:
    from PIL import Image
except ImportError:
    sys.exit('pillow is required to verify the logos: pip install pillow')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'src/employsi/data/linkedinLogos.ts')

TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '')
ACCOUNT = os.environ.get('CF_ACCOUNT_ID') or '080a66721e2d85950d9d7dc939e08b76'
DB = os.environ.get('D1_DATABASE_ID') or '1c5f3ffb-b9d7-4233-b28b-0f1f8d193fe1'
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{DB}/query'

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
      '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15')
PAGE = 'https://www.linkedin.com/company/{slug}/'
# Seconds between company pages. LinkedIn throttles a repeat visitor quickly and
# a throttled fetch is indistinguishable from a company with no logo, so this is
# deliberately slow.
PAUSE = 5

args = sys.argv[1:]
ONLY = set(args[args.index('--only') + 1].split(',')) if '--only' in args else None
LIMIT = int(args[args.index('--limit') + 1]) if '--limit' in args else 10 ** 9


def d1(sql: str) -> list[dict]:
    if not TOKEN:
        sys.exit('CLOUDFLARE_API_TOKEN is required (D1 read) to load company_slugs.')
    body = json.dumps({'sql': sql}).encode()
    req = urllib.request.Request(API, data=body, headers={
        'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode())
    if not j.get('success'):
        raise RuntimeError(str(j.get('errors'))[:300])
    return j['result'][0]['results']


def existing() -> dict[str, str]:
    """The map as it stands, so a throttled run adds rather than replaces."""
    if not os.path.exists(OUT):
        return {}
    txt = open(OUT).read()
    return dict(re.findall(r'"([A-Za-z0-9_-]+)":\s*\n?\s*"([^"]+)"', txt))


def logo_url(slug: str) -> tuple[str, str]:
    """(url, why-not). The company page's og:image IS the avatar."""
    try:
        req = urllib.request.Request(PAGE.format(slug=slug), headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            html = r.read().decode('utf-8', 'replace')
    except Exception as e:  # noqa: BLE001
        return '', f'page {type(e).__name__}'
    m = re.search(r'<meta property="og:image" content="([^"]+)"', html)
    if not m:
        return '', 'no og:image'
    url = m.group(1).replace('&amp;', '&')
    # A page with no avatar falls back to LinkedIn's own banner art, which is
    # not this company's logo and must not be stored as one.
    if 'company-logo' not in url:
        return '', 'og:image is not a company logo'
    return url, ''


def verify(url: str) -> str:
    """'' when the image is usable, else why it is not."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=45) as r:
            raw = r.read()
        im = Image.open(io.BytesIO(raw)).convert('RGBA')
    except Exception as e:  # noqa: BLE001
        return f'image {type(e).__name__}'
    if min(im.size) < 128:
        return f'only {im.size[0]}x{im.size[1]}'
    px = [(a, b, c) for (a, b, c, al) in list(im.getdata()) if al > 32]
    if not px:
        return 'fully transparent'
    ink = 1 - sum(1 for p in px if min(p) > 235) / len(px)
    if ink <= 0.03:
        return f'{(1 - ink):.0%} near-white — would render as an empty badge'
    return ''


def write_ts(rows: dict[str, str]) -> None:
    key = lambda k: k if re.fullmatch(r'[A-Za-z_$][\w$]*', k) else json.dumps(k)  # noqa: E731
    body = '\n'.join(f'  {key(cid)}: {json.dumps(url)},' for cid, url in sorted(rows.items()))
    open(OUT, 'w').write(f'''// GENERATED — do not edit by hand.
// Run: python scripts/gen-linkedin-logos.py
//
// Roster id -> the company's LinkedIn avatar, for companies whose LinkedIn slug
// has been confirmed by scripts/linkedin-posts-to-d1.py (the `company_slugs`
// table). companyLogo.ts reads this ahead of the favicon service and behind
// everything chosen deliberately.
//
// These are 200x200 squares, which is what the round map pin needs — the
// favicon service returns whatever a site puts in <link rel=icon>, often 16px
// and often a wide wordmark that crops to an illegible slice. The URLs are
// signed but carry e=2147483647, the 32-bit maximum, so they expire in 2038.
//
// Every entry decoded, was at least 128px on the short side, and had ink in it
// when it was written. Regenerating MERGES: a run LinkedIn throttles adds
// nothing rather than deleting what earlier runs found.
export const LINKEDIN_LOGO: Record<string, string> = {{
{body}
}};
''')


def main() -> int:
    slugs = {r['company_id']: r['slug'] for r in d1('SELECT company_id, slug FROM company_slugs')}
    if ONLY:
        slugs = {k: v for k, v in slugs.items() if k in ONLY}
    ids = sorted(slugs)[:LIMIT]
    rows = existing()
    sys.stderr.write(f'{len(ids)} confirmed slugs to walk · {len(rows)} already stored\n')

    added = updated = kept = 0
    skipped: list[str] = []
    for i, cid in enumerate(ids):
        sys.stderr.write(f'[{i + 1}/{len(ids)}] {cid} ({slugs[cid]})... ')
        url, why = logo_url(slugs[cid])
        if not url:
            skipped.append(f'{cid}: {why}')
            sys.stderr.write(why + '\n')
            time.sleep(PAUSE)
            continue
        bad = verify(url)
        if bad:
            skipped.append(f'{cid}: {bad}')
            sys.stderr.write(bad + '\n')
            time.sleep(PAUSE)
            continue
        if cid not in rows:
            added += 1
            sys.stderr.write('NEW\n')
        elif rows[cid] != url:
            updated += 1
            sys.stderr.write('changed\n')
        else:
            kept += 1
            sys.stderr.write('unchanged\n')
        rows[cid] = url
        time.sleep(PAUSE)

    write_ts(rows)
    sys.stderr.write(f'\n{added} added, {updated} updated, {kept} unchanged, '
                     f'{len(skipped)} skipped (kept whatever was already stored).\n')
    for s in skipped:
        sys.stderr.write(f'  skipped {s}\n')
    sys.stderr.write(f'Wrote {len(rows)} logos to src/employsi/data/linkedinLogos.ts\n'
                     'Run `npx eslint src/employsi/data/linkedinLogos.ts --fix` before committing.\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
