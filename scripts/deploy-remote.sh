#!/usr/bin/env bash
set -euo pipefail

# Deploy the current checkout to the LAN Docker host, or roll back to the
# previously active image. Run from the repository on the workstation.
#
#   scripts/deploy-remote.sh             build + ship + activate current commit
#   scripts/deploy-remote.sh --dirty     allow a build from uncommitted changes
#   scripts/deploy-remote.sh --rollback  reactivate the previously active image
#
# The image is streamed over SSH (no registry) and compose/migration files are
# synced from committed content with `git archive`. Secrets never leave the
# host: its .env is edited in place (IPTVMASTER_IMAGE line only, .env.bak kept).
# Rollback swaps with .deploy-previous, so running --rollback twice returns to
# the newer image. Application-only rollback is safe only while both releases
# share the same schema; see docs/PROXMOX_INSTALL.md section 6.

HOST="${IPTVMASTER_DEPLOY_HOST:?Set IPTVMASTER_DEPLOY_HOST, e.g. deploy@192.0.2.10}"
KEY="${IPTVMASTER_DEPLOY_KEY:-$HOME/.ssh/iptvmaster_deploy}"
REMOTE_DIR="${IPTVMASTER_DEPLOY_DIR:-/opt/iptvmaster}"
BASE_URL="${IPTVMASTER_DEPLOY_URL:?Set IPTVMASTER_DEPLOY_URL, e.g. http://192.0.2.10:8080}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"
git rev-parse --is-inside-work-tree >/dev/null

mode="deploy"
allow_dirty=false
for arg in "$@"; do
  case "$arg" in
    --rollback) mode="rollback" ;;
    --dirty) allow_dirty=true ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

ssh_run() { ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" "$@"; }

wait_healthy() {
  local expected="$1" out=""
  for _ in $(seq 1 30); do
    if out=$(curl -fsS -m 3 "$BASE_URL/health" 2>/dev/null); then
      if [ -z "$expected" ] || printf '%s' "$out" | grep -q "$expected"; then
        echo "health: $out"
        return 0
      fi
    fi
    sleep 2
  done
  echo "ERROR: $BASE_URL/health did not report the expected release." >&2
  echo "Inspect with: ssh -i $KEY $HOST 'cd $REMOTE_DIR && docker compose ps && docker compose logs --tail 50 app migrate'" >&2
  return 1
}

# Record the currently active image in .deploy-previous, point
# IPTVMASTER_IMAGE at $1, and restart the stack without building.
activate_remote() {
  local image="$1"
  ssh_run "set -eu; cd '$REMOTE_DIR'; cp .env .env.bak; \
    prev=\$( (grep '^IPTVMASTER_IMAGE=' .env || echo 'IPTVMASTER_IMAGE=iptvmaster:local') | cut -d= -f2- ); \
    printf '%s\n' \"\$prev\" > .deploy-previous; \
    if grep -q '^IPTVMASTER_IMAGE=' .env; then \
      sed -i \"s|^IPTVMASTER_IMAGE=.*|IPTVMASTER_IMAGE=$image|\" .env; \
    else \
      printf '\nIPTVMASTER_IMAGE=%s\n' '$image' >> .env; \
    fi; \
    docker compose up -d --no-build"
}

if [ "$mode" = "rollback" ]; then
  image=$(ssh_run "cat '$REMOTE_DIR/.deploy-previous'") || {
    echo "ERROR: no .deploy-previous marker on the host; nothing to roll back to." >&2
    exit 1
  }
  echo "Rolling back to $image ..."
  activate_remote "$image"
  wait_healthy ""
  echo "Rollback done. Running --rollback again returns to the replaced image."
  exit 0
fi

if [ "$allow_dirty" = false ] && [ -n "$(git status --porcelain=v1 --untracked-files=no)" ]; then
  echo "ERROR: tracked files have uncommitted changes. Commit them or pass --dirty." >&2
  exit 1
fi

describe=$(git describe --always --tags --dirty=-dirty)
image="iptvmaster:$describe"
revision=$(git rev-parse HEAD)

echo "Building $image (revision $revision) ..."
docker build -t "$image" \
  --build-arg IPTVMASTER_VERSION="$describe" \
  --build-arg IPTVMASTER_REVISION="$revision" \
  .

echo "Shipping image to $HOST ..."
docker save "$image" | gzip | ssh_run "gunzip | docker load"

echo "Syncing compose and migration files (committed content) ..."
git archive HEAD -- compose.yaml deploy scripts | ssh_run "tar -x -C '$REMOTE_DIR'"

echo "Activating $image ..."
activate_remote "$image"
wait_healthy "$revision"

echo "Pruning old iptvmaster images (keeping current and previous) ..."
ssh_run "prev=\$(cat '$REMOTE_DIR/.deploy-previous' 2>/dev/null || true); \
  docker images iptvmaster --format '{{.Repository}}:{{.Tag}}' \
  | grep -v -x -e '$image' -e \"\$prev\" \
  | xargs -r docker rmi" || true

echo "Deployed $image. Roll back with: scripts/deploy-remote.sh --rollback"
