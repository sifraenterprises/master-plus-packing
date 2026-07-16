#!/usr/bin/env bash
# Grewal Engineering Works — deployment preflight gate
# Fails (exit 1) if the repository is not safe to deploy.
# Usage: bash deploy/preflight.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"
FAIL=0
ok()  { echo "  ✔ $1"; }
bad() { echo "  ✘ $1"; FAIL=1; }

echo "==> 1. Git conflict markers"
if grep -RIn --exclude-dir={node_modules,build,venv,venv-audit,.git,.hidden-platform} -E "^(<{7}|>{7}|={7})( |$)" backend frontend/src deploy scripts >/dev/null 2>&1; then
  bad "conflict markers found"; else ok "none"; fi

echo "==> 2. Required files"
for f in backend/.env.example backend/requirements.txt backend/server.py \
         frontend/package.json frontend/craco.config.js VERSION \
         deploy/install.sh deploy/update.sh deploy/rollback.sh deploy/verify.sh deploy/backup.sh \
         deploy/restore.sh deploy/grewal-api.service deploy/grewal-nginx.conf \
         deploy/seed_pdi.sh deploy/seed/pdi_seed.gz; do
  [[ -f "$f" ]] && ok "$f" || bad "MISSING: $f"
done

echo "==> 3. Python compile"
python3 -m compileall -q backend scripts 2>/dev/null && ok "compileall clean" || bad "python compile errors"

echo "==> 4. Third-party branding scan (deployable source)"
BRAND="emer""gent"
MATCHES=$(grep -RIniE "${BRAND}|${BRAND}agent|${BRAND}base|preview\.${BRAND}agent\.com|github@${BRAND}\.sh|${BRAND}-agent" \
  frontend/src frontend/public backend deploy scripts \
  --exclude-dir={node_modules,venv,venv-audit,__pycache__} \
  --exclude="*.env" --exclude="*.env.*" 2>/dev/null | grep -v "Binary file" || true)
if [[ -n "$MATCHES" ]]; then bad "branded references remain:"; echo "$MATCHES" | head -10; else ok "zero branded references"; fi

echo "==> 5. Branded domains in compiled frontend build"
if [[ -d frontend/build ]]; then
  # The configured backend URL is baked into the bundle at build time — allow it (it is
  # the production URL when built on the VPS); flag every other external platform domain.
  BURL_HOST=$(grep "^REACT_APP_BACKEND_URL=" frontend/.env 2>/dev/null | cut -d= -f2 | sed -E 's|https?://||; s|/.*||')
  BUILD_HITS=$(grep -RhoiE "[a-z0-9.-]*(${BRAND}agent|${BRAND}base|${BRAND}\.sh)[a-z0-9.-]*" frontend/build 2>/dev/null | sort -u | grep -v "^${BURL_HOST}$" || true)
  if [[ -n "$BUILD_HITS" ]]; then bad "branded domain in build output: $BUILD_HITS"; else ok "build output clean (backend URL host excluded: ${BURL_HOST:-n/a})"; fi
else
  echo "  ⚠ frontend/build not present — run the production build first (informational)"
fi

echo "==> 6. Committed secrets"
LEAKS=$(git ls-files | grep -E "(^|/)\.env$|(^|/)\.env\.[a-z]+$" | grep -v ".env.example" || true)
[[ -z "$LEAKS" ]] && ok "no .env files committed" || bad "committed env files: $LEAKS"
if git ls-files -z | xargs -0 grep -lIE "AQ\.[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}" 2>/dev/null | grep -v ".env.example" | head -1 | grep -q .; then
  bad "possible API key committed"; else ok "no obvious API keys in tracked files"; fi

echo "==> 7. Nginx config sanity"
grep -q "client_max_body_size" deploy/grewal-nginx.conf && grep -q "proxy_pass http://127.0.0.1:8001" deploy/grewal-nginx.conf \
  && ok "nginx template valid (body size + api proxy)" || bad "nginx template missing directives"

echo "==> 8. systemd unit sanity"
grep -q "Restart=" deploy/grewal-api.service && grep -q "uvicorn" deploy/grewal-api.service \
  && ok "systemd unit valid" || bad "systemd unit missing Restart/uvicorn"

echo "==> 9. Environment variable documentation"
MISSING_DOC=""
for v in $(grep -rhoE 'environ(\.get)?\(["'"'"'][A-Z_]+' backend --include="*.py" \
    --exclude-dir={venv,venv-audit,__pycache__,tests} 2>/dev/null | grep -oE "[A-Z_]+$" | sort -u); do
  [[ "$v" == "PATH" || "$v" == "HOME" ]] && continue
  grep -q "^$v=" backend/.env.example || MISSING_DOC="$MISSING_DOC $v"
done
[[ -z "$MISSING_DOC" ]] && ok "all env vars documented in .env.example" || bad "undocumented env vars:$MISSING_DOC"

echo "==> 10. requirements.txt public-PyPI only"
if grep -qE "${BRAND}|@ https?://" backend/requirements.txt; then
  bad "non-PyPI dependency in requirements.txt"; else ok "requirements.txt clean"; fi

echo ""
if [[ "$FAIL" -eq 1 ]]; then
  echo "❌ PREFLIGHT FAILED — fix the items above before deploying."
  exit 1
fi
echo "✅ PREFLIGHT PASSED — repository is safe to deploy."
