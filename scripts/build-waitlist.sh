#!/usr/bin/env bash
# Stage the waitlist page for the `employsi` Worker.
#
# The page is COPIED rather than committed twice. public/waitlist-preview.html
# is the source of truth — it is what the design tool exports and what Lovable
# syncs — and a second checked-in copy would drift from it silently, which is
# how a marketing site ends up a version behind its own design.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/public/waitlist-preview.html"
out="$root/workers/waitlist/dist"
[ -f "$src" ] || { echo "missing $src" >&2; exit 1; }
mkdir -p "$out"
cp "$src" "$out/index.html"
echo "staged $(wc -c < "$out/index.html") bytes -> workers/waitlist/dist/index.html"
