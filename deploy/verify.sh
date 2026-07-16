#!/usr/bin/env bash
# Grewal Engineering Works — post-deploy validation gate
# Run on the VPS after every deployment. Exits non-zero if any CRITICAL check fails.
# Usage: bash deploy/verify.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
set -a; source "$APP_DIR/backend/.env"; set +a
API="http://127.0.0.1:8001"
PASS=0; FAIL=0; CRIT=0

ok()   { echo "  ✔ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $1"; FAIL=$((FAIL+1)); }
crit() { echo "  ✘✘ CRITICAL: $1"; FAIL=$((FAIL+1)); CRIT=$((CRIT+1)); }

echo "==> 1. Backend health"
H=$(curl -fsS -m 10 "$API/health" 2>/dev/null)
[[ "$H" == *'"ok"'* ]] && ok "GET /health → $H" || crit "backend /health not responding"

echo "==> 2. Frontend"
FC=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "http://localhost/" 2>/dev/null)
[[ "$FC" == "200" ]] && ok "frontend HTTP $FC" || bad "frontend returned HTTP $FC (check nginx)"

echo "==> 3. Admin login"
TOKEN=$(curl -fsS -m 10 -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PASSWORD:?ADMIN_PASSWORD missing in backend/.env}\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
[[ -n "$TOKEN" ]] && ok "admin login OK" || crit "admin login failed"
[[ -z "$TOKEN" ]] && { echo "Cannot continue without token."; exit 1; }
AH="Authorization: Bearer $TOKEN"

echo "==> 4. Database / modules"
MODS=$(curl -fsS -m 10 "$API/api/modules" -H "$AH" | python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d))" 2>/dev/null)
[[ "${MODS:-0}" -ge 1 ]] && ok "modules seeded ($MODS)" || crit "modules collection empty — DB connection issue?"

echo "==> 5. PDI template library"
HEALTH=$(curl -fsS -m 30 "$API/api/pdi/templates/health" -H "$AH")
read -r TOTAL ACTIVE SCORE DUPA BROKEN NOROWS <<< "$(echo "$HEALTH" | python3 -c "
import sys,json; h=json.load(sys.stdin)
print(h['total'], h['active'], h['health_score'], h['counts']['dup_item_code_active'], h['counts']['broken_pdf'], h['counts']['missing_rows'])")"
echo "  templates: $TOTAL total / $ACTIVE active · health score: $SCORE%"
[[ "$TOTAL" -ge 1 ]] && ok "template library present" || crit "template library EMPTY — run deploy/seed_pdi.sh"
[[ "$DUPA" == "0" ]] && ok "no duplicate ACTIVE item codes" || crit "$DUPA duplicate ACTIVE item codes — run Clean Up Duplicates"
[[ "$BROKEN" == "0" ]] && ok "all template PDFs accessible" || crit "$BROKEN broken PDF link(s)"
[[ "$NOROWS" == "0" ]] && ok "all templates have inspection parameters" || bad "$NOROWS template(s) missing parameters (OCR failures)"

echo "==> 6. Integrity check (stored in audit log)"
INTEG=$(curl -fsS -m 60 -X POST "$API/api/pdi/templates/integrity-check" -H "$AH")
read -r RCONF ORPH <<< "$(echo "$INTEG" | python3 -c "
import sys,json; r=json.load(sys.stdin)
print(r['issues']['revision_conflicts'], r['issues']['orphan_reports'])")"
[[ "$RCONF" == "0" ]] && ok "no revision conflicts" || crit "$RCONF revision conflict(s)"
[[ "$ORPH" == "0" ]] && ok "no orphan reports" || bad "$ORPH report(s) reference missing templates"

echo "==> 7. PDI generation smoke test (sample part)"
GEN=$(curl -s -m 30 "$API/api/pdi/templates?status=active&limit=1" -H "$AH" | python3 -c "
import sys,json; d=json.load(sys.stdin)['items']
print(d[0]['id'] if d else '')")
if [[ -n "$GEN" ]]; then
  PV=$(curl -s -o /dev/null -w "%{http_code}" -m 30 -X POST "$API/api/pdi/templates/$GEN/preview" -H "$AH")
  [[ "$PV" == "200" ]] && ok "sample PDI render OK (template $GEN)" || crit "sample PDI render failed (HTTP $PV)"
else
  crit "no active template available for render test"
fi

echo ""
echo "================ RESULT ================"
echo "Passed: $PASS  Failed: $FAIL  Critical: $CRIT"
if [[ "$CRIT" -gt 0 ]]; then
  echo "❌ DEPLOYMENT VALIDATION FAILED — do NOT release. Fix critical items and re-run."
  exit 1
fi
echo "✅ Deployment validation PASSED."
