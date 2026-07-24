#!/usr/bin/env bash
# Wrapper for scheduling scripts/zhaopin-to-d1.py from your own machine (cron /
# launchd / Task Scheduler). Zhaopin's anti-bot needs a real browser on a
# residential connection, so this runs locally via Playwright — like the Indeed
# scraper. Loads a local .env for the token so it isn't inline in the crontab.
#
# First time: run once by hand to clear Zhaopin's security check into a profile:
#   scripts/zhaopin-to-d1.sh --headful --profile ~/.zhaopin-profile --solve
# then schedule the headless archive reusing that profile:
#   0 7 * * * /path/to/repo/scripts/zhaopin-to-d1.sh --profile ~/.zhaopin-profile
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

for f in "$REPO/.env.zhaopin" "$REPO/.env"; do
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$f"
    set +a
    break
  fi
done

LOG="${ZHAOPIN_LOG:-$HOME/zhaopin-archive.log}"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) zhaopin-to-d1 start ===" >> "$LOG"
python3 scripts/zhaopin-to-d1.py "$@" >> "$LOG" 2>&1
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) zhaopin-to-d1 done (exit $?) ===" >> "$LOG"
