#!/usr/bin/env bash
# Stop the seeds nodes. --wipe also deletes their chain data (a fresh genesis next time).
set -uo pipefail
source "$(dirname "$0")/env.sh"
for n in alice bob dave; do
  f="$SEEDS_DATA/$n.pid"; [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null && echo "stopped $n"; rm -f "$f"
done
if [ "${1:-}" = "--wipe" ]; then sleep 2; rm -rf "$SEEDS_DATA"/{alice,bob,dave}; echo wiped; fi
