param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Pritpal", "Pawan", "Gurpreet")]
    [string]$WorkerName
)

$ErrorActionPreference = "Stop"
$workerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$examplePath = Join-Path $workerDir ".env.example"
$envPath = Join-Path $workerDir ".env"

if (-not (Test-Path -LiteralPath $examplePath)) {
    throw "Missing .env.example. Download the complete desktop-worker folder again."
}

if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
}

$content = Get-Content -LiteralPath $envPath
if ($content -match '^WORKER_NAME=') {
    $content = $content -replace '^WORKER_NAME=.*$', "WORKER_NAME=$WorkerName"
} else {
    $content += "WORKER_NAME=$WorkerName"
}
Set-Content -LiteralPath $envPath -Value $content -Encoding utf8

Write-Host "Configured this desktop as worker: $WorkerName" -ForegroundColor Green
Write-Host "Next: open desktop-worker\.env and enter the worker token and TAFE settings."
Write-Host "Keep TEST_MODE=true for the first supervised test."
