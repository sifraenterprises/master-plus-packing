# DEPLOYMENT.md — Hostinger VPS Deployment Guide

Grewal Engineering Works — TAFE Vendor Automation System
Target: fresh **Ubuntu 24.04** (or 22.04) VPS · Python 3.12 · Node.js 20 · npm 10 · MongoDB 8 · nginx

---

## 1. Prerequisites

- A Hostinger VPS (2 GB RAM minimum recommended — Playwright Chromium needs headroom).
- SSH access (`ssh root@YOUR_VPS_IP`).
- (Optional) A domain pointed at the VPS IP (A record).
- Your keys ready: **Gemini API key** (Google AI Studio) and **TAFE portal credentials**.

## 2. Automated deployment (recommended)

```bash
ssh root@YOUR_VPS_IP
git clone <repository> /opt/grewal
cd /opt/grewal
SERVER_NAME=yourdomain.com bash deploy/install.sh   # omit SERVER_NAME to serve on the raw IP
```

The installer:
1. Updates Ubuntu, installs Python 3 / venv / pip, Node.js 20, npm 10, nginx, git, MongoDB 8.
2. Creates `backend/venv`, installs `requirements.txt`, installs Playwright Chromium with system deps.
3. Creates `backend/.env` from `.env.example` with a random `JWT_SECRET` (first run only).
4. Runs `npm install && npm run build` for the frontend.
5. Installs + enables the `grewal-api` systemd service and the nginx site, then validates `/health`.

**After install — set your secrets:**

```bash
nano /opt/grewal/backend/.env
# ADMIN_PASSWORD, DISPATCH_PASSWORD  -> strong passwords (users are auto-seeded)
# GEMINI_API_KEY                     -> for invoice OCR
# TAFE_PORTAL_URL / TAFE_USERNAME / TAFE_PASSWORD
# AUTOMATION_MODE=live               -> when ready for real portal submissions
# CORS_ORIGINS=https://yourdomain.com
sudo systemctl restart grewal-api
```

Open `http://yourdomain.com` (or the VPS IP) and log in.

## 3. Manual deployment (what install.sh does)

```bash
git clone <repository> /opt/grewal && cd /opt/grewal

# Backend
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install --with-deps chromium
cp .env.example .env && nano .env        # fill all values

# Frontend
cd ../frontend
echo "REACT_APP_BACKEND_URL=" > .env      # empty = same-origin via nginx
npm install
npm run build

# Services
sudo mkdir -p /var/log/grewal
sudo sed "s|__APP_DIR__|/opt/grewal|g; s|__RUN_USER__|root|g" deploy/grewal-api.service \
  | sudo tee /etc/systemd/system/grewal-api.service
sudo sed "s|__APP_DIR__|/opt/grewal|g; s|__SERVER_NAME__|yourdomain.com|g" deploy/grewal-nginx.conf \
  | sudo tee /etc/nginx/sites-available/grewal
sudo ln -sf /etc/nginx/sites-available/grewal /etc/nginx/sites-enabled/grewal
sudo rm -f /etc/nginx/sites-enabled/default

sudo systemctl daemon-reload
sudo systemctl enable grewal-api && sudo systemctl start grewal-api
sudo nginx -t && sudo systemctl restart nginx
```

## 4. Updating

```bash
cd /opt/grewal
bash deploy/update.sh
```

(git pull → pip install → npm install → npm run build → restart grewal-api → reload nginx.)

## 5. HTTPS (recommended)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

Then set `CORS_ORIGINS=https://yourdomain.com` in `backend/.env` and restart the API.

## 6. Health, logs, backups & troubleshooting

| What | Command |
|---|---|
| Health check | `curl http://127.0.0.1:8001/health` → `{"status":"ok","version":"1.0.0"}` |
| System status | Portal → Settings → **System Status** (API/DB/Playwright/Gemini, disk, CPU, RAM, queues, last backup) |
| API service | `sudo systemctl status grewal-api` · `journalctl -u grewal-api -f` |
| App logs (rotating) | `/var/log/grewal/api.log`, `/var/log/grewal/error.log`, `/var/log/grewal/backup.log` |
| Manual backup | `bash deploy/backup.sh` (nightly 02:00 cron installed automatically; 7-day retention in `/var/backups/grewal`) |
| Restore backup | `bash deploy/restore.sh` (newest) or `bash deploy/restore.sh /var/backups/grewal/backup_....gz` |
| nginx | `sudo nginx -t` · `/var/log/nginx/error.log` |
| MongoDB | `sudo systemctl status mongod` |

Common issues:
- **Service fails at startup with "Missing required environment variables"** → fill `backend/.env` (the API validates env on boot by design).
- **Playwright errors in live mode** → re-run `backend/venv/bin/playwright install --with-deps chromium`; keep `AUTOMATION_HEADLESS=true`.
- **TAFE portal unreachable** → ask TAFE support to whitelist your VPS IP (`curl ifconfig.me`); until then use `AUTOMATION_MODE=test`.
- **502 from nginx** → backend down; check `journalctl -u grewal-api -n 50`.

## 7. Versioning & releases

- The running version lives in the `VERSION` file (shown in the portal footer and `/health`).
- Every release: update `VERSION`, add an entry to `CHANGELOG.md`, then tag:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

- Roll back to a known-good release on the VPS:

```bash
cd /opt/grewal && git fetch --tags && git checkout v1.0.0 && bash deploy/update.sh
```

## 8. Security checklist (already enforced by the app)

- `JWT_SECRET` required — the API refuses to start without it (and all other required vars).
- Passwords hashed with bcrypt; login brute-force lockout; JWT sessions expire after 8 h.
- CORS restricted via `CORS_ORIGINS`; nginx `client_max_body_size 25m` + backend 10 MB PDF limit and `%PDF` content validation.
- Security headers set by both the API middleware and nginx.
- Rotating logs (10 MB × 5) under `/var/log/grewal/`; TAFE credentials never logged or exposed to the UI.
