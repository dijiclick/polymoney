@echo off
title Polymarket Wallet Collector
cd /d "%~dp0"

echo ============================================================
echo    POLYMARKET WALLET COLLECTOR
echo ============================================================
echo.
echo This script will:
echo   1. Fetch top 1000 traders from all 10 leaderboard categories
echo   2. Update portfolio values for all wallets
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

:: Run the combined collector
venv\Scripts\python.exe scripts\run_collect.py

pause
