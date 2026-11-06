#!/usr/bin/env bash
# Pull-based continuous deployment for the Docker setup, run every minute by a systemd timer (see
# docs/operations.md). When the branch has a new commit and every GitHub check on it passed, it fast-forwards
# this checkout, rebuilds and restarts the container, and rolls back if /health does not come back.
# Nothing has to reach this machine from outside: it only reads GitHub.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${GTV_DEPLOY_REPO:-hienduc14/guide-the-vibe}"
BRANCH="${GTV_DEPLOY_BRANCH:-main}"
HEALTH="${GTV_DEPLOY_HEALTH:-http://127.0.0.1:7390/health}"
compose=(docker compose -f docker/compose.yml)
[ -f docker/compose.local.yml ] && compose+=(-f docker/compose.local.yml)
compose+=(--env-file docker/.env -p "${GTV_DEPLOY_PROJECT:-gtv}")
[ "$(id -u)" = 0 ] || compose=(sudo -n "${compose[@]}")
failed_file="$(git rev-parse --git-dir)/gtv-deploy-failed"
log() { echo "[deploy] $*"; }

target=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)
current=$(git rev-parse HEAD)
[ -n "$target" ] && [ "$target" != "$current" ] || exit 0
[ "$target" = "$(cat "$failed_file" 2>/dev/null)" ] && exit 0 # already rolled back once; wait for the next commit

# All check runs completed and none failed; anything else means "not yet" or "never".
state=$(curl -fsS -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/commits/$target/check-runs?per_page=100" |
  python3 -c '
import json, sys
runs = json.load(sys.stdin)["check_runs"]
if not runs or any(r["status"] != "completed" for r in runs): print("pending")
elif all(r["conclusion"] in ("success", "skipped", "neutral") for r in runs): print("success")
else: print("failed")')
case "$state" in
  pending) exit 0 ;;
  failed) log "CI failed for ${target:0:7}, not deploying"; echo "$target" >"$failed_file"; exit 0 ;;
esac

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS -m 3 "$HEALTH" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

log "deploying ${current:0:7} -> ${target:0:7}"
git fetch -q origin "$BRANCH"
git merge -q --ff-only "$target"
if "${compose[@]}" up -d --build && healthy; then
  log "deployed ${target:0:7}: $(git log -1 --format=%s)"
  exit 0
fi

log "${target:0:7} is unhealthy, rolling back to ${current:0:7}"
echo "$target" >"$failed_file"
git reset -q --hard "$current"
"${compose[@]}" up -d --build && healthy && log "rolled back to ${current:0:7}" || log "ROLLBACK FAILED: check docker logs"
exit 1
