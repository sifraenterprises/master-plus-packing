#!/usr/bin/env bash
# Grewal Engineering Works — update an existing deployment.
# Usage: bash deploy/update.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
if [[ $EUID -ne 0 ]]; then SUDO="sudo"; else SUDO=""; fi

echo "==> Pulling latest code"
cd "$APP_DIR"
git pull

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

sleep 3
curl -fsS http://127.0.0.1:8001/health && echo "" && echo "==> Update complete (v$(cat "$APP_DIR/VERSION"))"
