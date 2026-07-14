# deploy/ — Production Deployment Kit

Everything needed to run the Grewal Engineering Works Automation Portal on a fresh
Ubuntu 22.04/24.04 VPS (e.g. Hostinger).

| File | Purpose |
|---|---|
| `install.sh` | One-shot installer: OS packages, Node 20, MongoDB 8, Python venv, Playwright Chromium, frontend build, systemd + nginx setup, health validation. |
| `update.sh` | Pull latest code, reinstall deps, rebuild frontend, restart services. |
| `grewal-api.service` | systemd unit template (placeholders `__APP_DIR__`, `__RUN_USER__` are filled in by install.sh). |
| `grewal-nginx.conf` | nginx site template: serves `frontend/build`, proxies `/api` and `/health` to the backend on 127.0.0.1:8001. |
| `backup.sh` | mongodump backup (gzip archive) with 7-day retention. Installed as a nightly 02:00 cron by install.sh. |
| `restore.sh` | Interactive restore of the newest (or a chosen) backup archive. |
| `.env.example` | All backend environment variables (never commit real secrets). |

## Quick start (fresh VPS)

```bash
git clone <repository> grewal && cd grewal
SERVER_NAME=yourdomain.com bash deploy/install.sh
nano backend/.env          # set passwords, GEMINI_API_KEY, TAFE credentials
sudo systemctl restart grewal-api
```

## Manual steps (equivalent to install.sh)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install --with-deps chromium

cd ../frontend
npm install
npm run build

sudo systemctl enable grewal-api
sudo systemctl start grewal-api
sudo systemctl restart nginx
```

Full guide: see `../DEPLOYMENT.md`.
