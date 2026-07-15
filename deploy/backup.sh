#!/usr/bin/env bash
# Grewal Engineering Works — nightly MongoDB backup with 7-day retention.
# Usage: bash deploy/backup.sh          (installed as a daily cron by install.sh)
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/grewal}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

MONGO_URL="$(grep -E '^MONGO_URL=' "$APP_DIR/backend/.env" | cut -d= -f2- | tr -d '"')"
DB_NAME="$(grep -E '^DB_NAME=' "$APP_DIR/backend/.env" | cut -d= -f2- | tr -d '"')"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/backup_${DB_NAME}_${STAMP}.gz"

echo "==> Backing up database '$DB_NAME' -> $FILE"
mongodump --uri="$MONGO_URL" --db="$DB_NAME" --archive="$FILE" --gzip

UPLOADS_FILE="$BACKUP_DIR/uploads_${STAMP}.tar.gz"
if [[ -d "$APP_DIR/backend/uploads" ]]; then
  echo "==> Backing up uploads (PDI templates/reports, invoices) -> $UPLOADS_FILE"
  tar -czf "$UPLOADS_FILE" -C "$APP_DIR/backend" uploads
fi

echo "==> Cleaning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name "backup_*.gz" -type f -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -type f -mtime +"$RETENTION_DAYS" -delete

echo "==> Done. Current backups:"
ls -lh "$BACKUP_DIR" | tail -n +2
