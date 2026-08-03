$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
python -m pip install --upgrade pyinstaller
python -m playwright install chromium
python -m PyInstaller --noconfirm --clean --onedir --name GrewalOfficeWorker `
  --add-data "$root\portal_selectors.json;." `
  --collect-all playwright `
  --collect-all dotenv `
  "$root\worker.py"
Write-Host "Worker executable created in $dist\GrewalOfficeWorker"
Write-Host "Build the installer with Inno Setup using installer\GrewalWorker.iss"
