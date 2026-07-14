#!/usr/bin/env bash
# Grewal Engineering Works — update an existing deployment with automatic rollback.
# Usage: bash deploy/update.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
if [[ $EUID -ne 0 ]]; then SUDO="sudo"; else SUDO=""; fi

build_and_restart() {
  echo "==> Backend dependencies"
  cd "$APP_DIR/backend"
  ./venv/bin/pip install -r requirements.txt

  echo "==> Frontend build"
  cd "$APP_DIR/frontend"
  npm install
  npm run build

  echo "==> Restarting services"
  $SUDO systemctl restart grewal-api
  $SUDO systemctl reload nginx
}

health_ok() {
  for _ in $(seq 1 10); do
    if curl -fsS http://127.0.0.1:8001/health >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

cd "$APP_DIR"
PREV_COMMIT="$(git rev-parse HEAD)"
echo "==> Current commit: $PREV_COMMIT"

echo "==> Pulling latest code"
git pull

build_and_restart

if health_ok; then
  echo "==> Health check passed. Update complete (v$(cat "$APP_DIR/VERSION"), $(git rev-parse --short HEAD))"
  exit 0
fi

echo "!!! Health check FAILED — rolling back to $PREV_COMMIT"
git reset --hard "$PREV_COMMIT"
build_and_restart

if health_ok; then
  echo "==> Rollback successful. Application restored to $PREV_COMMIT."
else
  echo "!!! Rollback health check also failed — manual intervention required:"
  echo "    journalctl -u grewal-api -n 100"
fi
exit 1
