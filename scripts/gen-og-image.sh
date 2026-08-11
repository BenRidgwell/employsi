#!/usr/bin/env bash
#
# Regenerates public/og-image.png — the 1200x630 card every social platform and
# Google's rich result preview pulls when employsi.com.au is shared.
#
#   bash scripts/gen-og-image.sh
#
# WHY A BROWSER RENDER. The card is typeset in Mona Sans with the site's own
# tracking and gradient. Reproducing that in a drawing library means
# reimplementing the type stack that already exists in CSS, and it drifts from
# the site the first time the brand moves. Rendering the real CSS keeps one
# description of what the card looks like.
#
# WHY THE PNG IS COMMITTED. The build has no Chromium and no browser step; this
# script is run by hand when the card's wording or the brand changes, and the
# output is checked in like any other asset in public/. A deploy must never
# depend on this running.
#
# WHY PNG AND NOT SVG. Facebook, LinkedIn, Slack and X all reject SVG for
# og:image. 1200x630 is the size they all crop from cleanly (1.91:1).
#
# The fonts are inlined as base64 from public/waitlist-preview/, which is where
# the self-hosted copies already live. No network is touched, so this works in a
# sandbox with no outbound access.
set -euo pipefail

cd "$(dirname "$0")/.."

# headless_shell FIRST, and the preference is load-bearing rather than
# cosmetic. `--window-size=1200,630` sizes the WINDOW, and full Chromium
# subtracts its own UI strip from that to get the viewport: measured here, the
# card rendered into 1200x545 and the screenshot padded the remaining 85px with
# white, cutting the footer rule off. headless_shell has no UI, so window and
# viewport are the same box and the card fills the frame exactly.
CHROME=""
for candidate in \
  /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
  /opt/pw-browsers/chromium-*/chrome-linux/chrome \
  "$(command -v chromium || true)" \
  "$(command -v google-chrome || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    CHROME="$candidate"
    break
  fi
done

if [ -z "$CHROME" ]; then
  echo "No Chromium binary found. Install one, or set CHROME= by hand." >&2
  exit 1
fi

MONA="public/waitlist-preview/mona-sans-variable-200-900.woff2"
JETBRAINS="public/waitlist-preview/jetbrains-mono-500.woff2"
for f in "$MONA" "$JETBRAINS" scripts/og-image.html; do
  [ -f "$f" ] || {
    echo "Missing $f" >&2
    exit 1
  }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# base64 -w0: a wrapped payload would put newlines inside the data: URL.
python3 - "$WORK/card.html" "$MONA" "$JETBRAINS" <<'PY'
import base64, sys, pathlib

out, mona, jetbrains = sys.argv[1], sys.argv[2], sys.argv[3]
html = pathlib.Path("scripts/og-image.html").read_text(encoding="utf-8")
html = html.replace("FONT_MONA_SANS", base64.b64encode(pathlib.Path(mona).read_bytes()).decode())
html = html.replace(
    "FONT_JETBRAINS_MONO", base64.b64encode(pathlib.Path(jetbrains).read_bytes()).decode()
)
pathlib.Path(out).write_text(html, encoding="utf-8")
PY

# --force-device-scale-factor=1 pins the output to exactly 1200x630. Without it
# the shell inherits whatever DPI the environment reports and the file comes out
# at 2x on some machines and 1x on others, so the committed asset would churn.
"$CHROME" \
  --headless \
  --disable-gpu \
  --no-sandbox \
  --hide-scrollbars \
  --force-device-scale-factor=1 \
  --default-background-color=00000000 \
  --window-size=1200,630 \
  --screenshot="$WORK/og-image.png" \
  "file://$WORK/card.html" >/dev/null 2>&1

[ -s "$WORK/og-image.png" ] || {
  echo "Chromium produced no image." >&2
  exit 1
}

mv "$WORK/og-image.png" public/og-image.png
echo "Wrote public/og-image.png ($(wc -c <public/og-image.png) bytes)"
