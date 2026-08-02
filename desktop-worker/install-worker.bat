@echo off
setlocal
cd /d "%~dp0"
if not exist .venv (
  py -3 -m venv .venv >nul 2>nul
  if errorlevel 1 (
    if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
      "%LocalAppData%\Programs\Python\Python312\python.exe" -m venv .venv
    ) else (
      echo Python 3.12 is required. Install it from python.org and tick Add Python to PATH.
      exit /b 1
    )
  )
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m playwright install chromium
if not exist .env copy .env.example .env
echo.
echo Installation complete for the single GrewalOfficeWorker desktop worker.
echo Edit .env, then run test-connection.bat.
pause
