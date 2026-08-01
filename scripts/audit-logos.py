#!/usr/bin/env python3
"""Audit a city's company logos for ones that cannot be seen.

The card renders the badge on a WHITE surface (.pbadge background:#fff), so a
logo that is white, near-white or transparent-with-white-marks is present,
loads fine, and is invisible. That is worse than a missing logo, which at least
falls back to the ticker text.

Three verdicts:
  MISSING     — the URL does not resolve, or Google's favicon service returned
                its generic placeholder (which it does for any domain it has
                nothing for). Detected by the placeholder's own pixel signature
                rather than by status code, because the service answers 200.
  WHITE       — every non-transparent pixel is near-white, so nothing shows.
  FAINT       — the mark is technically visible but its darkest pixel is still
                light enough to read as a smudge on white.

Usage: python3 scripts/audit-logos.py [--city perth]
"""
from __future__ import annotations
import argparse, io, json, re, subprocess, sys, time, urllib.error, urllib.request
import cairosvg
from PIL import Image

HERE = __file__.rsplit('/', 1)[0]
ROOT = HERE.rsplit('/', 1)[0]
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')

# Google's "we have nothing" favicon: a flat grey globe. Identified by its own
# small palette rather than a byte hash, because the service re-encodes.
def is_google_placeholder(im: Image.Image) -> bool:
    small = im.convert('RGB').resize((16, 16))
    px = list(small.getdata())
    # The placeholder is a grey-on-white globe: almost no saturation anywhere.
    sat = [max(p) - min(p) for p in px]
    coloured = sum(1 for s in sat if s > 26)
    if coloured > 8:
        return False
    greys = sum(1 for p in px if 90 <= sum(p) / 3 <= 200)
    return greys >= 40


def verdict(data: bytes) -> tuple[str, str]:
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:  # noqa: BLE001
        return 'MISSING', f'undecodable ({type(e).__name__})'
    if im.size[0] < 8 or im.size[1] < 8:
        return 'MISSING', f'{im.size[0]}x{im.size[1]} stub'
    if is_google_placeholder(im):
        return 'MISSING', 'favicon service placeholder (no logo for this domain)'

    rgba = im.convert('RGBA')
    px = list(rgba.getdata())
    # Only pixels the eye actually sees: anything mostly transparent is the
    # background, not the mark.
    solid = [(r, g, b) for (r, g, b, a) in px if a > 120]
    if not solid:
        return 'WHITE', 'fully transparent'
    lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for (r, g, b) in solid]
    darkest = min(lum)
    # Share of the mark that is dark enough to register against white.
    ink = sum(1 for v in lum if v < 200) / len(lum)
    if darkest > 235:
        return 'WHITE', f'all pixels near-white (darkest luma {darkest:.0f})'
    if ink < 0.06:
        return 'FAINT', f'only {ink * 100:.1f}% of the mark reads on white'
    return 'OK', f'darkest luma {darkest:.0f}, {ink * 100:.0f}% ink'


def fetch_verdict(url: str) -> tuple[str, str]:
    """Fetch and judge, with pacing and one retry.

    Google's favicon service answers a domain it has nothing for with a 404
    carrying a 726-byte grey-globe PNG — the status AND the body both say
    "missing", so the 404 is the answer rather than an error. It also throttles
    a fast loop and starts returning HTML, which an unpaced first run mistook
    for 50 broken logos; hence the sleep and the retry.
    """
    for attempt in range(2):
        time.sleep(0.45 if attempt == 0 else 2.5)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=25) as r:
                ctype = (r.headers.get('Content-Type') or '').lower()
                data = r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return 'MISSING', 'no favicon indexed for this domain'
            if attempt:
                return 'MISSING', f'HTTP {e.code}'
            continue
        except Exception as e:  # noqa: BLE001
            if attempt:
                return 'MISSING', f'fetch failed: {str(e)[:60]}'
            continue
        if 'svg' in ctype:
            return svg_verdict(data)
        if 'image' not in ctype:
            if attempt:
                return 'MISSING', f'served {ctype.split(";")[0] or "no content-type"}'
            continue  # throttled — retry
        return verdict(data)
    return 'MISSING', 'no image after retry'


def svg_verdict(data: bytes) -> tuple[str, str]:
    """Rasterise the SVG and judge the pixels, like every other format.

    Reading the declared fills instead does NOT work: an SVG path with no fill
    attribute defaults to BLACK, so a file full of unattributed paths looks
    white-only to a regex and renders as a solid black mark. The WA whole-of-
    government crest is exactly that shape, and an earlier text-matching pass
    called all 24 agencies using it invisible when they are not.
    """
    try:
        png = cairosvg.svg2png(bytestring=data, output_width=128)
    except Exception as e:  # noqa: BLE001
        return 'CHECK', f'SVG would not rasterise ({type(e).__name__})'
    v, why = verdict(png)
    # Aspect matters as much as colour here: .pbadge is a 52px SQUARE with
    # overflow:hidden, so a wide horizontal lockup is cropped to its middle
    # regardless of how legible the artwork is on its own.
    try:
        im = Image.open(io.BytesIO(data)) if False else None
    except Exception:
        im = None
    m = re.search(rb'viewBox\s*=\s*["\']\s*[\d.eE+-]+\s+[\d.eE+-]+\s+([\d.eE+-]+)\s+([\d.eE+-]+)', data)
    if m:
        try:
            w, h = float(m.group(1)), float(m.group(2))
            if h > 0 and w / h >= 2.2:
                return 'CROPPED', f'wide lockup ({w / h:.1f}:1) in a 52px square badge'
        except ValueError:
            pass
    return v, why + ' (SVG)'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--city', default='perth')
    a = ap.parse_args()

    p = subprocess.run(['npx', 'tsx', f'{HERE}/dump-perth-logos.ts'],
                       capture_output=True, timeout=300, cwd=ROOT)
    if p.returncode != 0:
        sys.exit(p.stderr.decode()[-600:])
    rows = json.loads(p.stdout.decode().strip().splitlines()[-1])

    out = []
    for i, c in enumerate(rows, 1):
        v, why = fetch_verdict(c['url'])
        out.append({**c, 'verdict': v, 'why': why})
        if i % 20 == 0:
            sys.stderr.write(f'  [{i}/{len(rows)}] \n')

    bad = [r for r in out if r['verdict'] != 'OK']
    print(f"\n{a.city}: {len(rows)} companies, {len(bad)} need attention\n")
    for v in ('MISSING', 'WHITE', 'CROPPED', 'FAINT', 'CHECK'):
        g = [r for r in bad if r['verdict'] == v]
        if not g:
            continue
        print(f'{v} ({len(g)})')
        for r in sorted(g, key=lambda x: x['name']):
            print(f"  {r['name']:<42} {r['domain']:<32} {r['why']}")
        print()
    json.dump(out, open('/tmp/logo-audit.json', 'w'), indent=1)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
