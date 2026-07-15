#!/usr/bin/env bash
# Grewal Engineering Works — one-time import of the AI PDI template library
# (121 parts, revision history, inspectors, approvers) into MongoDB.
# Only touches pdi_* master collections. Never touches dispatch/invoice data.
# Usage: bash deploy/seed_pdi.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
SEED_FILE="$SCRIPT_DIR/seed/pdi_seed.gz"

set -a; source "$APP_DIR/backend/.env"; set +a
: "${MONGO_URL:?MONGO_URL missing in backend/.env}"
: "${DB_NAME:?DB_NAME missing in backend/.env}"
[[ -f "$SEED_FILE" ]] || { echo "!!! Seed file not found: $SEED_FILE"; exit 1; }

echo "==> Importing PDI template library into '$DB_NAME'"
echo "    Collections: pdi_master_library, pdi_template_revisions, pdi_inspectors, pdi_approvers"
mongorestore --uri="$MONGO_URL" --archive="$SEED_FILE" --gzip --drop \
  --nsFrom='test_database.*' --nsTo="${DB_NAME}.*" \
  --nsInclude='test_database.pdi_master_library' \
  --nsInclude='test_database.pdi_template_revisions' \
  --nsInclude='test_database.pdi_inspectors' \
  --nsInclude='test_database.pdi_approvers'

echo "==> Done. Verify counts:"
mongosh --quiet "$MONGO_URL/$DB_NAME" --eval '
  ["pdi_master_library","pdi_template_revisions","pdi_inspectors","pdi_approvers"]
    .forEach(c => print(c + ": " + db.getCollection(c).countDocuments({})))' || true
echo "==> Restart the API afterwards: sudo systemctl restart grewal-api"
