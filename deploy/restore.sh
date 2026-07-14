#!/usr/bin/env bash
# Grewal Engineering Works — restore a MongoDB backup created by backup.sh.
# Usage:
#   bash deploy/restore.sh                 # restores the newest backup
#   bash deploy/restore.sh <backup-file>   # restores a specific archive
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/grewal}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

MONGO_URL="$(grep -E '^MONGO_URL=' "$APP_DIR/backend/.env" | cut -d= -f2- | tr -d '"')"
DB_NAME="$(grep -E '^DB_NAME=' "$APP_DIR/backend/.env" | cut -d= -f2- | tr -d '"')"

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  FILE="$(ls -t "$BACKUP_DIR"/backup_*.gz 2>/dev/null | head -1 || true)"
fi
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "No backup archive found. Available backups:"
  ls -lh "$BACKUP_DIR" 2>/dev/null || echo "  (none)"
  exit 1
fi

echo "!!! This will DROP and restore database '$DB_NAME' from:"
echo "    $FILE"
read -r -p "Type 'yes' to continue: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { echo "Aborted."; exit 1; }

mongorestore --uri="$MONGO_URL" --archive="$FILE" --gzip --drop \
  --nsInclude="${DB_NAME}.*"

echo "==> Restore complete. Restart the API to be safe:"
echo "    sudo systemctl restart grewal-api"
