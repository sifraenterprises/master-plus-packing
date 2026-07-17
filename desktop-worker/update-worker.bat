@echo off
cd /d "%~dp0\.."
git pull --ff-only origin main
cd desktop-worker
call .venv\Scripts\activate.bat
pip install -r requirements.txt
python -m playwright install chromium
echo Worker updated.
pause
