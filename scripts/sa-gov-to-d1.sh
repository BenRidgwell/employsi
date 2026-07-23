#!/usr/bin/env bash
# Wrapper for scheduling scripts/sa-gov-to-d1.py from your own machine (cron /
# launchd / Task Scheduler via WSL). Sets the working dir, loads a local .env if
# present (so your CLOUDFLARE_API_TOKEN isn't inline in the crontab), and logs.
#
# Unlike the WA board (a no-browser HTTP feed run inside the jobs-cron Worker),
# the SA board renders its results only in a real browser, so this runs locally
# via Playwright — like the Indeed scraper.
#
# Example crontab (run at 5am daily, one pass over every current SA-gov vacancy):
#   0 5 * * * /path/to/repo/scripts/sa-gov-to-d1.sh
#
# Any args passed here are forwarded to sa-gov-to-d1.py.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Load a local .env (KEY=VALUE lines) if you keep the token there. Never commit it.
for f in "$REPO/.env.sagov" "$REPO/.env.indeed" "$REPO/.env"; do
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$f"
    set +a
    break
  fi
done

LOG="${SAGOV_LOG:-$HOME/sa-gov-archive.log}"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) sa-gov-to-d1 start ===" >> "$LOG"
python3 scripts/sa-gov-to-d1.py "$@" >> "$LOG" 2>&1
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) sa-gov-to-d1 done (exit $?) ===" >> "$LOG"
