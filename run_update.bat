@echo off
title Polymarket Wallet Update
cd /d "%~dp0"

echo ============================================================
echo    WALLET UPDATE (Balance + Trades + Metrics)
echo ============================================================
echo.
echo This script will:
echo   1. Update portfolio values for all wallets
echo   2. Fetch trade history for qualified wallets (portfolio $200+)
echo   3. Recalculate 7d/30d metrics for all wallets
echo.

:: Check if venv exists
if not exist "venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found!
    echo Please run: python -m venv venv
    echo Then: venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

:: Check if .env exists
if not exist ".env" (
    echo ERROR: .env file not found!
    echo Please copy .env.example to .env and configure it.
    pause
    exit /b 1
)

:: Set PYTHONPATH to include project root
set PYTHONPATH=%~dp0

:: Run the update pipeline
venv\Scripts\python.exe scripts\run_collect.py

pause
