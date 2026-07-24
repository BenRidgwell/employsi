#!/usr/bin/env bash
# Wrapper for scheduling scripts/aps-to-d1.py from your own machine (cron /
# launchd / Task Scheduler). apsjobs.gov.au is a Salesforce Aura site that needs
# a real browser, so this runs locally via Playwright — like the SA scraper.
#
# Example crontab (daily 4am, one pass over every current APS vacancy):
#   0 4 * * * /path/to/repo/scripts/aps-to-d1.sh --profile ~/.aps-profile
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

for f in "$REPO/.env.aps" "$REPO/.env"; do
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$f"
    set +a
    break
  fi
done

LOG="${APS_LOG:-$HOME/aps-archive.log}"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) aps-to-d1 start ===" >> "$LOG"
python3 scripts/aps-to-d1.py "$@" >> "$LOG" 2>&1
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) aps-to-d1 done (exit $?) ===" >> "$LOG"
