#!/usr/bin/env bash
# Grewal Engineering Works — roll back to a previous commit or tag and rebuild.
# Usage: bash deploy/rollback.sh <commit-or-tag>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
if [[ $EUID -ne 0 ]]; then SUDO="sudo"; else SUDO=""; fi

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: bash deploy/rollback.sh <commit-or-tag>"
  echo "Recent commits:"
  git -C "$APP_DIR" log --oneline -n 10
  exit 1
fi

cd "$APP_DIR"
echo "==> Rolling back to $TARGET (current: $(git rev-parse --short HEAD))"
git reset --hard "$TARGET"

echo "==> Backend dependencies"
cd "$APP_DIR/backend" && ./venv/bin/pip install -r requirements.txt

echo "==> Frontend build"
cd "$APP_DIR/frontend"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
NODE_OPTIONS=--max-old-space-size=2048 CI=true GENERATE_SOURCEMAP=false npm run build

echo "==> Restarting services"
$SUDO systemctl restart grewal-api
$SUDO systemctl reload nginx

for _ in $(seq 1 10); do
  if curl -fsS http://127.0.0.1:8001/health >/dev/null 2>&1; then
    echo "==> Rollback complete and healthy ($(git rev-parse --short HEAD))"
    exit 0
  fi
  sleep 2
done
echo "!!! Health check failed after rollback — inspect: journalctl -u grewal-api -n 100"
exit 1
