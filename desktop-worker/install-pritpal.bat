@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-worker.ps1" -WorkerName Pritpal || exit /b 1
call install-worker.bat
