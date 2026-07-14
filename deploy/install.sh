#!/usr/bin/env bash
# Grewal Engineering Works — one-shot installer for a fresh Ubuntu 22.04/24.04 VPS.
# Usage: bash deploy/install.sh   (run from anywhere inside the cloned repository)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
SERVER_NAME="${SERVER_NAME:-_}"

echo "==> Grewal Engineering Works installer"
echo "    App directory : $APP_DIR"
echo "    Server name   : $SERVER_NAME (override with SERVER_NAME=yourdomain.com bash deploy/install.sh)"

if [[ $EUID -ne 0 ]]; then SUDO="sudo"; else SUDO=""; fi
export DEBIAN_FRONTEND=noninteractive

echo "==> [1/9] Updating Ubuntu packages"
$SUDO apt-get update -y
$SUDO apt-get upgrade -y

echo "==> [2/9] Installing base packages (python3, venv, pip, nginx, git, curl)"
$SUDO apt-get install -y python3 python3-venv python3-pip nginx git curl gnupg ca-certificates openssl

echo "==> [3/9] Installing Node.js 20 + npm 10"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

echo "==> [4/9] Installing MongoDB (if not present)"
if ! command -v mongod >/dev/null 2>&1; then
  UBUNTU_CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
    $SUDO gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor --yes
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME}/mongodb-org/8.0 multiverse" | \
    $SUDO tee /etc/apt/sources.list.d/mongodb-org-8.0.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y mongodb-org
fi
$SUDO systemctl enable --now mongod

echo "==> [5/9] Backend: virtualenv + Python dependencies + Playwright Chromium"
cd "$APP_DIR/backend"
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt
./venv/bin/playwright install --with-deps chromium

if [[ ! -f "$APP_DIR/backend/.env" ]]; then
  echo "==> Creating backend/.env from .env.example (fill in your keys afterwards!)"
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
  JWT_SECRET="$(openssl rand -hex 32)"
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$APP_DIR/backend/.env"
  echo "    Generated a random JWT_SECRET."
  echo "    !!! EDIT backend/.env to set ADMIN_PASSWORD, DISPATCH_PASSWORD, GEMINI_API_KEY, TAFE_* values !!!"
fi

echo "==> [6/9] Frontend: npm install + production build"
cd "$APP_DIR/frontend"
if [[ ! -f .env ]]; then echo "REACT_APP_BACKEND_URL=" > .env; fi
npm install
npm run build

echo "==> [7/9] Log + backup directories, nightly backup cron"
$SUDO mkdir -p /var/log/grewal /var/backups/grewal
$SUDO chown -R "$(whoami)":"$(id -gn)" /var/log/grewal /var/backups/grewal
echo "0 2 * * * root bash $APP_DIR/deploy/backup.sh >> /var/log/grewal/backup.log 2>&1" | \
  $SUDO tee /etc/cron.d/grewal-backup >/dev/null
$SUDO chmod 644 /etc/cron.d/grewal-backup

echo "==> [8/9] systemd service (grewal-api)"
sed "s|__APP_DIR__|$APP_DIR|g; s|__RUN_USER__|$(whoami)|g" "$SCRIPT_DIR/grewal-api.service" | \
  $SUDO tee /etc/systemd/system/grewal-api.service >/dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable grewal-api
$SUDO systemctl restart grewal-api

echo "==> [9/9] nginx"
sed "s|__APP_DIR__|$APP_DIR|g; s|__SERVER_NAME__|$SERVER_NAME|g" "$SCRIPT_DIR/grewal-nginx.conf" | \
  $SUDO tee /etc/nginx/sites-available/grewal >/dev/null
$SUDO ln -sf /etc/nginx/sites-available/grewal /etc/nginx/sites-enabled/grewal
$SUDO rm -f /etc/nginx/sites-enabled/default
$SUDO nginx -t
$SUDO systemctl enable nginx
$SUDO systemctl restart nginx

echo "==> Validating deployment"
sleep 3
if curl -fsS http://127.0.0.1:8001/health >/dev/null; then
  echo "    Backend  : OK ($(curl -fsS http://127.0.0.1:8001/health))"
else
  echo "    Backend  : FAILED — check: journalctl -u grewal-api -n 50"; exit 1
fi
if curl -fsS http://127.0.0.1/health >/dev/null; then
  echo "    nginx    : OK (proxying /health)"
else
  echo "    nginx    : FAILED — check: nginx -t && systemctl status nginx"; exit 1
fi

echo ""
echo "=================================================================="
echo " Grewal Engineering Works installed successfully (v$(cat "$APP_DIR/VERSION"))"
echo " App      : http://$([[ "$SERVER_NAME" == "_" ]] && hostname -I | awk '{print $1}' || echo "$SERVER_NAME")"
echo " Update   : bash deploy/update.sh"
echo " Logs     : /var/log/grewal/  ·  journalctl -u grewal-api -f"
echo " REMINDER : edit backend/.env (passwords, GEMINI_API_KEY, TAFE creds),"
echo "            then: sudo systemctl restart grewal-api"
echo "=================================================================="
