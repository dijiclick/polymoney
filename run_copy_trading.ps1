# Polymarket Copy Trading Service - PowerShell Launcher
# Run this script to start the copy trading service

$ErrorActionPreference = "Stop"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "   POLYMARKET COPY TRADING SERVICE" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check venv
if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "ERROR: Virtual environment not found!" -ForegroundColor Red
    Write-Host "Please run: python -m venv venv" -ForegroundColor Yellow
    Write-Host "Then: venv\Scripts\pip install -r requirements.txt" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Check .env
if (-not (Test-Path ".env")) {
    Write-Host "ERROR: .env file not found!" -ForegroundColor Red
    Write-Host "Please copy .env.example to .env and configure it." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Show current config
Write-Host "Loading configuration..." -ForegroundColor Gray
$envContent = Get-Content ".env" | Where-Object { $_ -match "^[^#]" }
$paperMode = ($envContent | Where-Object { $_ -match "PAPER_TRADING=true" }).Count -gt 0
$copyEnabled = ($envContent | Where-Object { $_ -match "COPY_TRADING_ENABLED=true" }).Count -gt 0

if ($paperMode) {
    Write-Host "[PAPER TRADING MODE]" -ForegroundColor Yellow
} else {
    Write-Host "[LIVE TRADING MODE]" -ForegroundColor Red
}

if ($copyEnabled) {
    Write-Host "Copy trading: ENABLED" -ForegroundColor Green
} else {
    Write-Host "Copy trading: DISABLED" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Starting service... Press Ctrl+C to stop." -ForegroundColor White
Write-Host ""

# Run service
& "venv\Scripts\python.exe" -m src.execution.service

Write-Host ""
Write-Host "Service stopped." -ForegroundColor Yellow
Read-Host "Press Enter to exit"
