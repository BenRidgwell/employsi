#!/usr/bin/env bash
# Wrapper for scheduling scripts/indeed-to-d1.py from your own machine (cron /
# launchd / Task Scheduler via WSL). Sets the working dir, loads a local .env if
# present (so your CLOUDFLARE_API_TOKEN isn't inline in the crontab), and logs.
#
# Example crontab (run at 6am daily, scope to your key companies):
#   0 6 * * * /path/to/repo/scripts/indeed-to-d1.sh --only bhp,fmg,wes,woodside
#
# Any args passed here are forwarded to indeed-to-d1.py.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Load a local .env (KEY=VALUE lines) if you keep the token there. Never commit it.
if [[ -f "$REPO/.env.indeed" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO/.env.indeed"
  set +a
fi

LOG="${INDEED_LOG:-$HOME/indeed-archive.log}"
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) indeed-to-d1 start ===" >> "$LOG"
python3 scripts/indeed-to-d1.py "$@" >> "$LOG" 2>&1
echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) indeed-to-d1 done (exit $?) ===" >> "$LOG"
