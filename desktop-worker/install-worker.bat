@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul || (echo Python 3 is required. Install it from python.org and tick Add Python to PATH.& exit /b 1)
if not exist .venv py -3 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m playwright install chromium
if not exist .env copy .env.example .env
echo.
echo Installation complete. Edit desktop-worker\.env, then run test-connection.bat.
pause
